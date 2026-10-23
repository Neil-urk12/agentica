/**
 * Main-thread client for local speech-to-text.
 *
 * Decodes a recorded audio Blob to the 16 kHz mono PCM that Whisper expects,
 * then hands it to the Transformers.js worker for transcription. Everything
 * runs locally in the browser — no network beyond the one-time model download,
 * which the worker caches in the browser's Cache Storage.
 */

const WHISPER_SAMPLE_RATE = 16_000;

export interface SpeechProgress {
  /** "initiate" | "download" | "progress" | "done" | "ready" from Transformers.js. */
  status?: string;
  file?: string;
  /** 0–100 while a model file downloads. */
  progress?: number;
}

/** Coarse transcription stage for UI status. */
export type TranscribeStage =
  | { stage: "decoding" }
  | { stage: "downloading"; percent?: number }
  | { stage: "transcribing" };

type WorkerMessage =
  | { type: "ready"; backend?: "webgpu" | "wasm" }
  | ({ type: "progress" } & SpeechProgress)
  | { type: "result"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

let worker: Worker | null = null;
let nextId = 1;
let modelReady = false;
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
let onProgress: ((progress: SpeechProgress) => void) | null = null;
let readyResolvers: (() => void)[] = [];

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./speech-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("error", (event) => {
    // A worker-level error (e.g. the script or its WASM backend failing to
    // load) would otherwise leave every caller hanging forever.
    const error = new Error(
      event.message || "The speech recognizer failed to start.",
    );
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    readyResolvers = [];
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
    const data = event.data;
    switch (data.type) {
      case "ready":
        for (const resolve of readyResolvers) resolve();
        readyResolvers = [];
        break;
      case "progress":
        onProgress?.(data);
        break;
      case "result": {
        pending.get(data.id)?.resolve(data.text);
        pending.delete(data.id);
        break;
      }
      case "error": {
        const error = new Error(data.message);
        if (data.id !== undefined) {
          pending.get(data.id)?.reject(error);
          pending.delete(data.id);
        } else {
          // A load failure rejects every waiter and the ready barrier.
          for (const { reject } of pending.values()) reject(error);
          pending.clear();
          readyResolvers = [];
        }
        break;
      }
    }
  });
  return worker;
}

/**
 * Begin downloading and initializing the Whisper model. Safe to call early
 * (e.g. when the user first focuses the composer) to warm the cache. Reports
 * download progress via the optional callback.
 */
export function preloadSpeechModel(
  progress?: (progress: SpeechProgress) => void,
): Promise<void> {
  if (progress) onProgress = progress;
  const instance = getWorker();
  return new Promise<void>((resolve) => {
    readyResolvers.push(resolve);
    instance.postMessage({ type: "load" });
  });
}

/** True when running in a context that can host the speech worker. */
export function speechSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * Transcribe a recorded audio Blob to English text, entirely on-device.
 * Resolves to an empty string when the clip is silent or unintelligible.
 *
 * `onStage` reports coarse progress so the UI can distinguish the one-time
 * model download from the actual transcription:
 *   "decoding"    — preparing the recorded audio
 *   "downloading" — fetching the Whisper model (first use only), with percent
 *   "transcribing" — running inference
 */
export async function transcribeSpeech(
  audio: Blob,
  signal?: AbortSignal,
  onStage?: (stage: TranscribeStage) => void,
): Promise<string> {
  signal?.throwIfAborted();
  onStage?.({ stage: "decoding" });
  const samples = await decodeToMono16k(audio);
  signal?.throwIfAborted();

  // Report model-download progress only until the pipeline is ready; after
  // that, every call goes straight to inference.
  if (!modelReady && onStage) {
    onProgress = (progress) => {
      if (
        progress.status === "progress" &&
        typeof progress.progress === "number"
      )
        onStage({
          stage: "downloading",
          percent: Math.round(progress.progress),
        });
    };
  }

  const id = nextId++;
  const instance = getWorker();
  return new Promise<string>((resolve, reject) => {
    const settle = {
      resolve: (text: string) => {
        modelReady = true;
        onProgress = null;
        resolve(text);
      },
      reject: (error: Error) => {
        onProgress = null;
        reject(error);
      },
    };
    if (signal) {
      const onAbort = () => {
        pending.delete(id);
        settle.reject(new DOMException("Transcription aborted.", "AbortError"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve: (text) => {
          signal.removeEventListener("abort", onAbort);
          settle.resolve(text);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          settle.reject(error);
        },
      });
    } else {
      pending.set(id, settle);
    }
    onStage?.({ stage: modelReady ? "transcribing" : "downloading" });
    // Transfer the sample buffer to avoid a copy.
    instance.postMessage({ type: "transcribe", id, audio: samples }, [
      samples.buffer,
    ]);
  });
}

/**
 * Decode compressed audio (webm/ogg/mp4/wav) into 16 kHz mono float samples,
 * the exact input Whisper expects. Averages all channels to mono first, then
 * resamples with an OfflineAudioContext. Getting this wrong (e.g. feeding the
 * model the wrong sample rate) produces badly garbled transcriptions, so the
 * conversion is explicit rather than relying on implicit down-mixing.
 */
async function decodeToMono16k(audio: Blob): Promise<Float32Array> {
  const bytes = await audio.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
  } catch {
    await decodeCtx.close();
    throw new Error("Could not read the recorded audio. Try recording again.");
  }
  await decodeCtx.close();

  // Average channels to mono.
  const channels = decoded.numberOfChannels;
  const length = decoded.length;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++)
    channelData.push(decoded.getChannelData(c));
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += channelData[c]?.[i] ?? 0;
    mono[i] = sum / channels;
  }

  if (decoded.sampleRate === WHISPER_SAMPLE_RATE) return mono;

  // Resample to 16 kHz by rendering the mono buffer through an offline context
  // at the target rate.
  const frames = Math.max(
    1,
    Math.round((length * WHISPER_SAMPLE_RATE) / decoded.sampleRate),
  );
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
  const monoBuffer = offline.createBuffer(1, length, decoded.sampleRate);
  monoBuffer.copyToChannel(mono, 0);
  const source = offline.createBufferSource();
  source.buffer = monoBuffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
