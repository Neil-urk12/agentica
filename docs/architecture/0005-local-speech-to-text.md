# ADR 0005: On-device speech-to-text for voice input

Status: proposed, 2026-10-23. Scope: dictating prompts into the composer.

The composer needs a hands-free way to enter a prompt. The browser Web Speech
API (`SpeechRecognition`) was tried first. In the WebView2/Edge runtime it
reports as supported, then fails with `network` or `language-not-supported`
moments after starting. In Chromium-based browsers it also sends audio to a
vendor speech service, which conflicts with Agentica keeping data on the
machine.

The composer records audio with `MediaRecorder`, decodes it to 16 kHz mono PCM
on the main thread, and transcribes it in a Web Worker with Transformers.js
running `Xenova/whisper-small.en`. The worker prefers WebGPU and falls back to
WebAssembly on the CPU. The model and the ONNX runtime are downloaded on first
use from `huggingface.co` and `cdn.jsdelivr.net` and kept in the webview's cache
storage. Nothing runs in the Rust runtime, so desktop and browser modes behave
the same and no new runtime command or protocol change is needed.

Consequences:

- Audio and transcripts stay on the machine, and dictation needs no API key.
- First use downloads about 130 MB, and the CSP must allow `'wasm-unsafe-eval'`
  in `script-src` and `blob:` in `worker-src`. Neither allows JavaScript `eval`.
- Runtime code for the ONNX backend comes from a CDN without an integrity check.
  Serving it from the app bundle instead (`env.backends.onnx.wasm.wasmPaths`)
  would remove that dependency and is a follow-up.
- The model is English only. Accuracy and speed depend on the user's hardware.
- None of this has been validated in the desktop WebView on any platform.
