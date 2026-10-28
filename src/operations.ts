// Anchored edit operations on CriticMarkup documents. Pure: every function takes the document
// text and a parse of it and returns edits carrying the text they expect to replace, so a caller
// can re-validate (rebase) against the live document before writing.

import { isChange, threadOf, type Mark, type ParseResult, type Thread } from "./parser";
import { buildComment, buildMark, buildSubstitution, encodeCommentText, formatAttrs, type MarkType } from "./syntax";

export interface Edit {
  from: number;
  to: number;
  insert: string;
  /** The text at [from, to) when the edit was computed. */
  expected: string;
}

export type Decision = "accept" | "reject";

export interface Attrs {
  [key: string]: string | null | undefined;
}

function edit(doc: string, from: number, to: number, insert: string): Edit {
  return { from, to, insert, expected: doc.slice(from, to) };
}

/** Apply non-overlapping edits computed against `doc`. */
export function applyEdits(doc: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = doc;
  for (const e of sorted) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** Re-validate an edit against a possibly changed document. Returns the adjusted edit or null. */
export function rebase(doc: string, e: Edit): Edit | null {
  if (doc.slice(e.from, e.to) === e.expected) return e;
  if (e.expected === "") return null; // pure insertion at a stale offset: refuse to guess
  const first = doc.indexOf(e.expected);
  if (first === -1) return null;
  const last = doc.lastIndexOf(e.expected);
  if (first !== last) {
    // Ambiguous: pick the occurrence nearest the original offset only if it is unique within a window.
    let best = -1;
    let bestDist = Infinity;
    let count = 0;
    let i = first;
    while (i !== -1) {
      const d = Math.abs(i - e.from);
      if (d < 400) count++;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
      i = doc.indexOf(e.expected, i + 1);
    }
    if (count !== 1) return null;
    return { ...e, from: best, to: best + e.expected.length };
  }
  return { ...e, from: first, to: first + e.expected.length };
}

export function rebaseAll(doc: string, edits: Edit[]): Edit[] | null {
  const out: Edit[] = [];
  for (const e of edits) {
    const r = rebase(doc, e);
    if (!r) return null;
    out.push(r);
  }
  // Reject overlapping results.
  const sorted = [...out].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].from < sorted[i - 1].to) return null;
  return out;
}

// ---------- Helpers ----------

/** Text that replaces a mark under a decision. */
export function resolution(mark: Mark, decision: Decision): string {
  switch (mark.type) {
    case "addition":
      return decision === "accept" ? mark.text : "";
    case "deletion":
      return decision === "accept" ? "" : mark.text;
    case "substitution":
      return decision === "accept" ? mark.newText ?? "" : mark.oldText ?? "";
    case "highlight":
      return mark.text;
    case "comment":
      return "";
  }
}

/** Widen a removal so it does not leave a double space or a blank line behind. */
function removalRange(doc: string, from: number, to: number): { from: number; to: number } {
  const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  let lineEnd = doc.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = doc.length;
  const beforeBlank = /^[ \t]*$/.test(doc.slice(lineStart, from));
  const afterBlank = /^[ \t]*$/.test(doc.slice(to, lineEnd));
  if (beforeBlank && afterBlank) {
    // The mark was the whole line: drop the line.
    if (lineEnd < doc.length) return { from: lineStart, to: lineEnd + 1 };
    if (lineStart > 0) return { from: lineStart - 1, to: lineEnd };
    return { from: lineStart, to: lineEnd };
  }
  if (doc[from - 1] === " " && doc[to] === " ") return { from, to: to + 1 };
  if (beforeBlank && doc[to] === " ") return { from, to: to + 1 };
  if (afterBlank) {
    // Mark at the end of a line: take the spaces before it with it.
    let f = from;
    while (f > lineStart && (doc[f - 1] === " " || doc[f - 1] === "\t")) f--;
    return { from: f, to };
  }
  return { from, to };
}

function replaceRange(doc: string, from: number, to: number, insert: string): Edit {
  if (insert === "") {
    const r = removalRange(doc, from, to);
    return edit(doc, r.from, r.to, "");
  }
  return edit(doc, from, to, insert);
}

function metaString(attrs: Attrs): string {
  const s = formatAttrs(attrs);
  return s ? s + " " : "";
}

// ---------- Decisions ----------

/** Accept or reject one change or highlight. A thread attached to it is removed with it. */
export function decideMark(doc: string, parsed: ParseResult, mark: Mark, decision: Decision): Edit[] {
  if (mark.type === "comment") return [];
  const thread = threadOf(parsed, mark);
  const to = thread ? thread.to : mark.to;
  return [replaceRange(doc, mark.from, to, resolution(mark, decision))];
}

/** Accept or reject every change (and optionally highlights). Standalone comments are kept. */
export function decideAll(doc: string, parsed: ParseResult, decision: Decision, include: (m: Mark) => boolean = isChange): Edit[] {
  const edits: Edit[] = [];
  for (const m of parsed.marks) {
    if (m.type === "comment" || !include(m)) continue;
    edits.push(...decideMark(doc, parsed, m, decision));
  }
  return edits;
}

/** Changes whose range overlaps [from, to]. */
export function changesInRange(parsed: ParseResult, from: number, to: number): Mark[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return parsed.marks.filter((m) => isChange(m) && m.to > lo && m.from < hi);
}

/** Accept or reject every change overlapping a selection. Highlights and comments are left alone. */
export function decideInRange(doc: string, parsed: ParseResult, from: number, to: number, decision: Decision): Edit[] {
  const ids = new Set(changesInRange(parsed, from, to).map((m) => m.id));
  return decideAll(doc, parsed, decision, (m) => ids.has(m.id));
}

/** Remove the highlight markup around a highlight, keeping its text and dropping its thread. */
export function removeHighlight(doc: string, parsed: ParseResult, mark: Mark): Edit[] {
  if (mark.type !== "highlight") return [];
  return decideMark(doc, parsed, mark, "accept");
}

// ---------- Comments and threads ----------

/** Remove a whole thread. A highlight anchor is unwrapped; a change anchor is left in place. */
export function deleteThread(doc: string, parsed: ParseResult, thread: Thread): Edit[] {
  const anchor = thread.anchor === null ? null : parsed.marks[thread.anchor];
  if (anchor && anchor.type === "highlight") return [edit(doc, anchor.from, thread.to, anchor.text)];
  if (anchor) return [edit(doc, anchor.to, thread.to, "")];
  return [replaceRange(doc, thread.from, thread.to, "")];
}

/** Remove one comment. Removing the last comment removes the thread. */
export function deleteComment(doc: string, parsed: ParseResult, comment: Mark): Edit[] {
  const thread = threadOf(parsed, comment);
  if (!thread) return [];
  if (thread.comments.length === 1) return deleteThread(doc, parsed, thread);
  const idx = thread.comments.indexOf(comment.id);
  if (idx === 0) {
    const next = parsed.marks[thread.comments[1]];
    const edits = [edit(doc, comment.from, next.from, "")];
    if (thread.resolved && (next.meta.status ?? "").toLowerCase() !== "resolved") {
      edits.push(setAttrsEdit(doc, next, { ...next.meta.attrs, status: "resolved" }));
    }
    return edits;
  }
  const prev = parsed.marks[thread.comments[idx - 1]];
  return [edit(doc, prev.to, comment.to, "")];
}

/** Rewrite a mark's attributes. The edit covers the whole mark so it can be relocated by content. */
function setAttrsEdit(doc: string, mark: Mark, attrs: Attrs): Edit {
  return edit(doc, mark.from, mark.to, "{" + metaString(attrs) + doc.slice(mark.metaTo, mark.to));
}

/** Replace the metadata prefix of a mark. */
export function setAttrs(doc: string, mark: Mark, attrs: Attrs): Edit[] {
  return [setAttrsEdit(doc, mark, attrs)];
}

export function setThreadStatus(doc: string, parsed: ParseResult, thread: Thread, status: string | null): Edit[] {
  const root = parsed.marks[thread.comments[0]];
  const attrs: Attrs = { ...root.meta.attrs };
  if (status) attrs.status = status;
  else delete attrs.status;
  return setAttrs(doc, root, attrs);
}

/** Append a reply. The edit re-states the thread's last comment so it is anchored by content, not offset. */
export function replyToThread(doc: string, parsed: ParseResult, thread: Thread, text: string, attrs: Attrs): Edit[] {
  const last = parsed.marks[thread.comments[thread.comments.length - 1]];
  return [edit(doc, last.from, last.to, doc.slice(last.from, last.to) + buildComment(text, { attrs }))];
}

/** Replace a comment's text, optionally stamping `edited`. One whole-mark edit, anchored by content. */
export function editComment(doc: string, comment: Mark, text: string, edited?: string | null): Edit[] {
  const attrs: Attrs = edited ? { ...comment.meta.attrs, edited } : comment.meta.attrs;
  const meta = edited ? metaString(attrs) : doc.slice(comment.metaFrom, comment.metaTo);
  const raw = "{" + meta + doc.slice(comment.metaTo, comment.contentFrom) + encodeCommentText(text) + doc.slice(comment.contentTo, comment.to);
  return [edit(doc, comment.from, comment.to, raw)];
}

// ---------- Authoring ----------

export interface InsertOptions {
  attrs?: Attrs;
  /** Substitution replacement text. */
  newText?: string;
  /** Comment text for comments (also used for the thread when commenting on a selection). */
  comment?: string;
}

export interface InsertResult {
  edits: Edit[];
  /** Suggested cursor position (in the post-edit document) when the user still has to type something. */
  cursor?: number;
  /** Selection to make after applying, when useful. */
  select?: { from: number; to: number };
}

export type InsertOutcome = InsertResult | { error: string };

function trimSelection(doc: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /\s/.test(doc[from])) from++;
  while (to > from && /\s/.test(doc[to - 1])) to--;
  return { from, to };
}

/** Marks that overlap [from, to) without fully containing it or being fully contained. */
function crossingMarks(parsed: ParseResult, from: number, to: number): Mark[] {
  return parsed.marks.filter((m) => m.to > from && m.from < to && !(m.from <= from && m.to >= to) && !(m.from >= from && m.to <= to));
}

function containingMark(parsed: ParseResult, from: number, to: number): Mark | null {
  for (const m of parsed.marks) if (m.from <= from && m.to >= to && !(from === to && (m.from === from || m.to === to))) return m;
  return null;
}

/** Wrap a selection in a mark, or insert an empty one at the cursor. */
export function insertMark(doc: string, parsed: ParseResult, selFrom: number, selTo: number, type: MarkType, opts: InsertOptions = {}): InsertOutcome {
  const attrs = opts.attrs ?? {};
  let { from, to } = trimSelection(doc, Math.min(selFrom, selTo), Math.max(selFrom, selTo));
  if (from === to) {
    from = to = selFrom;
  }

  if (crossingMarks(parsed, from, to).length) return { error: "The selection crosses an existing mark." };
  const container = containingMark(parsed, from, to);

  if (type === "comment") {
    const text = opts.comment ?? "";
    // Comment on an existing mark: attach to it (reply if it already has a thread).
    const target = container ?? exactMark(parsed, from, to);
    if (target) {
      // Attach to the mark, or reply to its thread: re-state the mark the comment follows, so the
      // edit is anchored by content rather than by offset.
      const thread = threadOf(parsed, target);
      const prev = thread ? parsed.marks[thread.comments[thread.comments.length - 1]] : target;
      const at = prev.to;
      const s = buildComment(text, { attrs });
      return { edits: [edit(doc, prev.from, prev.to, doc.slice(prev.from, prev.to) + s)], cursor: text ? undefined : at + s.length - 3 };
    }
    if (from === to) {
      const s = buildComment(text, { attrs });
      return { edits: [edit(doc, from, from, s)], cursor: text ? undefined : from + s.length - 3 };
    }
    // Comment on plain text: highlight it and attach the comment.
    const inner = marksInside(parsed, from, to);
    if (inner.length) return { error: "The selection contains marks; select text without marks or exactly one mark." };
    const hl = buildMark("highlight", doc.slice(from, to), { attrs });
    const c = buildComment(text, { attrs });
    return { edits: [edit(doc, from, to, hl + c)], cursor: text ? undefined : from + hl.length + c.length - 3 };
  }

  if (container) return { error: "The selection is inside an existing mark." };
  if (marksInside(parsed, from, to).length) return { error: "The selection contains marks." };

  const sel = doc.slice(from, to);
  switch (type) {
    case "addition": {
      const s = buildMark("addition", sel, { attrs });
      const prefixLen = s.length - sel.length - 3;
      return { edits: [edit(doc, from, to, s)], cursor: sel ? undefined : from + prefixLen, select: sel ? { from: from + prefixLen, to: from + prefixLen + sel.length } : undefined };
    }
    case "deletion": {
      if (!sel) return { error: "Select the text to delete." };
      const s = buildMark("deletion", sel, { attrs });
      return { edits: [edit(doc, from, to, s)], cursor: from + s.length };
    }
    case "highlight": {
      if (!sel) return { error: "Select the text to highlight." };
      const s = buildMark("highlight", sel, { attrs });
      return { edits: [edit(doc, from, to, s)], cursor: from + s.length };
    }
    case "substitution": {
      if (!sel) return { error: "Select the text to replace." };
      const newText = opts.newText ?? "";
      const s = buildSubstitution(sel, newText, { attrs });
      const cursor = newText ? from + s.length : from + s.length - 3;
      return { edits: [edit(doc, from, to, s)], cursor };
    }
  }
  return { error: "Unsupported mark type." };
}

function exactMark(parsed: ParseResult, from: number, to: number): Mark | null {
  for (const m of parsed.marks) if (m.from === from && m.to === to) return m;
  return null;
}

function marksInside(parsed: ParseResult, from: number, to: number): Mark[] {
  return parsed.marks.filter((m) => m.from >= from && m.to <= to);
}

// ---------- Whole-document transforms ----------

/** The document as a reader would see it with every change decided and all markup removed. */
export function plainText(doc: string, parsed: ParseResult, decision: Decision = "accept"): string {
  const edits: Edit[] = [];
  for (const m of parsed.marks) {
    if (m.type === "comment") {
      if (m.thread !== undefined && parsed.threads[m.thread].anchor !== null) continue; // removed with anchor
      if (m.thread !== undefined && parsed.threads[m.thread].comments[0] !== m.id) continue; // removed with root
      const t = m.thread === undefined ? null : parsed.threads[m.thread];
      edits.push(replaceRange(doc, m.from, t ? t.to : m.to, ""));
      continue;
    }
    edits.push(...decideMark(doc, parsed, m, decision));
  }
  return applyEdits(doc, edits);
}

/** Strict CriticMarkup: drop attribute prefixes, folding author and date into comment text. */
export function stripMetadata(doc: string, parsed: ParseResult): string {
  const edits: Edit[] = [];
  for (const m of parsed.marks) {
    if (m.metaTo > m.metaFrom) edits.push(edit(doc, m.metaFrom, m.metaTo, ""));
    if (m.type === "comment" && (m.meta.author || m.meta.date)) {
      const who = [m.meta.author, m.meta.date].filter(Boolean).join(" ");
      edits.push(edit(doc, m.contentFrom, m.contentFrom, `${who}: `));
    }
  }
  return applyEdits(doc, edits);
}
