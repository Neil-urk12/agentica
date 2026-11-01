import type { Artifact } from "@agentica/protocol";
import type { ImageInput } from "./canvas-harness.ts";
import {
  base64ToBytes,
  fileKind,
  formatFileSize,
  toArrayBuffer,
} from "./file-types.ts";

/**
 * Selected-image chat input. These caps are local product choices that keep a
 * request bounded; they are not promises about any provider's capacity.
 */
export const IMAGE_INPUT = Object.freeze({
  count: 4,
  bytes: 2 * 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
  mimes: ["image/png", "image/jpeg", "image/webp"] as readonly string[],
});

type FileArtifact = Extract<Artifact, { type: "file" }>;

/** Importable image types chat cannot send; any other is named by its MIME type. */
const UNSENDABLE_IMAGE: Record<string, string> = {
  "image/gif": "a GIF",
  "image/svg+xml": "an SVG",
};

/** No browser decoder exists, so decodability cannot be proven. */
class DecoderUnavailable extends Error {}

/** File artifacts behind the selected nodes, once each, in selection order. */
export function selectedFileArtifacts(
  document:
    | {
        nodes: readonly { id: string; artifactId: string }[];
        artifacts: readonly Artifact[];
      }
    | null
    | undefined,
  nodeIds: readonly string[],
): FileArtifact[] {
  if (!document) return [];
  const files = new Map<string, FileArtifact>();
  for (const id of nodeIds) {
    const node = document.nodes.find((item) => item.id === id);
    const artifact = document.artifacts.find((a) => a.id === node?.artifactId);
    if (artifact?.type === "file" && !files.has(artifact.id))
      files.set(artifact.id, artifact);
  }
  return [...files.values()];
}

/**
 * Images to send and every format, size, or count problem, checked from stored
 * metadata before anything is loaded. Any problem rejects the whole request.
 */
export function imagePreflight(files: readonly FileArtifact[]): {
  images: FileArtifact[];
  problems: string[];
} {
  const images = files.filter((file) => fileKind(file.mime) === "image");
  const problems: string[] = [];
  for (const image of images) {
    if (!IMAGE_INPUT.mimes.includes(image.mime))
      problems.push(
        `${image.name} is ${UNSENDABLE_IMAGE[image.mime] ?? `an unsupported image type (${image.mime})`}; chat can send PNG, JPEG, or WebP images only. Convert or deselect it.`,
      );
    else if (image.size > IMAGE_INPUT.bytes)
      problems.push(
        `${image.name} is ${formatFileSize(image.size)}; each image sent to chat must be at most ${formatFileSize(IMAGE_INPUT.bytes)}. Use a smaller image or deselect it.`,
      );
  }
  if (images.length > IMAGE_INPUT.count)
    problems.push(
      `${images.length} images are selected; chat can send at most ${IMAGE_INPUT.count} at once. Select fewer images.`,
    );
  const total = images.reduce((sum, image) => sum + image.size, 0);
  if (total > IMAGE_INPUT.totalBytes && images.length <= IMAGE_INPUT.count)
    problems.push(
      `The selected images total ${formatFileSize(total)}; chat can send at most ${formatFileSize(IMAGE_INPUT.totalBytes)} of images per prompt. Select fewer or smaller images.`,
    );
  return { images, problems };
}

function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (mime === "image/png")
    return (
      bytes.length > 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, index) => bytes[index] === byte,
      )
    );
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp")
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  return false;
}

/** Browser decode check; a corrupt image must fail here, not at the provider. */
async function browserDecode(bytes: Uint8Array, mime: string) {
  // Fail closed: without a decoder the image cannot be proven decodable.
  if (typeof createImageBitmap !== "function") throw new DecoderUnavailable();
  const bitmap = await createImageBitmap(
    new Blob([toArrayBuffer(bytes)], { type: mime }),
  );
  bitmap.close();
}

/**
 * Load the preflighted images through the existing file reader and validate
 * type, size, signature, and decodability. Any failure rejects the whole set
 * with the file's name; data URLs never appear in errors.
 */
export async function prepareImages(
  images: readonly FileArtifact[],
  load: (
    artifactId: string,
  ) => Promise<{ mime: string; size: number; data: string }>,
  signal: AbortSignal,
  decode: (bytes: Uint8Array, mime: string) => Promise<void> = browserDecode,
): Promise<readonly ImageInput[]> {
  const prepared: ImageInput[] = [];
  let total = 0;
  for (const image of images) {
    signal.throwIfAborted();
    const failed = (reason: string) =>
      new Error(
        `${image.name} could not be attached: ${reason} Nothing was sent.`,
      );
    let file: { mime: string; size: number; data: string };
    try {
      file = await load(image.id);
    } catch {
      signal.throwIfAborted();
      throw failed("it could not be loaded from the workspace.");
    }
    signal.throwIfAborted();
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(file.data);
    } catch {
      throw failed("its stored bytes are unreadable.");
    }
    total += bytes.length;
    if (
      file.mime !== image.mime ||
      !IMAGE_INPUT.mimes.includes(file.mime) ||
      bytes.length !== file.size ||
      bytes.length !== image.size ||
      bytes.length > IMAGE_INPUT.bytes ||
      total > IMAGE_INPUT.totalBytes
    )
      throw failed("its stored type or size no longer matches the canvas.");
    if (!signatureMatches(file.mime, bytes))
      throw failed("it is not a valid PNG, JPEG, or WebP image.");
    try {
      await decode(bytes, file.mime);
    } catch (error) {
      signal.throwIfAborted();
      throw failed(
        error instanceof DecoderUnavailable
          ? "this window cannot decode images, so the image could not be checked. Update the app or use a current browser."
          : "it could not be decoded as an image.",
      );
    }
    signal.throwIfAborted();
    prepared.push(
      Object.freeze({
        artifactId: image.id,
        name: image.name,
        dataUrl: `data:${file.mime};base64,${file.data}`,
      }),
    );
  }
  return Object.freeze(prepared);
}
