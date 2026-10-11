<script lang="ts">
  import { onMount } from "svelte";
  import { desktopMode, pingRuntime } from "./lib/runtime";
  import {
    Background,
    Controls,
    SvelteFlow,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let connectionKey = $state("");
  let status = $state<"disconnected" | "connecting" | "connected" | "failed">(
    "disconnected",
  );
  let message = $state(
    desktopMode
      ? "Starting backend…"
      : "Start the backend and paste its connection key.",
  );
  let busy = $state(false);
  let alive = true;

  async function checkConnection(connect = false) {
    if (busy) return;
    busy = true;
    if (connect) {
      status = "connecting";
      message = "Connecting to backend…";
    }
    try {
      await pingRuntime(connectionKey.trim(), connect);
      if (alive) {
        status = "connected";
        message = "Backend connected";
      }
    } catch (error) {
      if (alive) {
        status = "failed";
        message =
          error instanceof TypeError
            ? "Backend unavailable. Start pnpm dev:backend, then reconnect."
            : typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : "Backend unavailable. Restart it, then reconnect.";
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    if (desktopMode) void checkConnection(true);
    const heartbeat = setInterval(() => {
      if (status === "connected") void checkConnection();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(heartbeat);
    };
  });
</script>

<div class="flex h-dvh flex-col bg-slate-100 text-slate-800">
  <header
    class="flex flex-wrap items-center gap-5 border-b border-slate-200 bg-white px-6 py-4"
  >
    <span class="font-mono text-sm font-semibold tracking-tight">agentica</span>
    <span class="h-4 border-l border-slate-200" aria-hidden="true"></span>
    <h1 class="text-sm">Untitled canvas</h1>
    <form
      class="ml-auto flex flex-wrap items-center gap-3 text-sm"
      onsubmit={(event) => {
        event.preventDefault();
        void checkConnection(true);
      }}
    >
      <span class="text-slate-500"
        >{desktopMode ? "Desktop" : "Browser"} mode</span
      >
      {#if !desktopMode}
        <label class="sr-only" for="connection-key"
          >Backend connection key</label
        >
        <input
          id="connection-key"
          type="password"
          bind:value={connectionKey}
          maxlength="64"
          placeholder="Backend connection key"
          autocomplete="off"
          spellcheck="false"
          class="w-52 rounded border border-slate-300 px-3 py-2"
        />
      {/if}
      <button
        type="submit"
        disabled={busy || (!desktopMode && !connectionKey.trim())}
        class="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
        >{status === "connecting"
          ? "Connecting…"
          : status === "disconnected"
            ? "Connect"
            : "Reconnect"}</button
      >
    </form>
  </header>
  <div
    role="status"
    aria-live="polite"
    class="border-b border-slate-200 bg-white px-6 py-2 text-sm"
    class:text-red-700={status === "failed"}
    class:text-green-700={status === "connected"}
  >
    {message}
  </div>

  <main class="relative min-h-0 flex-1" aria-label="Canvas workspace">
    <SvelteFlow bind:nodes bind:edges>
      <Background patternColor="#cbd5e1" gap={24} />
      <Controls showLock={false} />
    </SvelteFlow>
    <div
      class="pointer-events-none absolute inset-0 grid place-content-center text-center"
    >
      <p class="text-xl font-medium tracking-tight">Room to think.</p>
      <p class="mt-2 text-sm text-slate-500">
        An open space for your next idea.
      </p>
    </div>
  </main>
</div>
