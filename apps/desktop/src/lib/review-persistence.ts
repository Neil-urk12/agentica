import {
  ReviewRecordSchema,
  REVIEW_LIMITS,
  type ReviewRecord,
  type RuntimeParams,
  type RuntimeResult,
} from "@agentica/protocol";
import { fingerprint, type Draft } from "./changes";

export type ReviewCall = <
  M extends "changes.review.load" | "changes.review.save",
>(
  method: M,
  params: RuntimeParams<M>,
) => Promise<RuntimeResult<M>>;
export type ReviewScope = Pick<
  RuntimeParams<"changes.review.load">,
  "workspaceId" | "canvasId" | "projectId" | "tileId"
>;
export interface FeedbackSnapshot {
  drafts: Draft[];
  composing: Pick<Draft, "path" | "section" | "hunk"> | null;
  text: string;
}

async function record(draft: Draft): Promise<ReviewRecord> {
  const hunk = draft.hunk;
  return ReviewRecordSchema.parse({
    id: draft.id,
    order: draft.order ?? 0,
    path: draft.path,
    section: draft.section,
    hunk: hunk
      ? {
          header: hunk.header,
          range: hunk.range,
          fingerprint: hunk.fingerprint ?? (await fingerprint(hunk.text!)),
        }
      : null,
    comment: draft.comment,
    sent: draft.sent,
    outdated: draft.outdated,
  });
}

/** Serialized by ChangesState; acknowledgement tracks only committed records. */
export class ReviewPersistence {
  revision = 1;
  private saved = new Map<string, ReviewRecord>();
  private scope: ReviewScope;
  private call: ReviewCall;
  constructor(scope: ReviewScope, call: ReviewCall) {
    this.scope = scope;
    this.call = call;
  }

  async load(): Promise<FeedbackSnapshot> {
    const records = new Map<string, ReviewRecord>();
    let after: string | undefined;
    let revision: number | undefined;
    do {
      const page = await this.call("changes.review.load", {
        ...this.scope,
        ...(after ? { after, expectedRevision: revision } : {}),
      });
      if (revision !== undefined && revision !== page.revision)
        throw new Error("Review changed while loading. Retry.");
      revision = page.revision;
      if (page.record)
        records.set(page.record.id, ReviewRecordSchema.parse(page.record));
      if (
        records.size > REVIEW_LIMITS.records ||
        (page.next && page.next === after)
      )
        throw new Error("Invalid feedback page.");
      after = page.next ?? undefined;
    } while (after);
    this.revision = revision;
    this.saved = records;
    return this.snapshot();
  }

  snapshot(): FeedbackSnapshot {
    const records = this.saved;
    const composer = records.get("composer");
    return {
      drafts: [...records.values()]
        .filter((r) => r.id !== "composer")
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((r) => ({ ...r, unverified: !r.sent })),
      composing: composer
        ? {
            path: composer.path,
            section: composer.section,
            hunk: composer.hunk,
          }
        : null,
      text: composer?.comment ?? "",
    };
  }

  async save(snapshot: FeedbackSnapshot, alive: () => boolean) {
    const desired = new Map<string, ReviewRecord>();
    for (const draft of snapshot.drafts)
      desired.set(draft.id, await record(draft));
    if (snapshot.composing && snapshot.text.length)
      desired.set(
        "composer",
        await record({
          ...snapshot.composing,
          id: "composer",
          order: 0,
          comment: snapshot.text,
          sent: false,
          outdated: false,
        }),
      );
    if (
      desired.size > REVIEW_LIMITS.records ||
      snapshot.drafts.length > REVIEW_LIMITS.records - 1
    )
      throw new Error(
        "A review supports 200 comments and one composer. Remove or copy feedback.",
      );
    // Delete removed records first to free capacity. Composer removal is paired
    // with the new comment so a crash cannot restore both submitted forms.
    const removed = [...this.saved.keys()].filter((id) => !desired.has(id));
    const changed = [...desired.values()].filter(
      (r) => JSON.stringify(r) !== JSON.stringify(this.saved.get(r.id)),
    );
    const submitted = changed.find(
      (r) => r.id !== "composer" && !this.saved.has(r.id),
    );
    const clearComposer = !!submitted && this.saved.has("composer");
    if (
      clearComposer &&
      desired.has("composer") &&
      !changed.some((r) => r.id === "composer")
    )
      changed.push(desired.get("composer")!);
    const mutate = async (data: {
      record?: ReviewRecord;
      deleteId?: string;
    }) => {
      if (!alive()) throw new Error("Review was removed.");
      const result = await this.call("changes.review.save", {
        ...this.scope,
        expectedRevision: this.revision,
        ...data,
      });
      this.revision = result.revision;
      if (data.deleteId) this.saved.delete(data.deleteId);
      if (data.record) this.saved.set(data.record.id, data.record);
    };
    for (const id of removed)
      if (id !== "composer" || !submitted) await mutate({ deleteId: id });
    // Comments precede the composer, including a newly opened composer whose
    // text was typed while submission was waiting for an earlier save.
    changed.sort(
      (a, b) => Number(a.id === "composer") - Number(b.id === "composer"),
    );
    for (const item of changed)
      await mutate({
        record: item,
        ...(item === submitted && clearComposer
          ? { deleteId: "composer" }
          : {}),
      });
  }
}
