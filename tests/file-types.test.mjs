import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILE_ACCEPT,
  base64ToBytes,
  bytesToBase64,
  capFileText,
  fileKind,
  fileKindLabel,
  fileMime,
  fileTextCoverage,
  formatFileSize,
} from "../apps/desktop/src/lib/file-types.ts";
import { FILE_LIMITS } from "@agentica/protocol";

test("extracted text records whether the cap omitted anything", () => {
  const limit = FILE_LIMITS.text;
  assert.deepEqual(capFileText("  hello \n"), {
    text: "hello",
    textStatus: "complete",
  });
  assert.deepEqual(capFileText(" \n\n "), { text: "", textStatus: "empty" });
  // Exactly at the cap is complete; one more character is truncated.
  assert.equal(capFileText("a".repeat(limit)).textStatus, "complete");
  assert.equal(capFileText("a".repeat(limit + 1)).textStatus, "truncated");
  // Trailing whitespace past the cap omits nothing.
  assert.equal(capFileText(`${"a".repeat(limit)}\n \n`).textStatus, "complete");
  // A PDF stopped with unread pages is truncated even at exactly the cap.
  assert.equal(capFileText("a".repeat(limit), true).textStatus, "truncated");
  // A surrogate pair straddling the cap is dropped whole, never split.
  const capped = capFileText(`${"a".repeat(limit - 1)}😀b`);
  assert.equal(capped.text, "a".repeat(limit - 1));
  assert.equal(capped.textStatus, "truncated");
  assert.equal(capFileText(`${"a".repeat(limit - 2)}😀`).text.length, limit);
});

test("document coverage has guidance, images use their own feedback", () => {
  assert.equal(fileTextCoverage("image/png", "unsupported"), undefined);
  assert.equal(
    fileTextCoverage("application/pdf", "complete")?.label,
    "All text read",
  );
  for (const status of [
    "truncated",
    "empty",
    "failed",
    "unsupported",
    "unknown",
  ]) {
    assert.ok(fileTextCoverage("application/pdf", status)?.guidance);
  }
});

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
