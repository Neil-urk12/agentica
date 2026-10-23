import type {
  ChangeEntry,
  ChangesDiff,
  ChangesStatus,
  RuntimeParams,
  RuntimeResult,
} from "@agentica/protocol";
import {
  entryKey,
  hunkRange,
  hunkText,
  fingerprint,
  type Draft,
} from "./changes";
import { ReviewPersistence, type ReviewCall } from "./review-persistence";

type Call = <
  M extends
    | "changes.status"
    | "changes.diff"
    | "changes.review.load"
    | "changes.review.save",
>(
  method: M,
  params: RuntimeParams<M>,
) => Promise<RuntimeResult<M>>;
export interface ChangesScope {
  workspaceId: string;
  canvasId: string;
  projectId: string;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Per-tile review state, shared by the tile and its full-screen review mode. */
export class ChangesState {
  status = $state.raw<ChangesStatus | null>(null);
  loading = $state(false);
  error = $state("");
  selected = $state("");
  diff = $state.raw<ChangesDiff | null>(null);
  diffLoading = $state(false);
  drafts = $state<Draft[]>([]);
  /** Snapshot the anchor before refresh can replace the selected file or diff. */
  composing = $state<Pick<Draft, "path" | "section" | "hunk"> | null>(null);
  private text = $state("");
  get composeText() {
    return this.text;
  }
  set composeText(value: string) {
    this.text = value;
    this.changed(false);
  }
  hydrated = $state(false);
  hydrating = $state(false);
  saving = $state(false);
  dirty = $state(false);
  saveError = $state("");
  conflicted = $state(false);
  private generation = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private hydration: Promise<void> | null = null;
  private persistence: ReviewPersistence;
  target = $state("");
  notice = $state("");
  previewing = $state(false);
  private loadToken = 0;

  get entries(): ChangeEntry[] {
    return this.status?.state === "ready" ? this.status.entries : [];
  }
  get entry() {
    return this.entries.find((entry) => entryKey(entry) === this.selected);
  }
  get unsent() {
    return this.drafts.filter((draft) => !draft.sent).length;
  }

  constructor(
    readonly scope: ChangesScope,
    private call: Call,
    tileId: string,
  ) {
    this.persistence = new ReviewPersistence(
      { ...scope, tileId },
      call as ReviewCall,
    );
  }

  hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydration) return this.hydration;
    this.hydrating = true;
    this.saveError = "";
    this.hydration = this.persistence
      .load()
      .then((snapshot) => {
        if (this.disposed) return;
        this.drafts = snapshot.drafts;
        this.composing = snapshot.composing;
        this.text = snapshot.text;
        this.hydrated = true;
      })
      .catch((error) => {
        this.saveError = message(error);
      })
      .finally(() => {
        this.hydrating = false;
        this.hydration = null;
      });
    return this.hydration;
  }

  private changed(immediate = true) {
    if (!this.hydrated || this.disposed) return;
    this.generation++;
    this.dirty = true;
    clearTimeout(this.timer);
    if (this.saveError) return;
    this.timer = setTimeout(() => void this.flush(), immediate ? 0 : 300);
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.flight) {
      await this.flight;
      return this.saveError ? false : this.flush();
    }
    // Unloaded tiles hold no local edits, so a failed load never blocks leaving.
    if (this.disposed || !this.hydrated) return true;
    if (this.conflicted || this.saveError) return false;
    if (!this.dirty) return true;
    this.saving = true;
    this.flight = (async () => {
      while (this.dirty && !this.disposed) {
        const generation = this.generation;
        const snapshot = JSON.parse(
          JSON.stringify({
            drafts: this.drafts,
            composing: this.composing,
            text: this.text,
          }),
        );
        await this.persistence.save(snapshot, () => !this.disposed);
        if (generation === this.generation) this.dirty = false;
      }
    })()
      .catch((error) => {
        if (!this.disposed) {
          this.saveError = message(error);
          this.conflicted =
            !!error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "CONFLICT";
        }
      })
      .finally(() => {
        this.saving = false;
        this.flight = null;
      });
    await this.flight;
    return this.disposed || (!this.dirty && !this.saveError);
  }

  async retrySave() {
    if (this.conflicted) return;
    this.saveError = "";
    return this.hydrated ? this.flush() : this.refresh();
  }
  async reloadReview() {
    if (this.flight) await this.flight;
    this.hydrated = false;
    this.conflicted = false;
    this.saveError = "";
    this.dirty = false;
    await this.refresh();
  }
  recoveryText() {
    return JSON.stringify(
      { drafts: this.drafts, composing: this.composing, text: this.text },
      null,
      2,
    );
  }
  cancelCompose() {
    this.composing = null;
    this.text = "";
    this.changed();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  async refresh() {
    await this.hydrate();
    this.loading = true;
    this.error = "";
    try {
      this.status = await this.call("changes.status", this.scope);
      const entries = this.entries;
      for (const draft of this.drafts)
        if (!draft.sent) {
          draft.unverified = true;
          if (
            this.status.state === "ready" &&
            !this.status.truncated &&
            !entries.some((e) => entryKey(e) === entryKey(draft))
          ) {
            if (!draft.outdated) {
              draft.outdated = true;
              this.changed();
            }
            draft.unverified = false;
          }
          if (
            !draft.hunk &&
            entries.some((e) => entryKey(e) === entryKey(draft))
          )
            draft.unverified = false;
        }
      if (!entries.some((entry) => entryKey(entry) === this.selected))
        this.selected = entries[0] ? entryKey(entries[0]) : "";
      const selected = this.selected;
      await Promise.all([
        this.loadDiff(),
        ...entries
          .filter(
            (entry) =>
              entryKey(entry) !== selected &&
              this.drafts.some(
                (draft) =>
                  !draft.sent &&
                  draft.hunk &&
                  entryKey(draft) === entryKey(entry),
              ),
          )
          .map(async (entry) => {
            const { diff } = await this.readDiff(entry);
            await this.validateDrafts(entry, diff);
          }),
      ]);
    } catch (error) {
      this.error = message(error);
    } finally {
      this.loading = false;
    }
  }

  async select(key: string) {
    if (key === this.selected && this.diff) return;
    this.saveDraft();
    this.selected = key;
    this.composing = null;
    await this.loadDiff();
  }

  private async loadDiff() {
    const entry = this.entry;
    const token = ++this.loadToken;
    this.diff = null;
    if (!entry) return;
    this.diffLoading = true;
    try {
      const { diff } = await this.readDiff(entry);
      if (token !== this.loadToken) return;
      this.diff = diff;
      await this.validateDrafts(entry, diff);
    } catch (error) {
      if (token === this.loadToken) this.error = message(error);
    } finally {
      if (token === this.loadToken) this.diffLoading = false;
    }
  }

  private readDiff(entry: ChangeEntry) {
    return this.call("changes.diff", {
      ...this.scope,
      section: entry.section,
      path: entry.path,
      ...(entry.section === "staged" && entry.origPath
        ? { origPath: entry.origPath }
        : {}),
    });
  }

  private async validateDrafts(entry: ChangeEntry, diff: ChangesDiff) {
    const hunks = diff.kind === "text" ? diff.hunks : [];
    const hashes = await Promise.all(
      hunks.map(async (h) => ({
        header: h.header,
        fingerprint: await fingerprint(hunkText(h)),
      })),
    );
    // A restored composer keeps only a fingerprint; recover its text on a match.
    const anchor = this.composing?.hunk;
    if (
      anchor &&
      anchor.text === undefined &&
      entryKey(this.composing!) === entryKey(entry)
    ) {
      const match = hunks.find(
        (h, i) =>
          h.header === anchor.header &&
          hashes[i]?.fingerprint === anchor.fingerprint,
      );
      if (match) anchor.text = hunkText(match);
    }
    for (const draft of this.drafts) {
      if (draft.sent || !draft.hunk || entryKey(draft) !== entryKey(entry))
        continue;
      const verified =
        ["text", "empty", "binary", "missing"].includes(diff.kind) &&
        !("notes" in diff && diff.notes.length);
      draft.unverified = !verified;
      const wanted =
        draft.hunk.fingerprint ?? (await fingerprint(draft.hunk.text!));
      if (
        verified &&
        !hashes.some(
          (h) => h.header === draft.hunk!.header && h.fingerprint === wanted,
        ) &&
        !draft.outdated
      ) {
        draft.outdated = true;
        this.changed();
      }
    }
  }

  compose(where: number | "file") {
    if (!this.hydrated) return;
    const entry = this.entry;
    if (!entry) return;
    const hunk =
      typeof where === "number" && this.diff?.kind === "text"
        ? this.diff.hunks[where]
        : undefined;
    if (typeof where === "number" && !hunk) return;
    this.saveDraft();
    this.composing = {
      path: entry.path,
      section: entry.section,
      hunk: hunk
        ? {
            header: hunk.header,
            range: hunkRange(hunk.header),
            text: hunkText(hunk),
          }
        : null,
    };
    this.composeText = "";
  }

  /** Save against the original anchor, even if refresh has removed it. */
  saveDraft() {
    if (!this.hydrated) return;
    const anchor = this.composing;
    const comment = this.composeText.trim();
    if (!anchor || !comment) return;
    const outdated =
      (this.status?.state === "ready" &&
        !this.status.truncated &&
        !this.entries.some((entry) => entryKey(entry) === entryKey(anchor))) ||
      (!!anchor.hunk &&
        entryKey(anchor) === this.selected &&
        this.diff !== null &&
        (this.diff.kind !== "text" ||
          !this.diff.hunks.some(
            (hunk) =>
              hunk.header === anchor.hunk!.header &&
              hunkText(hunk) === anchor.hunk!.text,
          )));
    this.drafts.push({
      ...anchor,
      id: crypto.randomUUID(),
      order: Math.max(0, ...this.drafts.map((d) => d.order ?? 0)) + 1,
      comment,
      sent: false,
      outdated,
      unverified: true,
    });
    this.composing = null;
    this.composeText = "";
    this.changed();
    if (this.entry && this.diff)
      void this.validateDrafts(this.entry, this.diff);
  }

  remove(id: string) {
    this.drafts = this.drafts.filter((draft) => draft.id !== id);
    this.changed();
  }
  clearSent() {
    this.drafts = this.drafts.filter((draft) => !draft.sent);
    this.changed();
  }
  markSent(ids: string[]) {
    for (const draft of this.drafts)
      if (ids.includes(draft.id)) draft.sent = true;
    this.previewing = false;
    this.changed();
  }
}

/** Owns Changes state for the app's lifetime, keyed by tile id. */
export class ChangesManager {
  private tiles = new Map<string, ChangesState>();
  constructor(private call: Call) {}

  get(tileId: string, scope: ChangesScope) {
    let state = this.tiles.get(tileId);
    if (!state) {
      state = new ChangesState(scope, this.call, tileId);
      this.tiles.set(tileId, state);
    }
    return state;
  }
  peek(tileId: string) {
    return this.tiles.get(tileId);
  }
  forget(tileId: string) {
    this.tiles.get(tileId)?.dispose();
    this.tiles.delete(tileId);
  }
  forgetScope(workspaceId: string, canvasId?: string) {
    for (const [id, state] of this.tiles)
      if (
        state.scope.workspaceId === workspaceId &&
        (canvasId === undefined || state.scope.canvasId === canvasId)
      )
        this.forget(id);
  }
  /** Drop state for tiles that were removed from an open canvas. */
  prune(canvasId: string, liveTileIds: string[]) {
    for (const [id, state] of this.tiles)
      if (state.scope.canvasId === canvasId && !liveTileIds.includes(id))
        this.forget(id);
  }
  /** Feedback lost on removal or unload, including active composer text. */
  pending(tileIds?: string[]) {
    return [...this.tiles.entries()]
      .filter(([id]) => !tileIds || tileIds.includes(id))
      .reduce(
        (total, [, state]) =>
          total +
          state.unsent +
          Number(!!state.composing && !!state.composeText.trim()),
        0,
      );
  }
  unsaved() {
    return [...this.tiles.values()].some(
      (state) => state.dirty || state.saving,
    );
  }
  async flush() {
    const results = await Promise.all(
      [...this.tiles.values()].map((state) => state.flush()),
    );
    return results.every(Boolean);
  }
}
