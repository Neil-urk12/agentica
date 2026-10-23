/**
 * Local speech-to-text worker.
 *
 * Runs OpenAI Whisper fully in the browser via Transformers.js (@huggingface/
 * transformers) — no server and no API key. The Web Speech API
 * (`SpeechRecognition`) is unreliable in the WebView2 runtime the desktop app
 * uses, so voice input records audio and transcribes it here instead.
 * Inference runs in this worker so the canvas UI stays responsive.
 *
 * Backend selection: prefer WebGPU (several times faster than CPU at the same
 * accuracy) and fall back to the WASM/CPU backend when WebGPU is unavailable
 * (older WebView2 runtime, disabled GPU, etc.). Current WebView2 ships a
 * Chromium new enough to have WebGPU on by default, but the fallback keeps the
 * feature working everywhere.
 *
 * Messages in:  { type: "load" } | { type: "transcribe", id, audio: Float32Array }
 * Messages out: { type: "ready", backend }
 *             | { type: "progress", status, file?, progress?, loaded?, total? }
 *             | { type: "result", id, text }
 *             | { type: "error", id?, message }
 */
import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

// Accurate English model (~130 MB q-mixed). Download size is acceptable; speed
// comes from running it on the GPU rather than from shrinking the model.
const MODEL = "Xenova/whisper-small.en";

// Per-backend precision. WebGPU runs an fp32 encoder with a q4 decoder (fast
// and accurate on the GPU); WASM keeps an fp32 encoder with a q8 decoder.
const DEVICE_CONFIG = {
  webgpu: {
    device: "webgpu" as const,
    dtype: {
      encoder_model: "fp32" as const,
      decoder_model_merged: "q4" as const,
    },
  },
  wasm: {
    device: "wasm" as const,
    dtype: {
      encoder_model: "fp32" as const,
      decoder_model_merged: "q8" as const,
    },
  },
};

// Models are fetched from the Hugging Face CDN on first use, then cached in the
// browser's Cache Storage. Disable the local-file lookup that only applies when
// bundling model weights with the app.
env.allowLocalModels = false;
// Multi-threaded WASM needs cross-origin isolation we don't set, so pin one
// thread for predictable behaviour when the CPU fallback is used.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null =
  null;
let activeBackend: "webgpu" | "wasm" = "wasm";

/** Resolve to "webgpu" when a GPU adapter is actually obtainable, else "wasm". */
async function pickBackend(): Promise<"webgpu" | "wasm"> {
  const gpu = (
    navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function createPipeline(
  backend: "webgpu" | "wasm",
): Promise<AutomaticSpeechRecognitionPipeline> {
  return pipeline("automatic-speech-recognition", MODEL, {
    ...DEVICE_CONFIG[backend],
    progress_callback: (progress) => {
      self.postMessage({ type: "progress", ...progress });
    },
  });
}

async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const backend = await pickBackend();
      try {
        const transcriber = await createPipeline(backend);
        activeBackend = backend;
        if (backend === "webgpu") await warmUp(transcriber);
        return transcriber;
      } catch (error) {
        // If WebGPU init/compile fails, retry once on the CPU backend so voice
        // input still works rather than failing outright.
        if (backend === "webgpu") {
          activeBackend = "wasm";
          const transcriber = await createPipeline("wasm");
          return transcriber;
        }
        throw error;
      }
    })();
  }
  return transcriberPromise;
}

/**
 * Run one tiny inference so WebGPU compiles its shaders now, keeping the first
 * real transcription fast. One second of silence is enough.
 */
async function warmUp(transcriber: AutomaticSpeechRecognitionPipeline) {
  try {
    await transcriber(new Float32Array(16_000));
  } catch {
    // A warmup failure is non-fatal; the real call will surface any error.
  }
}

interface LoadMessage {
  type: "load";
}
interface TranscribeMessage {
  type: "transcribe";
  id: number;
  audio: Float32Array;
}
type InboundMessage = LoadMessage | TranscribeMessage;

self.addEventListener("message", (event: MessageEvent<InboundMessage>) => {
  const data = event.data;
  if (data.type === "load") {
    getTranscriber().then(
      () => self.postMessage({ type: "ready", backend: activeBackend }),
      (error: unknown) =>
        self.postMessage({ type: "error", message: errorMessage(error) }),
    );
    return;
  }
  if (data.type === "transcribe") void runTranscription(data);
});

// Surface anything the model throws outside a message handler (e.g. a backend
// that fails to load) instead of letting it vanish silently.
self.addEventListener("error", (event) => {
  self.postMessage({ type: "error", message: event.message });
});
self.addEventListener("unhandledrejection", (event) => {
  self.postMessage({ type: "error", message: errorMessage(event.reason) });
});

async function runTranscription(data: TranscribeMessage) {
  try {
    const transcriber = await getTranscriber();
    // whisper-*.en is English-only: passing `language`/`task` makes v4 throw.
    const output = await transcriber(data.audio, {
      // Whisper processes 30s windows; chunk longer clips so it can handle them.
      chunk_length_s: 30,
      stride_length_s: 5,
      // Beam search (vs greedy default) markedly reduces the misrecognitions,
      // repetitions and hallucinations Whisper produces on real-world speech.
      // It is cheap on the GPU; on the CPU fallback it costs more but keeps
      // accuracy, which is the priority.
      num_beams: 5,
      // Block 3-gram repeats and deterministic decoding to avoid loops.
      no_repeat_ngram_size: 3,
      temperature: 0,
    });
    const text = Array.isArray(output)
      ? output.map((part) => part.text).join(" ")
      : output.text;
    self.postMessage({
      type: "result",
      id: data.id,
      text: (text ?? "").trim(),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: errorMessage(error),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
