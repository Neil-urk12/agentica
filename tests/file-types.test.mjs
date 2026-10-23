import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILE_ACCEPT,
  base64ToBytes,
  bytesToBase64,
  fileKind,
  fileKindLabel,
  fileMime,
  formatFileSize,
} from "../apps/desktop/src/lib/file-types.ts";

test("file types are normalized from the reported MIME or the extension", () => {
  assert.equal(fileMime({ name: "photo.PNG", type: "" }), "image/png");
  assert.equal(fileMime({ name: "scan", type: "image/jpeg" }), "image/jpeg");
  assert.equal(fileMime({ name: "report.pdf", type: "" }), "application/pdf");
  assert.equal(
    fileMime({ name: "brief.docx", type: "" }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    fileMime({ name: "legacy.doc", type: "" }),
    "application/msword",
  );
  assert.equal(fileMime({ name: "notes.md", type: "" }), "text/markdown");
  assert.equal(fileMime({ name: "data.csv", type: "" }), "text/csv");
  // Unknown, executable, and extensionless files stay unsupported.
  assert.equal(fileMime({ name: "script.exe", type: "" }), undefined);
  assert.equal(fileMime({ name: "README", type: "" }), undefined);
  assert.equal(
    fileMime({ name: "archive.zip", type: "application/zip" }),
    undefined,
  );
  assert.match(FILE_ACCEPT, /\.pdf/);
  assert.match(FILE_ACCEPT, /\.docx/);
  assert.match(FILE_ACCEPT, /application\/pdf/);
  assert.doesNotMatch(FILE_ACCEPT, /\.exe/);
});

test("file kinds drive previews and labels", () => {
  for (const [mime, kind, label] of [
    ["image/svg+xml", "image", "Image"],
    ["application/pdf", "pdf", "PDF"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
      "Word document",
    ],
    ["application/msword", "doc", "Word document"],
    ["text/plain", "text", "Text file"],
    ["text/csv", "text", "Text file"],
  ]) {
    assert.equal(fileKind(mime), kind);
    assert.equal(fileKindLabel(mime), label);
  }
});

test("file sizes roll over to MB when the KB value rounds to 1024", () => {
  assert.equal(formatFileSize(1047552), "1023 KB");
  assert.equal(formatFileSize(1048063), "1023 KB");
  assert.equal(formatFileSize(1048064), "1.0 MB");
  assert.equal(formatFileSize(1048575), "1.0 MB");
  assert.equal(formatFileSize(1048576), "1.0 MB");
});

test("file sizes are compact and base64 round-trips multi-chunk bytes", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(999), "999 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(30 * 1024), "30 KB");
  assert.equal(formatFileSize(2.5 * 1024 * 1024), "2.5 MB");

  // Exercise both sides of the 32 KiB conversion window, including NUL and high bytes.
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
  const encoded = bytesToBase64(bytes);
  assert.equal(Buffer.from(encoded, "base64").length, bytes.length);
  assert.deepEqual(base64ToBytes(encoded), bytes);
  assert.equal(bytesToBase64(new Uint8Array()), "");
});
