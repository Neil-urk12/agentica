<script lang="ts">
  import { untrack } from "svelte";
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";
  import {
    base64ToBytes,
    docxHtml,
    fileKind,
    fileKindLabel,
    formatFileSize,
    openPdf,
    type LoadedFile,
  } from "../files";
  import Icon from "./Icon.svelte";

  interface Props {
    selected?: boolean;
    data: {
      name: string;
      mime: string;
      size: number;
      text: string;
      preview?: boolean;
      connectable?: boolean;
      editable?: boolean;
      onResize?: (width: number, height: number) => void;
      onRead?: () => void;
      onOpen?: () => void;
      load: () => Promise<LoadedFile>;
    };
  }
  let { data, selected = false }: Props = $props();

  let loading = $state(false);
  let error = $state("");
  let imageUrl = $state("");
  let docHtml = $state("");
  let frame = $state<HTMLElement>();
  let canvas = $state<HTMLCanvasElement>();
  let pageNumber = $state(1);
  let pageCount = $state(0);
  let hasPreview = $state(false);
  // PDF.js proxy objects stay outside reactive state; a page counter drives UI.
  let pdf: Awaited<ReturnType<typeof openPdf>> | null = null;

  const kind = $derived(fileKind(data.mime));
  const icon = $derived(
    kind === "image"
      ? "image"
      : kind === "pdf"
        ? "picture_as_pdf"
        : kind === "text"
          ? "article"
          : "description",
  );

  const DOCX_STYLE = `
    :root { color-scheme: light; }
    body { margin: 0; padding: 16px 20px; font: 13px/1.55 Georgia, "Times New Roman", serif; color: #23201c; background: #fffdf8; }
    h1 { font-size: 1.5em; margin: 0 0 .6em; } h2 { font-size: 1.25em; } h3 { font-size: 1.1em; }
    p { margin: 0 0 .75em; } table { border-collapse: collapse; }
    td, th { border: 1px solid #d8d0c2; padding: 3px 6px; }
    img { max-width: 100%; height: auto; }
  `;

  async function renderPage() {
    try {
      if (!pdf || kind !== "pdf") return;
      const page = await pdf.pdf.getPage(
        Math.min(Math.max(1, pageNumber), pdf.pdf.numPages),
      );
      const target = canvas;
      if (!target) return;
      const width = Math.max(120, (frame?.clientWidth ?? 320) - 2);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      target.width = Math.max(1, Math.round(viewport.width));
      target.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas: target, viewport }).promise;
    } catch {
      // A resize or unmount can cancel a render after its page was destroyed.
    }
  }

  $effect(() => {
    const current = kind;
    void data.name;
    // Callback identity changes when the canvas re-renders; the artifact does not.
    const load = untrack(() => data.load);
    if (current === "text" || current === "doc") return;
    let cancelled = false;
    loading = true;
    error = "";
    load()
      .then(async (file) => {
        if (cancelled) return;
        if (current === "image") {
          imageUrl = `data:${file.mime};base64,${file.data}`;
          hasPreview = true;
        } else if (current === "pdf") {
          pdf = await openPdf(base64ToBytes(file.data));
          if (cancelled) {
            void pdf.destroy().catch(() => undefined);
            pdf = null;
            return;
          }
          pageCount = pdf.pdf.numPages;
          hasPreview = true;
          await renderPage();
        } else if (current === "docx") {
          docHtml = `<style>${DOCX_STYLE}</style><article class="docx">${await docxHtml(
            base64ToBytes(file.data),
          )}</article>`;
          hasPreview = true;
        }
        if (!cancelled) loading = false;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        loading = false;
        error =
          cause instanceof Error
            ? cause.message
            : "The preview could not load.";
      });
    return () => {
      cancelled = true;
      if (pdf) {
        void pdf.destroy().catch(() => undefined);
        pdf = null;
      }
    };
  });

  $effect(() => {
    const element = frame;
    if (!element || kind !== "pdf") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void renderPage(), 120);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  });

  async function step(delta: number) {
    pageNumber = Math.min(Math.max(1, pageNumber + delta), pageCount || 1);
    await renderPage();
  }
</script>

<NodeResizer
  isVisible={selected && !data.preview && !!data.editable}
  minWidth={LIMITS.minSize}
  minHeight={LIMITS.minSize}
  maxWidth={LIMITS.maxSize}
  maxHeight={LIMITS.maxSize}
  onResizeEnd={(_, params) => data.onResize?.(params.width, params.height)}
/>
<div
  class="file"
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
  class:file--bare={kind === "image"}
>
  <Handle type="target" position={Position.Top} />
  <div class="card-head file__head">
    {#if data.preview}<span class="chip chip--proposal">Proposed</span>{/if}
    <span class="card-role">
      <Icon name={icon} size={14} />
      <span class="file__name" title={data.name}>{data.name}</span>
    </span>
    <span class="file__size">{formatFileSize(data.size)}</span>
    {#if data.onRead && !data.preview}
      <button
        class="card-action nodrag"
        type="button"
        title="Read extracted text"
        aria-label={`Read text from ${data.name}`}
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onRead}
      >
        <Icon name="open_in_full" size={16} />
      </button>
    {/if}
    {#if data.onOpen && !data.preview}
      <button
        class="card-action nodrag"
        type="button"
        title="Open the file"
        aria-label={`Open ${data.name}`}
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onOpen}
      >
        <Icon name="open_in_new" size={16} />
      </button>
    {/if}
  </div>

  <div class="file__body" bind:this={frame}>
    {#if loading}
      <p class="file__note">Loading preview…</p>
    {:else if error}
      <p class="file__note" role="status">
        <Icon name="warning" size={16} />
        {error}
      </p>
    {:else if kind === "image" && imageUrl}
      <img
        class="file__image"
        src={imageUrl}
        alt={data.name}
        draggable="false"
      />
    {:else if kind === "pdf" && hasPreview}
      <canvas
        class="file__page"
        bind:this={canvas}
        aria-label={`Page ${pageNumber} of ${data.name}`}
      ></canvas>
      <div class="file__pager nodrag">
        <button
          type="button"
          title="Previous page"
          aria-label="Previous page"
          disabled={pageNumber <= 1}
          onclick={() => void step(-1)}
          ><Icon name="chevron_left" size={16} /></button
        >
        <span>{pageNumber} / {pageCount}</span>
        <button
          type="button"
          title="Next page"
          aria-label="Next page"
          disabled={pageNumber >= pageCount}
          onclick={() => void step(1)}
          ><Icon name="chevron_right" size={16} /></button
        >
      </div>
    {:else if kind === "docx" && docHtml}
      <iframe
        class="file__docx"
        title={`${data.name} preview`}
        sandbox="allow-same-origin"
        srcdoc={docHtml}
        referrerpolicy="no-referrer"
        tabindex="-1"
      ></iframe>
    {:else if kind === "text"}
      <pre class="file__text">{data.text || "This file is empty."}</pre>
    {:else if kind === "doc"}
      <p class="file__note">
        <Icon name="description" size={16} />
        Legacy Word files have no in-app preview. Use Open.
      </p>
    {:else}
      <p class="file__note">No preview is available for this file.</p>
    {/if}
  </div>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .file {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .file.preview {
    border-style: dashed;
    border-color: var(--accent);
  }
  .file__head {
    flex: none;
    min-width: 0;
  }
  .file__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 15rem;
  }
  .file__size {
    flex: none;
    color: var(--muted);
    font-size: 11px;
  }
  .file__body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--surface) 82%, var(--bg));
  }
  .file__image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .file__page {
    display: block;
    max-width: 100%;
    height: auto;
    background: #fff;
  }
  .file__pager {
    position: sticky;
    bottom: 6px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    border: 1px solid var(--border);
    font-size: 11px;
  }
  .file__pager button {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    color: inherit;
    background: none;
    cursor: pointer;
  }
  .file__pager button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .file__docx {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fffdf8;
    pointer-events: none;
  }
  .file__text {
    margin: 0;
    padding: 12px 14px;
    width: 100%;
    height: 100%;
    overflow: auto;
    font: 12px/1.5 var(--mono, ui-monospace, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    align-self: stretch;
  }
  .file__note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 16px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }
  .handles-hidden :global(.svelte-flow__handle) {
    display: none;
  }
  .file--bare .file__head {
    background: color-mix(in srgb, var(--surface) 92%, transparent);
  }
</style>
