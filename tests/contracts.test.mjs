import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  RunHistorySchema,
  RunEventSchema,
  ArtifactBatchSchema,
  AgentStartSchema,
  RunEventPageSchema,
  MAX_EVENT_PAGE_BYTES,
} from "@agentica/protocol";

test("normalized run events enforce correlation, bounds, and cancellation ordering", () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("./fixtures/run-events.json", import.meta.url),
      "utf8",
    ),
  );
  for (const fixture of fixtures)
    assert.equal(
      RunHistorySchema.safeParse(fixture.events).success,
      fixture.valid,
      fixture.name,
    );
  const started = fixtures[0].events[0];
  assert.equal(
    RunHistorySchema.safeParse(Array(129).fill(started)).success,
    false,
  );
  assert.equal(
    RunEventSchema.safeParse({
      ...started,
      sequence: Number.MAX_SAFE_INTEGER + 1,
    }).success,
    false,
  );
  const events = fixtures[0].events;
  assert.equal(
    RunEventPageSchema.safeParse({ events, nextSequence: 3 }).success,
    true,
  );
  assert.equal(
    RunEventPageSchema.safeParse({ events, nextSequence: 2 }).success,
    false,
  );
  const large = Array.from({ length: 16 }, (_, index) => ({
    ...started,
    sequence: index + 1,
    event: { type: "textDelta", text: "中".repeat(2000) },
  }));
  assert.equal(
    RunEventPageSchema.safeParse({ events: large, nextSequence: 16 }).success,
    false,
  );
  const page = {
    events: large
      .slice(0, 8)
      .map((event) => ({ ...event, event: { type: "textDelta", text: "x" } })),
    nextSequence: 8,
  };
  let remaining =
    MAX_EVENT_PAGE_BYTES - Buffer.byteLength(JSON.stringify(page));
  for (const event of page.events) {
    const extra = Math.min(remaining, 1999);
    event.event.text += "x".repeat(extra);
    remaining -= extra;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(page)), MAX_EVENT_PAGE_BYTES);
  assert.equal(RunEventPageSchema.safeParse(page).success, true);
  page.events.at(-1).event.text += "x";
  assert.equal(RunEventPageSchema.safeParse(page).success, false);
});

test("operation and agent scope bounds reject oversized and duplicate identities", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const operation = {
    op: "text.replace",
    artifactId: id,
    expectedRevision: 1,
    text: "new",
  };
  assert.equal(
    ArtifactBatchSchema.safeParse({
      workspaceId: id,
      canvasId: id,
      operations: Array(33).fill(operation),
    }).success,
    false,
  );
  assert.equal(
    AgentStartSchema.safeParse({
      workspaceId: id,
      canvasId: id,
      instructionArtifactId: id,
      readArtifactIds: Array(129).fill(id),
      writeArtifactIds: [],
    }).success,
    false,
  );
});
