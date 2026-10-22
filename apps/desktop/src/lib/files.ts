import { FILE_LIMITS, type FileMime } from "@agentica/protocol";
import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes, fileKind, toArrayBuffer } from "./file-types";
import { callRuntime, desktopMode } from "./runtime";

export {
  FILE_ACCEPT,
  base64ToBytes,
  bytesToBase64,
  fileKind,
  fileKindLabel,
  fileMime,
  formatFileSize,
  toArrayBuffer,
  type FileKind,
} from "./file-types";

/**
 * Canvas file helpers. Files are copied into workspace storage in bounded
 * chunks; only extracted text is part of canvas context. Previews are loaded on
 * demand so opening a canvas with a large PDF does not read every byte.
 */

export interface LoadedFile {
  name: string;
  mime: FileMime;
  size: number;
  data: string;
}

// Bound the cache: each entry can hold a multi-megabyte base64 preview.
const LOADED_LIMIT = 6;
const loaded = new Map<string, Promise<LoadedFile>>();

/** File bytes never change for an artifact, so previews share one read. */
export function readCanvasFile(
  connectionKey: string,
  workspaceId: string,
  artifactId: string,
): Promise<LoadedFile> {
  const cacheKey = `${workspaceId}:${artifactId}`;
  const existing = loaded.get(cacheKey);
  if (existing) return existing;
  const request = callRuntime(connectionKey, false, "file.read", {
    workspaceId,
    artifactId,
  }).then(({ name, mime, size, data }) => ({ name, mime, size, data }));
  if (loaded.size >= LOADED_LIMIT) {
    const oldest = loaded.keys().next().value;
    if (oldest !== undefined) loaded.delete(oldest);
  }
  loaded.set(cacheKey, request);
  request.catch(() => loaded.delete(cacheKey));
  return request;
}

/** Open with the OS application on desktop, or save a copy in a browser. */
export async function openCanvasFile(
  connectionKey: string,
  workspaceId: string,
  artifactId: string,
) {
  if (desktopMode) {
    await invoke("open_file", { workspaceId, artifactId });
    return;
  }
  const file = await readCanvasFile(connectionKey, workspaceId, artifactId);
  const url = URL.createObjectURL(
    new Blob([toArrayBuffer(base64ToBytes(file.data))], { type: file.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Text shared with the agent and shown by Read; bounded by the protocol. */
export async function extractFileText(
  file: File,
  mime: FileMime,
): Promise<string> {
  const kind = fileKind(mime);
  if (kind === "image" || kind === "doc") return "";
  try {
    if (kind === "text") {
      return (await file.text()).slice(0, FILE_LIMITS.text).trim();
    }
    if (kind === "pdf") {
      return (await pdfText(new Uint8Array(await file.arrayBuffer())))
        .slice(0, FILE_LIMITS.text)
        .trim();
    }
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    return result.value.slice(0, FILE_LIMITS.text).trim();
  } catch {
    // A preview can still open; extraction must not block the import.
    return "";
  }
}

interface Mammoth {
  extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string }>;
  convertToHtml(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string }>;
}

async function loadMammoth(): Promise<Mammoth> {
  const module = await import("mammoth");
  return ((module as unknown as { default?: Mammoth }).default ??
    module) as unknown as Mammoth;
}

/** Renderable Word HTML for the preview frame; scripts stay blocked there. */
export async function docxHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await loadMammoth();
  const result = await mammoth.convertToHtml({
    arrayBuffer: toArrayBuffer(bytes),
  });
  return result.value;
}

let pdfWorker: Promise<void> | undefined;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfWorker ??= import("pdfjs-dist/build/pdf.worker.min.mjs?url").then(
    (worker) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    },
  );
  await pdfWorker;
  return pdfjs;
}

export async function openPdf(bytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: toArrayBuffer(bytes) });
  const pdf = await task.promise;
  return { pdf, destroy: () => task.destroy() };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const document = await openPdf(bytes);
  const pdf = document.pdf;
  let text = "";
  try {
    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages && text.length < FILE_LIMITS.text;
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      text += "\n";
    }
  } finally {
    await document.destroy();
  }
  return text;
}
