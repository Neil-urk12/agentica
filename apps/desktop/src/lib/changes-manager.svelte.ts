import type {
  ChangeEntry,
  ChangesDiff,
  ChangesStatus,
  RuntimeParams,
  RuntimeResult,
} from "@agentica/protocol";
import { entryKey, hunkRange, hunkText, type Draft } from "./changes";

type Call = <M extends "changes.status" | "changes.diff">(
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
  composeText = $state("");
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
  ) {}

  async refresh() {
    this.loading = true;
    this.error = "";
    try {
      this.status = await this.call("changes.status", this.scope);
      const entries = this.entries;
      // Drafts for files that no longer have changes in their section are outdated.
      for (const draft of this.drafts)
        if (
          !draft.sent &&
          !entries.some((e) => entryKey(e) === entryKey(draft))
        )
          draft.outdated = true;
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
            this.validateDrafts(entry, diff);
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
      this.validateDrafts(entry, diff);
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

  private validateDrafts(entry: ChangeEntry, diff: ChangesDiff) {
    const hunks = diff.kind === "text" ? diff.hunks : [];
    for (const draft of this.drafts)
      if (
        !draft.sent &&
        draft.hunk &&
        entryKey(draft) === entryKey(entry) &&
        !hunks.some(
          (hunk) =>
            hunk.header === draft.hunk!.header &&
            hunkText(hunk) === draft.hunk!.text,
        )
      )
        draft.outdated = true;
  }

  compose(where: number | "file") {
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
    const anchor = this.composing;
    const comment = this.composeText.trim();
    if (!anchor || !comment) return;
    const outdated =
      !this.entries.some((entry) => entryKey(entry) === entryKey(anchor)) ||
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
      comment,
      sent: false,
      outdated,
    });
    this.composing = null;
    this.composeText = "";
  }

  remove(id: string) {
    this.drafts = this.drafts.filter((draft) => draft.id !== id);
  }
  clearSent() {
    this.drafts = this.drafts.filter((draft) => !draft.sent);
  }
  markSent(ids: string[]) {
    for (const draft of this.drafts)
      if (ids.includes(draft.id)) draft.sent = true;
    this.previewing = false;
  }
}

/** Owns Changes state for the app's lifetime, keyed by tile id. */
export class ChangesManager {
  private tiles = new Map<string, ChangesState>();
  constructor(private call: Call) {}

  get(tileId: string, scope: ChangesScope) {
    let state = this.tiles.get(tileId);
    if (!state) {
      state = new ChangesState(scope, this.call);
      this.tiles.set(tileId, state);
    }
    return state;
  }
  peek(tileId: string) {
    return this.tiles.get(tileId);
  }
  forget(tileId: string) {
    this.tiles.delete(tileId);
  }
  forgetScope(workspaceId: string, canvasId?: string) {
    for (const [id, state] of this.tiles)
      if (
        state.scope.workspaceId === workspaceId &&
        (canvasId === undefined || state.scope.canvasId === canvasId)
      )
        this.tiles.delete(id);
  }
  /** Drop state for tiles that were removed from an open canvas. */
  prune(canvasId: string, liveTileIds: string[]) {
    for (const [id, state] of this.tiles)
      if (state.scope.canvasId === canvasId && !liveTileIds.includes(id))
        this.tiles.delete(id);
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
}
