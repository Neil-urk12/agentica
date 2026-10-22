import type { FileMime } from "@agentica/protocol";

/**
 * Pure file-type and byte helpers. This module has no transport or DOM
 * dependency, so node tests can import it directly.
 */

const MIME_BY_TYPE: Record<string, FileMime> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "image/svg+xml": "image/svg+xml",
  "application/pdf": "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword": "application/msword",
  "text/plain": "text/plain",
  "text/markdown": "text/markdown",
  "text/csv": "text/csv",
};

const MIME_BY_EXTENSION: Record<string, FileMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

/** `accept` for the file picker; one list keeps picker and validation aligned. */
export const FILE_ACCEPT = [
  ...Object.keys(MIME_BY_EXTENSION).map((extension) => `.${extension}`),
  ...Object.keys(MIME_BY_TYPE).filter((mime) => mime !== "image/jpg"),
].join(",");

export type FileKind = "image" | "pdf" | "docx" | "doc" | "text";

/** Normalize a browser-reported type, falling back to the filename extension. */
export function fileMime(file: {
  name: string;
  type?: string;
}): FileMime | undefined {
  const reported = MIME_BY_TYPE[file.type?.toLowerCase() ?? ""];
  if (reported) return reported;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension];
}

export function fileKind(mime: string): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/msword") return "doc";
  if (mime.includes("wordprocessingml")) return "docx";
  return "text";
}

export function fileKindLabel(mime: string): string {
  switch (fileKind(mime)) {
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "docx":
      return "Word document";
    case "doc":
      return "Word document";
    default:
      return "Text file";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Base64 without spreading a large file onto the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A contiguous ArrayBuffer for Blob, PDF.js, and mammoth. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
