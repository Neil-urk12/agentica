<script lang="ts">
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
</script>

<div class="flex h-dvh flex-col bg-slate-100 text-slate-800">
  <header
    class="flex items-center gap-5 border-b border-slate-200 bg-white px-6 py-4"
  >
    <span class="font-mono text-sm font-semibold tracking-tight">agentica</span>
    <span class="h-4 border-l border-slate-200" aria-hidden="true"></span>
    <h1 class="text-sm">Untitled canvas</h1>
  </header>

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
