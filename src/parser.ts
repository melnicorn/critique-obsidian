// CriticMarkup parser with attribute-prefix metadata, thread grouping and code skipping.
// Pure: no Obsidian imports, so it runs in node tests.

import { CLOSER, META_PAIR_SOURCE, OPENER, SUB_SEPARATOR, decodeCommentText, isChangeType, type MarkType } from "./syntax";

export interface Meta {
  author: string | null;
  date: string | null;
  edited: string | null;
  status: string | null;
  label: string | null;
  /** Every pair, keys lowercased, first occurrence wins. */
  attrs: Record<string, string>;
}

export interface Mark {
  /** Index in ParseResult.marks. */
  id: number;
  type: MarkType;
  /** Offset of the opening brace. */
  from: number;
  /** Offset just past the closing brace. */
  to: number;
  /** Raw metadata prefix range (may be empty): starts after `{`, ends where the opener starts. */
  metaFrom: number;
  metaTo: number;
  /** Content range between opener and closer. */
  contentFrom: number;
  contentTo: number;
  /** Raw content. For substitutions this is `old~>new`; for comments it is the encoded text. */
  text: string;
  /** Substitution only: offset of the `~>` separator. */
  sepFrom?: number;
  oldText?: string;
  newText?: string;
  meta: Meta;
  /** 0-based line of the opening brace. */
  line: number;
  /** Comments: the thread they belong to. */
  thread?: number;
  /** Non-comments: the thread anchored directly after this mark, if any. */
  anchoredThread?: number;
}

export interface Thread {
  id: number;
  /** Mark ids of the comments, in order; the first is the root. */
  comments: number[];
  /** Mark id of the highlight or change this thread is attached to. */
  anchor: number | null;
  /** Range covering the comments only. */
  from: number;
  to: number;
  resolved: boolean;
}

export interface ParseResult {
  text: string;
  marks: Mark[];
  threads: Thread[];
}

export interface ParseOptions {
  /** Ignore marks that start inside code blocks, inline code or frontmatter. Default true. */
  skipCode?: boolean;
}

const OPEN_RE = new RegExp(`\\{((?:${META_PAIR_SOURCE}[ \\t]*)*)(\\+\\+|--|~~|==|>>)`, "y");
const PAIR_RE = new RegExp(`([A-Za-z][\\w-]*)="([^"{}\\n]*)"`, "g");
const OPENER_TO_TYPE: Record<string, MarkType> = {
  "++": "addition",
  "--": "deletion",
  "~~": "substitution",
  "==": "highlight",
  ">>": "comment",
};

export function parseMeta(raw: string): Meta {
  const attrs: Record<string, string> = {};
  PAIR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAIR_RE.exec(raw))) {
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (!(key in attrs) && value) attrs[key] = value;
  }
  return {
    author: attrs.author ?? null,
    date: attrs.date ?? null,
    edited: attrs.edited ?? null,
    status: attrs.status ?? null,
    label: attrs.label ?? null,
    attrs,
  };
}

interface Region {
  from: number;
  to: number;
}

/** Ranges that must not start a mark: YAML frontmatter, fenced code blocks, inline code spans, HTML comments. */
export function codeRegions(text: string): Region[] {
  const regions: Region[] = [];
  // HTML comments (including the optional Critique agent header) are collected first and merged in order.
  const comments: Region[] = [];
  let c = 0;
  while ((c = text.indexOf("<!--", c)) !== -1) {
    const end = text.indexOf("-->", c + 4);
    if (end === -1) break;
    comments.push({ from: c, to: end + 3 });
    c = end + 3;
  }
  let pos = 0;
  // Frontmatter
  if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
    const end = text.search(/\r?\n---[ \t]*(\r?\n|$)/);
    if (end !== -1) {
      const close = text.indexOf("\n", end + 1);
      regions.push({ from: 0, to: close === -1 ? text.length : close + 1 });
      pos = close === -1 ? text.length : close + 1;
    }
  }
  let fence: { char: string; len: number; from: number } | null = null;
  while (pos < text.length) {
    let eol = text.indexOf("\n", pos);
    if (eol === -1) eol = text.length;
    const line = text.slice(pos, eol);
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.char && fm[1].length >= fence.len && /^[ \t]*$/.test(line.slice(fm[0].length))) {
        regions.push({ from: fence.from, to: eol });
        fence = null;
      }
    } else if (fm) {
      fence = { char: fm[1][0], len: fm[1].length, from: pos };
    } else {
      // Inline code spans on this line: a backtick run closed by a run of the same length.
      let i = 0;
      while (i < line.length) {
        if (line[i] !== "`") {
          i++;
          continue;
        }
        let j = i;
        while (j < line.length && line[j] === "`") j++;
        const runLen = j - i;
        let k = j;
        let closed = -1;
        while (k < line.length) {
          if (line[k] !== "`") {
            k++;
            continue;
          }
          let l = k;
          while (l < line.length && line[l] === "`") l++;
          if (l - k === runLen) {
            closed = l;
            break;
          }
          k = l;
        }
        if (closed === -1) {
          i = j;
          continue;
        }
        regions.push({ from: pos + i, to: pos + closed });
        i = closed;
      }
    }
    pos = eol + 1;
  }
  if (fence) regions.push({ from: fence.from, to: text.length });
  if (!comments.length) return regions;
  return [...regions, ...comments].sort((a, b) => a.from - b.from);
}

function inRegion(regions: Region[], pos: number): boolean {
  // regions are sorted by from
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (pos < r.from) hi = mid - 1;
    else if (pos >= r.to) lo = mid + 1;
    else return true;
  }
  return false;
}

function lineOf(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const skipCode = options.skipCode !== false;
  const regions = skipCode ? codeRegions(text) : [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);

  const marks: Mark[] = [];
  let pos = 0;
  while (pos < text.length) {
    const brace = text.indexOf("{", pos);
    if (brace === -1) break;
    pos = brace + 1;
    if (skipCode && inRegion(regions, brace)) continue;
    OPEN_RE.lastIndex = brace;
    const m = OPEN_RE.exec(text);
    if (!m) continue;
    const metaRaw = m[1];
    const type = OPENER_TO_TYPE[m[2]];
    const contentFrom = brace + m[0].length;
    const closer = CLOSER[type] + "}";
    const close = text.indexOf(closer, contentFrom);
    if (close === -1) continue;
    const contentTo = close;
    const to = close + closer.length;
    const content = text.slice(contentFrom, contentTo);
    const mark: Mark = {
      id: marks.length,
      type,
      from: brace,
      to,
      metaFrom: brace + 1,
      metaTo: brace + 1 + metaRaw.length,
      contentFrom,
      contentTo,
      text: content,
      meta: parseMeta(metaRaw),
      line: lineOf(lineStarts, brace),
    };
    if (type === "substitution") {
      const sep = content.indexOf(SUB_SEPARATOR);
      if (sep === -1) continue; // not a substitution without a separator
      mark.sepFrom = contentFrom + sep;
      mark.oldText = content.slice(0, sep);
      mark.newText = content.slice(sep + SUB_SEPARATOR.length);
    }
    marks.push(mark);
    pos = to;
  }

  // Threads: consecutive comments with only inline whitespace between them.
  const threads: Thread[] = [];
  let current: Thread | null = null;
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.type !== "comment") {
      current = null;
      continue;
    }
    const prev = i > 0 ? marks[i - 1] : null;
    const gapInline = prev !== null && /^[ \t]*$/.test(text.slice(prev.to, mark.from));
    if (current && prev && prev.type === "comment" && gapInline) {
      current.comments.push(mark.id);
      current.to = mark.to;
      mark.thread = current.id;
      continue;
    }
    const anchor = prev && prev.type !== "comment" && gapInline ? prev : null;
    current = {
      id: threads.length,
      comments: [mark.id],
      anchor: anchor ? anchor.id : null,
      from: mark.from,
      to: mark.to,
      resolved: (mark.meta.status ?? "").toLowerCase() === "resolved",
    };
    threads.push(current);
    mark.thread = current.id;
    if (anchor) anchor.anchoredThread = current.id;
  }

  return { text, marks, threads };
}

// ---------- Queries ----------

export function isChange(mark: Mark): boolean {
  return isChangeType(mark.type);
}

export function commentText(mark: Mark): string {
  return decodeCommentText(mark.text);
}

/** The mark whose range contains `pos` (inclusive of both ends), or null. */
export function markAt(parsed: ParseResult, pos: number): Mark | null {
  for (const m of parsed.marks) {
    if (m.from > pos) break;
    if (pos >= m.from && pos <= m.to) return m;
  }
  return null;
}

/** Marks overlapping [from, to]. */
export function marksIn(parsed: ParseResult, from: number, to: number): Mark[] {
  return parsed.marks.filter((m) => m.to > from && m.from < to);
}

export function threadOf(parsed: ParseResult, mark: Mark): Thread | null {
  if (mark.type === "comment") return mark.thread === undefined ? null : parsed.threads[mark.thread];
  return mark.anchoredThread === undefined ? null : parsed.threads[mark.anchoredThread];
}

/** The thread whose comments or anchor contain `pos`. */
export function threadAt(parsed: ParseResult, pos: number): Thread | null {
  const m = markAt(parsed, pos);
  return m ? threadOf(parsed, m) : null;
}

/** Full extent of a thread including its anchor. */
export function threadExtent(parsed: ParseResult, thread: Thread): { from: number; to: number } {
  const from = thread.anchor !== null ? parsed.marks[thread.anchor].from : thread.from;
  return { from, to: thread.to };
}

export interface Counts {
  changes: number;
  openThreads: number;
  resolvedThreads: number;
  highlights: number;
}

export function counts(parsed: ParseResult): Counts {
  let changes = 0;
  let highlights = 0;
  for (const m of parsed.marks) {
    if (isChange(m)) changes++;
    else if (m.type === "highlight") highlights++;
  }
  let openThreads = 0;
  let resolvedThreads = 0;
  for (const t of parsed.threads) (t.resolved ? resolvedThreads++ : openThreads++);
  return { changes, openThreads, resolvedThreads, highlights };
}

/** Display text for a mark's anchored content: the text a reader sees. */
export function displayText(mark: Mark): string {
  switch (mark.type) {
    case "substitution":
      return `${mark.oldText ?? ""} → ${mark.newText ?? ""}`;
    case "comment":
      return commentText(mark);
    default:
      return mark.text;
  }
}

/** Re-export so callers only import the parser. */
export { OPENER, CLOSER };
