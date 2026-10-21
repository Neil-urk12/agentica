import type { ChangeEntry, ChangeSection, DiffHunk } from "@agentica/protocol";

/** One in-memory feedback draft. Drafts are never persisted. */
export interface Draft {
  id: string;
  path: string;
  section: ChangeSection;
  /** Hunk anchor; null for a whole-file comment. */
  hunk: { header: string; range: string; text: string } | null;
  comment: string;
  sent: boolean;
  outdated: boolean;
}

export const entryKey = (entry: Pick<ChangeEntry, "section" | "path">) =>
  `${entry.section}:${entry.path}`;

/** The `@@ -a,b +c,d @@` part of a hunk header, without trailing context. */
export const hunkRange = (header: string) =>
  /^@@ [^@]* @@/.exec(header)?.[0] ?? header;

/** Anchor snapshot; a refreshed hunk with other text marks its drafts outdated. */
export const hunkText = (hunk: DiffHunk) =>
  hunk.lines.map(([tag, text]) => tag + text).join("\n");

/** Hunk lines with old and new line numbers; null where a side is absent. */
export function numberLines(hunk: DiffHunk) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.lines.map(([tag, text, noNewline]) => ({
    tag,
    text,
    noNewline,
    old: tag === "+" ? null : oldLine++,
    new: tag === "-" ? null : newLine++,
  }));
}

/** Mirrors the backend paste sanitizer so the preview shows the exact bytes. */
export function sanitize(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cc}]/gu, (c) => (c === "\n" || c === "\t" ? c : ""));
}

/** The pasted message for unsent drafts, in the order they were written. */
export function feedbackMessage(drafts: Draft[]) {
  const unsent = drafts.filter((draft) => !draft.sent);
  const items = unsent.map((draft, index) => {
    const scope = draft.hunk ? draft.section : `${draft.section}, whole file`;
    const lines = [`${index + 1}. ${draft.path} (${scope})`];
    if (draft.hunk) lines.push(`   ${draft.hunk.range}`);
    for (const line of draft.comment.trim().split("\n"))
      lines.push(`   ${line}`);
    return lines.join("\n");
  });
  return sanitize(
    [
      `Review feedback (${unsent.length} item${unsent.length === 1 ? "" : "s"}):`,
      ...items,
    ].join("\n"),
  );
}
