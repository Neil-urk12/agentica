<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import {
    cleanMicName,
    pickRecorderType,
    type AudioFormat,
  } from "../voice-input";

  interface Props {
    placeholder?: string;
    toolbarOpen: boolean;
    loading?: boolean;
    disabled?: boolean;
    onToggleToolbar: () => void;
    onAddFile?: () => void;
    addFileDisabled?: boolean;
    onSubmit?: (prompt: string) => boolean | Promise<boolean>;
    /**
     * Transcribe recorded speech to text. When omitted, the microphone button
     * is hidden. Receives the recorded audio, its container format, an abort
     * signal, and an optional progress reporter for long first-run model loads.
     */
    onTranscribe?: (
      audio: Blob,
      format: AudioFormat,
      signal: AbortSignal,
      onStage?: (stage: { label: string }) => void,
    ) => Promise<string>;
    /** Short scope line, such as "2 selected objects · recent conversation". */
    scope?: string;
    /** Provider name and model shown in the disclosure. */
    provider?: string;
    /** What the next request actually transmits. */
    details?: string[];
    notice?: string;
    onCancel?: () => void;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
    toolbarOpen,
    loading = false,
    disabled = false,
    onToggleToolbar,
    onAddFile,
    addFileDisabled = false,
    onSubmit,
    onTranscribe,
    scope = "",
    provider = "",
    details = [],
    notice = "",
    onCancel,
  }: Props = $props();

  let promptText = $state("");
  let detailsOpen = $state(false);

  // -------------------------------------------------------------- voice input
  // The Web Speech API (SpeechRecognition) is unreliable inside the WebView2 /
  // Edge runtime the desktop app runs on — it reports support but fails with a
  // "network"/"language-not-supported" error moments after starting. Instead we
  // capture audio with MediaRecorder (which the WebView does support) and hand
  // it to onTranscribe, which runs a local Whisper model to produce text.
  type VoiceState =
    | "idle"
    | "preparing"
    | "recording"
    | "transcribing"
    | "error";

  const voiceSupported = $derived(
    !!onTranscribe &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined",
  );

  let voiceState = $state<VoiceState>("idle");
  let voiceError = $state("");
  let voiceStatus = $state("Transcribing your voice…");
  let micName = $state("");
  let recorder: MediaRecorder | null = null;
  let micStream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let voiceFormat: AudioFormat = "webm";
  let transcribeAbort: AbortController | null = null;

  /**
   * Resolve the microphone label to show. Device labels are only exposed once
   * the user has granted microphone permission, so this may be empty until the
   * first recording; we refresh it from the live track at that point.
   */
  async function refreshMicName() {
    if (!voiceSupported || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput" && d.label);
      const preferred =
        inputs.find((d) => d.deviceId === "default") ?? inputs[0];
      if (preferred) micName = cleanMicName(preferred.label);
    } catch {
      // Enumeration can fail before permission; ignore and try again later.
    }
  }

  $effect(() => {
    if (!voiceSupported) return;
    void refreshMicName();
    const devices = navigator.mediaDevices;
    const onChange = () => void refreshMicName();
    devices?.addEventListener?.("devicechange", onChange);
    return () => devices?.removeEventListener?.("devicechange", onChange);
  });

  // Keep the acquired microphone stream alive between recordings so the second
  // and later recordings start instantly (only the first pays the permission +
  // device-init cost, shown as the "preparing" state). The warm stream is
  // released after a short idle period so the OS "microphone in use" indicator
  // doesn't stay on indefinitely.
  const WARM_IDLE_MS = 30_000;
  let warmTimer: ReturnType<typeof setTimeout> | null = null;

  /** Return a live mic stream, reusing the warm one when it is still usable. */
  async function warmMic(): Promise<MediaStream> {
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    const existing = micStream?.getAudioTracks()[0];
    if (micStream && existing && existing.readyState === "live")
      return micStream;
    // Whisper was trained on clean speech, so ask the OS for the cleanups it
    // can do at capture time and hint the 16 kHz mono it expects. Browsers
    // honour what they support and ignore the rest.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStream = stream;
    // The live track names the device actually in use — the most reliable
    // source once permission is granted.
    const trackLabel = stream.getAudioTracks()[0]?.label;
    if (trackLabel) micName = cleanMicName(trackLabel);
    else void refreshMicName();
    return stream;
  }

  /** Pre-acquire the mic on hover/focus so even the first click is instant. */
  function prewarmMic() {
    if (
      !voiceSupported ||
      disabled ||
      loading ||
      voiceState !== "idle" ||
      micStream
    )
      return;
    void warmMic().catch(() => {
      // Ignore: a real start will surface any permission error to the user.
    });
    scheduleWarmRelease();
  }

  /** Stop and drop the warm stream, clearing the OS mic-in-use indicator. */
  function releaseWarmStream() {
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  /** Release the warm stream after an idle period of no recording. */
  function scheduleWarmRelease() {
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = setTimeout(releaseWarmStream, WARM_IDLE_MS);
  }

  /** Tear down only the recorder, keeping the stream warm for next time. */
  function releaseRecorder() {
    recorder = null;
    scheduleWarmRelease();
  }

  async function startVoice() {
    if (!voiceSupported || disabled || loading) return;
    voiceError = "";
    // Show a "starting" state right away. Acquiring the mic (permission +
    // device init) can take up to a second or two, and the recorder only
    // captures audio once it has actually started — so we must not let the
    // user believe they can speak before then. A warm stream makes this
    // near-instant after the first use.
    voiceState = "preparing";
    let stream: MediaStream;
    try {
      stream = await warmMic();
    } catch {
      voiceState = "error";
      voiceError =
        "Microphone unavailable. Grant microphone access and try again.";
      return;
    }
    // The user may have cancelled while the permission/device was resolving.
    if (voiceState !== "preparing") return;
    const { mime, format } = pickRecorderType(
      typeof MediaRecorder.isTypeSupported === "function"
        ? (type) => MediaRecorder.isTypeSupported(type)
        : undefined,
    );
    voiceFormat = format;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch {
      releaseWarmStream();
      voiceState = "error";
      voiceError = "Could not start recording on this device.";
      return;
    }
    chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    // Only flip to "recording" once capture has actually begun — this is the
    // point from which audio is kept, so it's when the user may start speaking.
    recorder.onstart = () => {
      if (voiceState === "preparing") voiceState = "recording";
    };
    recorder.onstop = () => {
      void finishVoice();
    };
    // Flush data periodically so a quick start/stop still captures audio.
    recorder.start(250);
  }

  async function finishVoice() {
    const captured = chunks;
    chunks = [];
    releaseRecorder();
    if (!onTranscribe) {
      voiceState = "idle";
      return;
    }
    if (captured.length === 0) {
      voiceState = "error";
      voiceError = "Recording was too short. Hold the mic a little longer.";
      return;
    }
    const audio = new Blob(captured, {
      type: captured[0]?.type || "audio/webm",
    });
    voiceState = "transcribing";
    voiceStatus = "Transcribing your voice…";
    transcribeAbort = new AbortController();
    try {
      const text = await onTranscribe(
        audio,
        voiceFormat,
        transcribeAbort.signal,
        (stage) => {
          voiceStatus = stage.label;
        },
      );
      if (text) {
        const needsSpace = promptText.length > 0 && !/\s$/.test(promptText);
        promptText = promptText + (needsSpace ? " " : "") + text;
        voiceState = "idle";
      } else {
        // Empty result (silence or unintelligible) — say so instead of
        // appearing to do nothing.
        voiceState = "error";
        voiceError = "No speech detected. Try again and speak clearly.";
      }
    } catch (error) {
      if (transcribeAbort?.signal.aborted) {
        voiceState = "idle";
      } else {
        voiceState = "error";
        voiceError =
          error instanceof Error ? error.message : "Transcription failed.";
      }
    } finally {
      transcribeAbort = null;
    }
  }

  function stopVoice() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function cancelVoice() {
    // Stop recording or an in-flight transcription without inserting text.
    // The stream is kept warm (releaseRecorder) for a quick restart.
    transcribeAbort?.abort();
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => releaseRecorder();
      recorder.stop();
    } else {
      releaseRecorder();
    }
    chunks = [];
    voiceState = "idle";
  }

  function toggleVoice() {
    if (voiceState === "recording") stopVoice();
    else if (voiceState === "preparing" || voiceState === "transcribing")
      cancelVoice();
    else startVoice();
  }

  $effect(() => {
    // Abort any dictation and drop the warm stream if the composer becomes
    // disabled or starts loading — no reason to hold the mic open then.
    if (disabled || loading) {
      if (voiceState !== "idle") cancelVoice();
      releaseWarmStream();
    }
  });

  $effect(() => {
    // Release the microphone fully when the composer is destroyed.
    return () => {
      transcribeAbort?.abort();
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseWarmStream();
    };
  });

  async function submit() {
    if (voiceState === "recording") stopVoice();
    const submittedText = promptText;
    const trimmed = promptText.trim();
    if (!trimmed || loading || disabled) return;
    if ((await onSubmit?.(trimmed)) && promptText === submittedText) {
      promptText = "";
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<div class="composer" role="group" aria-label="Canvas prompt">
  <div class="composer__context">
    <span class="composer__scope" aria-live="polite">
      <span class="sr-only">Context:</span>{scope}
    </span>
    <button
      class="composer__disclose"
      type="button"
      aria-expanded={detailsOpen}
      aria-controls="composer-details"
      onclick={() => (detailsOpen = !detailsOpen)}
    >
      <Icon name={detailsOpen ? "expand_more" : "info"} size={16} />
      Context details
    </button>
  </div>
  {#if detailsOpen}
    <div id="composer-details" class="composer__details">
      <p>
        <strong>Provider:</strong>
        {provider || "Not configured — choose one in Settings"}
      </p>
      <ul>
        {#each details as line}<li>{line}</li>{/each}
      </ul>
      {#if notice}<p>{notice}</p>{/if}
    </div>
  {/if}
  <div class="composer__row">
    <button
      class="composer__lead"
      class:composer__lead--active={toolbarOpen}
      type="button"
      title="Canvas tools"
      aria-label="Canvas tools"
      aria-expanded={toolbarOpen}
      onclick={onToggleToolbar}
    >
      <Icon name="build" size={20} />
    </button>
    {#if onAddFile}
      <button
        class="composer__lead"
        type="button"
        title="Add a file — images, PDF, Word, and text files are copied onto the canvas"
        aria-label="Add a file"
        disabled={addFileDisabled}
        onclick={onAddFile}
      >
        <Icon name="attach_file" size={20} />
      </button>
    {/if}

    <label class="sr-only" for="canvas-prompt">Prompt</label>
    <textarea
      id="canvas-prompt"
      class="composer__input"
      rows="1"
      bind:value={promptText}
      onkeydown={onKeydown}
      {disabled}
      maxlength={LIMITS.text}
      {placeholder}></textarea>

    <div class="composer__tools">
      {#if voiceSupported && !loading}
        {@const micAction =
          voiceState === "recording"
            ? "Stop recording and transcribe"
            : voiceState === "preparing"
              ? "Starting microphone…"
              : voiceState === "transcribing"
                ? "Cancel transcription"
                : "Dictate with microphone"}
        {@const micLabel = micName ? `${micAction} (${micName})` : micAction}
        <button
          class="composer__mic"
          class:composer__mic--active={voiceState === "recording"}
          class:composer__mic--busy={voiceState === "preparing" ||
            voiceState === "transcribing"}
          type="button"
          title={micLabel}
          aria-label={micLabel}
          aria-pressed={voiceState === "recording"}
          disabled={disabled || loading}
          onclick={toggleVoice}
          onpointerenter={prewarmMic}
          onfocus={prewarmMic}
        >
          {#if voiceState === "preparing" || voiceState === "transcribing"}
            <span class="spinner" aria-hidden="true"></span>
          {:else}
            <Icon
              name={voiceState === "recording" ? "mic" : "mic_none"}
              size={20}
            />
          {/if}
        </button>
      {/if}
      {#if loading}<button
          type="button"
          class="btn btn--soft"
          onclick={onCancel}>Cancel</button
        >{/if}
      <button
        class="composer__send"
        type="button"
        title={loading ? "Generating response…" : "Send prompt (Enter)"}
        aria-label="Send prompt"
        disabled={disabled || loading || !promptText.trim()}
        onclick={submit}
      >
        {#if loading}
          <span class="spinner" aria-hidden="true"></span>
        {:else}
          <Icon name="arrow_upward" size={20} />
        {/if}
      </button>
    </div>
  </div>
  {#if voiceState === "preparing" || voiceState === "recording" || voiceState === "transcribing" || voiceState === "error"}
    <p
      class="composer__voice"
      class:composer__voice--error={voiceState === "error"}
      role={voiceState === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {#if voiceState === "preparing"}
        Starting microphone… wait to speak until it says recording.
      {:else if voiceState === "recording"}
        <Icon name="fiber_manual_record" size={14} />
        Recording… click the mic to stop and transcribe.
      {:else if voiceState === "transcribing"}
        {voiceStatus}
      {:else}
        {voiceError}
      {/if}
    </p>
  {/if}
</div>

<style>
  .composer__lead:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .composer__send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    border-color: var(--line);
    color: var(--muted);
  }

  .composer__send .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
  }

  .composer__mic {
    display: grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    flex: none;
    color: var(--ink-soft);
    background: var(--surface-soft);
    border: 1px solid var(--line);
    border-radius: 50%;
    cursor: pointer;
    transition:
      border-color 0.16s ease,
      color 0.16s ease,
      background 0.16s ease;
  }

  .composer__mic:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-strong);
  }

  .composer__mic:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .composer__mic--active {
    color: var(--accent-strong);
    background: var(--accent-soft);
    border-color: var(--accent);
    animation: composer-mic-pulse 1.4s ease-in-out infinite;
  }

  .composer__mic--busy {
    color: var(--accent-strong);
    border-color: var(--accent);
    cursor: default;
  }

  .composer__mic .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: composer-mic-spin 0.7s linear infinite;
  }

  .composer__voice {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    padding: 0 0.15rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .composer__voice--error {
    color: var(--bad, #d13438);
  }

  @keyframes composer-mic-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 var(--accent-soft);
    }
    50% {
      box-shadow: 0 0 0 4px transparent;
    }
  }

  @keyframes composer-mic-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .composer__mic--active {
      animation: none;
    }
    .composer__mic .spinner {
      animation-duration: 1.6s;
    }
  }
</style>
