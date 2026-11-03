<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import type { CanvasDocument } from "../editor";
  import { canvasMarkdown, downloadMarkdown } from "../canvas-export";
  import Icon from "./Icon.svelte";

  // `rail`: icon-only in the activity bar, with messages opening to its right.
  let { canvas, rail = false }: { canvas: CanvasDocument; rail?: boolean } =
    $props();
  let busy = $state(false);
  let message = $state("");
  let error = $state("");

  async function exportMarkdown() {
    if (busy) return;
    busy = true;
    message = "";
    error = "";
    try {
      // Serialize before awaiting delivery so later edits cannot change this file.
      const file = canvasMarkdown(canvas);
      if (isTauri()) {
        const saved = await invoke<boolean>("export_markdown", {
          markdown: file.markdown,
          suggestedName: file.filename,
        });
        if (saved) message = "Markdown exported.";
      } else {
        downloadMarkdown(file);
        message = "Markdown download requested.";
      }
    } catch (cause) {
      error = `Export failed: ${String(cause)}. Retry Export Markdown.`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="canvas-export" class:canvas-export--rail={rail}>
  <button
    class={rail ? "icon-btn" : "btn btn--soft"}
    type="button"
    aria-label="Export Markdown"
    aria-describedby="canvas-export-help"
    aria-busy={busy}
    disabled={busy}
    title="Share canvas notes as Markdown. Visual and live content is not included; note text is shared as written."
    onclick={() => void exportMarkdown()}
  >
    <Icon name="download" size={rail ? 20 : 18} />
    {#if !rail}
      <span class="label">{busy ? "Exporting…" : "Export Markdown"}</span>
    {/if}
  </button>
  <span id="canvas-export-help" class="sr-only">
    Export full canvas notes as Markdown. Visual and live content is not
    included. Note text is shared as written, including any sensitive text you
    added.
  </span>
  <span class="canvas-export__status" role="status" aria-live="polite"
    >{message}</span
  >
  {#if error}<span class="canvas-export__error" role="alert">{error}</span>{/if}
</div>

<style>
  .canvas-export {
    position: relative;
  }
  .canvas-export__status,
  .canvas-export__error {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 10;
    width: max-content;
    max-width: min(28rem, 80vw);
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .canvas-export--rail .canvas-export__status,
  .canvas-export--rail .canvas-export__error {
    top: 0;
    right: auto;
    left: calc(100% + 8px);
  }
  .canvas-export__status:empty {
    display: none;
  }
  .canvas-export__error {
    color: var(--bad);
  }
</style>
