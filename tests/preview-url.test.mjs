import assert from "node:assert/strict";
import { test } from "node:test";
import { previewUrlAllowed } from "../apps/desktop/src/lib/preview-url.ts";
import { WebPreviewArtifactSchema } from "@agentica/protocol";

test("stored IPv6 previews remain readable but cannot navigate", () => {
  for (const url of ["http://[::1]:5173/app", "https://[::1]/app"]) {
    assert.equal(
      WebPreviewArtifactSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        type: "web-preview",
        schemaVersion: 1,
        revision: 1,
        url,
      }).success,
      true,
    );
    assert.equal(previewUrlAllowed(url, []), false);
  }
  for (const host of ["localhost", "127.0.0.1"]) {
    assert.equal(previewUrlAllowed(`http://${host}:5173/app`, []), true);
  }
});

test("preview endpoint exclusions cover loopback aliases and default ports", () => {
  const endpoints = ["http://127.0.0.1:1421", "https://localhost"];
  for (const url of [
    "http://localhost:1421/path",
    "http://[::1]:1421",
    "https://127.0.0.1:443/",
  ]) {
    assert.equal(previewUrlAllowed(url, endpoints), false, url);
  }
  assert.equal(
    previewUrlAllowed("http://localhost:5173/path?x=1#y", endpoints),
    true,
  );
  assert.equal(
    previewUrlAllowed("http://localhost:5173/path?x=1#y", [
      "http://127.0.0.1:5173",
    ]),
    false,
  );
  assert.equal(previewUrlAllowed("http://127.1:5173", endpoints), false);
});
