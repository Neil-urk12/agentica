<script lang="ts">
  import type { ChangeSection, SessionOwner } from "@agentica/protocol";
  import type { ChangesState } from "../changes-manager.svelte";
  import {
    entryKey,
    feedbackMessage,
    hunkRange,
    hunkText,
    numberLines,
  } from "../changes";
  import Icon from "./Icon.svelte";

  interface Props {
    /** Tile id; keeps element ids unique across tiles and the overlay. */
    uid: string;
    state: ChangesState;
    layout: "tile" | "overlay";
    targets: { owner: SessionOwner; label: string }[];
    pasting: boolean;
    onPaste: () => void;
  }
  let { uid, state, layout, targets, pasting, onPaste }: Props = $props();

  const SECTIONS: { id: ChangeSection; label: string }[] = [
    { id: "staged", label: "Staged" },
    { id: "unstaged", label: "Unstaged" },
    { id: "untracked", label: "Untracked" },
  ];
  const message = $derived(feedbackMessage(state.drafts));
  const composingFile = $derived(
    state.composing &&
      entryKey(state.composing) === state.selected &&
      !state.composing.hunk,
  );
  const composingIndex = $derived.by(() => {
    const anchor = state.composing;
    return anchor?.hunk &&
      entryKey(anchor) === state.selected &&
      state.diff?.kind === "text"
      ? state.diff.hunks.findIndex(
          (hunk) =>
            // Restored composers gain text only after validateDrafts checks the fingerprint.
            hunk.header === anchor.hunk!.header &&
            hunkText(hunk) === anchor.hunk!.text,
        )
      : -1;
  });
  const detachedDrafts = $derived(
    state.drafts.filter(
      (draft) =>
        !state.entries.some((entry) => entryKey(entry) === entryKey(draft)),
    ),
  );
  // Whole-file drafts, plus hunk drafts whose hunk no longer exists.
  const fileDrafts = $derived(
    state.drafts.filter(
      (draft) =>
        entryKey(draft) === state.selected &&
        (!draft.hunk ||
          state.diff?.kind !== "text" ||
          !state.diff.hunks.some((hunk) => hunk.header === draft.hunk?.header)),
    ),
  );
  const target = $derived(
    targets.find((t) => t.owner.tileId === state.target) ?? targets[0],
  );
  const canPaste = $derived(
    !!target &&
      state.unsent > 0 &&
      !pasting &&
      state.hydrated &&
      !state.loading,
  );
  const sent = $derived(state.drafts.some((draft) => draft.sent));
  const emptyText = $derived.by(() => {
    const status = state.status;
    if (!status)
      return state.loading
        ? "Reading changes…"
        : "Refresh runs read-only git status in this folder.";
    if (status.state === "notRepository")
      return "This folder is not a Git repository.";
    if (status.state === "folderUnavailable")
      return "The project folder is unavailable. Locate it, then refresh.";
    if (status.state === "gitUnavailable" || status.state === "failed")
      return status.message;
    return status.entries.length
      ? ""
      : "No changes. The working tree is clean.";
  });
  const showReview = $derived(
    !emptyText || state.drafts.length > 0 || state.composing !== null,
  );
  function editorKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // Close only the editor, not review mode.
      event.preventDefault();
      event.stopPropagation();
      state.cancelCompose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      state.saveDraft();
    }
  }
  // The editor opens from a button click; move focus after the canvas settles.
  function focusOnOpen(node: HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      // Tile and review mode share state; only the visible editor takes focus.
      const review = document.querySelector("dialog.review[open]");
      if (!review || review.contains(node)) node.focus();
    });
  }
  const sectionLabel = (section: ChangeSection) =>
    SECTIONS.find((s) => s.id === section)!.label;
</script>

{#snippet editor()}
  <div class="composer">
    {#if state.composing}
      <p class="muted">
        {state.composing.path} · {sectionLabel(state.composing.section)} · {state
          .composing.hunk?.range ?? "whole file"}
      </p>
    {/if}
    <label class="sr-only" for={`comment-${layout}-${uid}`}
      >Feedback comment</label
    >
    <textarea
      id={`comment-${layout}-${uid}`}
      rows="3"
      placeholder="Feedback for the agent"
      bind:value={state.composeText}
      onkeydown={editorKey}
      use:focusOnOpen></textarea>
    <div class="row">
      <button
        class="btn btn--soft"
        type="button"
        onclick={() => state.cancelCompose()}>Cancel</button
      >
      <button
        class="btn btn--primary"
        type="button"
        disabled={!state.composeText.trim()}
        onclick={() => state.saveDraft()}>Add comment</button
      >
    </div>
  </div>
{/snippet}

{#snippet draftList(drafts: typeof state.drafts)}
  {#each drafts as draft (draft.id)}
    <div class="draft" class:sent={draft.sent}>
      <p>{draft.comment}</p>
      <span class="badges">
        {#if draft.sent}<span
            class="badge"
            title="Pasted into the agent; running it is not confirmed"
            >Sent</span
          >{/if}
        {#if draft.outdated && !draft.sent}<span class="badge badge--warn"
            >Outdated</span
          >{/if}
        {#if draft.unverified && !draft.outdated && !draft.sent}<span
            class="badge badge--warn">Unverified</span
          >{/if}
        <button
          class="icon-btn"
          type="button"
          aria-label="Remove comment"
          onclick={() => state.remove(draft.id)}
          ><Icon name="close" size={14} /></button
        >
      </span>
    </div>
  {/each}
{/snippet}

{#snippet diffBody()}
  {#if state.composing && !composingFile && composingIndex === -1}
    {@render editor()}
  {/if}
  {#if state.entry}
    <div class="file-bar">
      <span class="file-name" title={state.entry.path}
        ><span class="status">{state.entry.status}</span>{state.entry
          .path}{#if state.entry.origPath}
          <span class="muted">← {state.entry.origPath}</span>{/if}</span
      >
      <button
        class="btn btn--soft"
        type="button"
        disabled={!state.hydrated}
        onclick={() => state.compose("file")}>Comment on file</button
      >
    </div>
    {#if composingFile}{@render editor()}{/if}
    {@render draftList(fileDrafts)}
    {#if state.diffLoading}
      <p class="notice">Loading diff…</p>
    {:else if state.diff}
      {@const diff = state.diff}
      {#if "notes" in diff && diff.notes.length}
        <p class="notice">{diff.notes.join(" · ")}</p>
      {/if}
      {#if diff.kind === "text"}
        {#each diff.hunks as hunk, index (index)}
          {@const numbers = numberLines(hunk)}
          <div class="hunk">
            <div class="hunk-head">
              <code>{hunk.header}</code>
              <button
                class="btn btn--soft"
                type="button"
                disabled={!state.hydrated}
                aria-label={`Comment on hunk ${hunkRange(hunk.header)}`}
                onclick={() => state.compose(index)}>+ Comment</button
              >
            </div>
            {#if composingIndex === index}{@render editor()}{/if}
            {@render draftList(
              state.drafts.filter(
                (draft) =>
                  entryKey(draft) === state.selected &&
                  draft.hunk?.header === hunk.header,
              ),
            )}
            <table class="lines">
              <tbody>
                {#each numbers as { tag, text, noNewline, old, new: next }, line (line)}
                  <tr class:add={tag === "+"} class:del={tag === "-"}>
                    <td class="num">{old ?? ""}</td>
                    <td class="num">{next ?? ""}</td>
                    <td class="mark"
                      ><span aria-hidden="true">{tag}</span
                      >{#if tag !== " "}<span class="sr-only"
                          >{tag === "+" ? "Added" : "Removed"}</span
                        >{/if}</td
                    >
                    <td class="code"
                      >{text.replace(/\r$/, "␍")}{#if noNewline}<span
                          class="muted"
                        >
                          ⏎ no newline at end of file</span
                        >{/if}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/each}
      {:else if diff.kind === "binary"}
        <p class="notice">Binary file; no text diff.</p>
      {:else if diff.kind === "tooLarge"}
        <p class="notice">This diff is too large to show (over 1 MiB).</p>
      {:else if diff.kind === "missing"}
        <p class="notice">This file is no longer listed. Refresh.</p>
      {:else if diff.kind === "notRepository"}
        <p class="notice">This folder is not a Git repository.</p>
      {:else if diff.kind === "folderUnavailable"}
        <p class="notice">The project folder is unavailable.</p>
      {:else if diff.kind === "gitUnavailable" || diff.kind === "failed"}
        <p class="notice" role="alert">{diff.message}</p>
      {/if}
    {/if}
  {/if}
{/snippet}

{#snippet pastePanel()}
  <div class="paste-row">
    <label for={`target-${layout}-${uid}`}>Target</label>
    <select
      id={`target-${layout}-${uid}`}
      value={target?.owner.tileId ?? ""}
      disabled={!targets.length}
      onchange={(event) => (state.target = event.currentTarget.value)}
    >
      {#if !targets.length}<option value="">No running agent</option>{/if}
      {#each targets as option (option.owner.tileId)}
        <option value={option.owner.tileId}>{option.label}</option>
      {/each}
    </select>
  </div>
{/snippet}

<div class={`changes changes--${layout}`}>
  <div class="notices">
    <p class="notice" role="status">
      Feedback: {state.hydrating
        ? "Loading…"
        : state.saveError
          ? state.hydrated
            ? "Couldn't save"
            : "Couldn't load"
          : state.dirty || state.saving
            ? "Saving…"
            : state.hydrated
              ? "Saved"
              : "Not loaded"}
    </p>
    {#if state.saveError}
      <p class="notice" role="alert">{state.saveError}</p>
      {#if state.conflicted}
        <label
          >Copy local feedback before reloading<textarea
            readonly
            value={state.recoveryText()}
            aria-label="Local feedback recovery"></textarea></label
        >
        <button
          class="btn btn--soft"
          type="button"
          onclick={() => {
            if (
              window.confirm(
                "Reload saved feedback and discard local edits? Copy your feedback first.",
              )
            )
              void state.reloadReview();
          }}>Reload saved feedback</button
        >
      {:else}
        <button
          class="btn btn--soft"
          type="button"
          onclick={() => void state.retrySave()}
          >{state.hydrated
            ? "Retry feedback save"
            : "Retry loading feedback"}</button
        >
      {/if}
    {/if}
    {#if state.error}<p class="notice" role="alert">{state.error}</p>{/if}
    {#if state.notice}<p class="notice notice--ok" role="status">
        {state.notice}
      </p>{/if}
    {#if state.status?.state === "ready" && state.status.truncated}
      <p class="notice" role="status">
        Changes list is incomplete; some entries were omitted.
      </p>
    {/if}
    {#if emptyText}
      <p class="notice">{emptyText}</p>
    {/if}
  </div>
  {#if showReview && layout === "tile"}
    {#if !emptyText}
      <div class="picker">
        <label class="sr-only" for={`changes-file-${uid}`}>Changed file</label>
        <select
          id={`changes-file-${uid}`}
          value={state.selected}
          onchange={(event) => void state.select(event.currentTarget.value)}
        >
          {#each SECTIONS as section (section.id)}
            {@const items = state.entries.filter(
              (e) => e.section === section.id,
            )}
            {#if items.length}
              <optgroup label={`${section.label} (${items.length})`}>
                {#each items as entry (entryKey(entry))}
                  <option value={entryKey(entry)}
                    >{entry.status} {entry.path}</option
                  >
                {/each}
              </optgroup>
            {/if}
          {/each}
        </select>
      </div>
    {/if}
    <div class="diff">
      {@render diffBody()}
      {#each detachedDrafts as draft (draft.id)}
        <p class="muted">
          {draft.path} · {sectionLabel(draft.section)} · {draft.hunk?.range ??
            "whole file"}
        </p>
        {@render draftList([draft])}
      {/each}
    </div>
    <footer class="foot">
      <span class="count">{state.unsent} feedback</span>
      {@render pastePanel()}
      {#if sent}<button
          class="btn btn--soft"
          type="button"
          onclick={() => state.clearSent()}>Clear</button
        >{/if}
      <button
        class="btn btn--primary"
        type="button"
        disabled={!state.unsent || !state.hydrated || state.loading}
        aria-expanded={state.previewing}
        onclick={() => (state.previewing = !state.previewing)}
        >Preview &amp; paste</button
      >
    </footer>
    {#if state.previewing}
      <div class="preview">
        <pre aria-label="Message preview">{message}</pre>
        <div class="row">
          <button
            class="btn btn--soft"
            type="button"
            onclick={() => (state.previewing = false)}>Cancel</button
          >
          <button
            class="btn btn--primary"
            type="button"
            disabled={!canPaste}
            title={target ? "" : "Start an agent tile in this project first."}
            onclick={onPaste}
            >{pasting
              ? "Pasting…"
              : `Paste into ${target?.label ?? "agent"}`}</button
          >
        </div>
      </div>
    {/if}
  {:else if showReview}
    <nav class="tree" aria-label="Changed files">
      {#each SECTIONS as section (section.id)}
        {@const items = state.entries.filter((e) => e.section === section.id)}
        {#if items.length}
          <h3>{section.label} <span class="muted">{items.length}</span></h3>
          <ul>
            {#each items as entry (entryKey(entry))}
              <li>
                <button
                  type="button"
                  class:active={entryKey(entry) === state.selected}
                  aria-current={entryKey(entry) === state.selected
                    ? "true"
                    : undefined}
                  title={entry.path}
                  onclick={() => void state.select(entryKey(entry))}
                  ><span class="status">{entry.status}</span
                  >{entry.path}</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    </nav>
    <div class="diff">{@render diffBody()}</div>
    <aside class="panel" aria-label="Feedback">
      <h3>Feedback <span class="muted">{state.unsent} unsent</span></h3>
      <ol class="feedback">
        {#each state.drafts as draft (draft.id)}
          <li class:sent={draft.sent}>
            <button
              type="button"
              class="link"
              onclick={() =>
                void state.select(`${draft.section}:${draft.path}`)}
              >{draft.path}</button
            >
            <span class="muted"
              >{sectionLabel(draft.section)} · {draft.hunk
                ? draft.hunk.range
                : "whole file"}</span
            >
            {@render draftList([draft])}
          </li>
        {:else}
          <li class="muted">Add a comment on a file or hunk.</li>
        {/each}
      </ol>
      <h3>Message preview</h3>
      <pre aria-label="Message preview">{message}</pre>
      {@render pastePanel()}
      <div class="row">
        {#if sent}<button
            class="btn btn--soft"
            type="button"
            onclick={() => state.clearSent()}>Clear</button
          >{/if}
        <button
          class="btn btn--primary"
          type="button"
          disabled={!canPaste}
          title={target ? "" : "Start an agent tile in this project first."}
          onclick={onPaste}
          >{pasting
            ? "Pasting…"
            : `Paste into ${target?.label ?? "agent"}`}</button
        >
      </div>
    </aside>
  {/if}
</div>

<style>
  .changes {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    font-size: 13px;
    color: var(--ink);
  }
  .changes--overlay {
    display: grid;
    grid-template-columns: minmax(180px, 260px) 1fr minmax(260px, 340px);
    grid-template-rows: auto 1fr;
    gap: 0;
  }
  .changes--overlay > .notices {
    grid-column: 1 / -1;
  }
  .changes--overlay .tree,
  .changes--overlay .diff,
  .changes--overlay .panel {
    grid-row: 2;
    min-height: 0;
    overflow: auto;
  }
  .tree {
    border-right: 1px solid var(--line-strong);
    padding: 8px;
  }
  .tree h3,
  .panel h3 {
    margin: 10px 4px 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .tree ul,
  .feedback {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tree li button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .tree li button:hover {
    background: var(--surface-soft);
  }
  .tree li button.active {
    background: var(--accent-soft);
    color: var(--ink);
  }
  .panel {
    border-left: 1px solid var(--line-strong);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .feedback li {
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .picker {
    padding: 6px 10px;
    border-bottom: 1px solid var(--line-strong);
  }
  select,
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-soft);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    padding: 4px 6px;
    font: inherit;
  }
  .diff {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 10px;
  }
  .file-bar,
  .hunk-head,
  .row,
  .paste-row,
  .foot {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .file-bar {
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .file-name {
    font-family: var(--mono, ui-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    display: inline-block;
    min-width: 1.4em;
    color: var(--accent);
    font-family: var(--mono, ui-monospace, monospace);
    font-weight: 600;
  }
  .hunk {
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .hunk-head {
    justify-content: space-between;
    padding: 4px 6px 4px 10px;
    background: var(--surface-soft);
    border-bottom: 1px solid var(--line-strong);
  }
  .hunk-head code {
    color: var(--ink-soft);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lines {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 18px;
  }
  .lines td {
    padding: 0 6px;
    vertical-align: top;
  }
  .num {
    width: 1%;
    text-align: right;
    color: var(--muted);
    user-select: none;
    white-space: nowrap;
  }
  .mark {
    width: 1%;
    user-select: none;
  }
  .code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  tr.add {
    background: var(--ok-soft);
  }
  tr.add .mark {
    color: var(--ok);
  }
  tr.del {
    background: var(--bad-soft);
  }
  tr.del .mark {
    color: var(--bad);
  }
  .composer {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    justify-content: flex-end;
  }
  .draft {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    justify-content: space-between;
    margin: 4px 6px;
    padding: 4px 6px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
  }
  .draft p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sent,
  .draft.sent {
    opacity: 0.55;
  }
  .badges {
    display: flex;
    gap: 4px;
    align-items: center;
    flex: none;
  }
  .badge {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    color: var(--ink-soft);
  }
  .badge--warn {
    color: var(--warn);
    border-color: var(--warn-line);
    background: var(--warn-soft);
  }
  .foot {
    flex: none;
    padding: 6px 10px;
    border-top: 1px solid var(--line-strong);
    background: var(--surface);
  }
  .foot .count {
    flex: none;
    color: var(--ink-soft);
  }
  .paste-row {
    flex: 1;
    min-width: 0;
  }
  .panel .paste-row {
    flex: none;
  }
  .paste-row label {
    color: var(--ink-soft);
  }
  .preview {
    flex: none;
    max-height: 45%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--line-strong);
  }
  pre {
    margin: 0;
    padding: 8px;
    overflow: auto;
    background: var(--surface-soft);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    font-size: 12px;
    white-space: pre-wrap;
    user-select: text;
  }
  .notice {
    margin: 0;
    padding: 6px 10px;
    color: var(--ink-soft);
    font-size: 12px;
  }
  .notice--ok {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .muted {
    color: var(--muted);
    font-weight: normal;
  }
  .btn {
    padding: 3px 8px;
    font-size: 12px;
    min-height: 28px;
    flex: none;
  }
  .icon-btn {
    width: 22px;
    height: 22px;
  }
</style>
