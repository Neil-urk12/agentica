/**
 * Pure helpers for composer voice input, kept free of DOM and media APIs so
 * they can be unit tested under Node.
 */

export type AudioFormat = "webm" | "ogg" | "mp3" | "wav";

export interface RecorderType {
  /** MIME type passed to MediaRecorder; empty means the browser default. */
  mime: string;
  format: AudioFormat;
}

/** Recorder MIME types in order of preference. */
export const PREFERRED_TYPES: readonly RecorderType[] = [
  { mime: "audio/webm;codecs=opus", format: "webm" },
  { mime: "audio/webm", format: "webm" },
  { mime: "audio/ogg;codecs=opus", format: "ogg" },
  { mime: "audio/ogg", format: "ogg" },
  { mime: "audio/mp4", format: "mp3" },
  { mime: "audio/wav", format: "wav" },
];

const DEFAULT_RECORDER_TYPE: RecorderType = { mime: "", format: "webm" };

/**
 * Pick the first preferred recorder type the browser supports. Pass
 * `MediaRecorder.isTypeSupported`, or nothing when the browser lacks it.
 */
export function pickRecorderType(
  isTypeSupported?: (mime: string) => boolean,
): RecorderType {
  if (typeof isTypeSupported !== "function") return DEFAULT_RECORDER_TYPE;
  return (
    PREFERRED_TYPES.find((candidate) => isTypeSupported(candidate.mime)) ??
    DEFAULT_RECORDER_TYPE
  );
}

/** Trim the OS device suffix some browsers append, e.g. "(1234:5678)". */
export function cleanMicName(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
}

/** Average equal-length channels into one mono channel of `length` samples. */
export function downmixToMono(
  channels: readonly Float32Array[],
  length: number,
): Float32Array<ArrayBuffer> {
  const mono = new Float32Array(length);
  if (channels.length === 0) return mono;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}
