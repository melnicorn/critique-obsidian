// The optional one-line HTML comment that points agents at the review guide. Pure.
import type { Edit } from "./operations";

export const DEFAULT_GUIDE_URL = "https://raw.githubusercontent.com/melnicorn/critique-obsidian/main/skills/critique/SKILL.md";

const MARKER = "<!-- critique:";
const HEADER_RE = /^<!-- critique:[^\n]*-->[ \t]*$/m;

export function buildAgentHeader(url: string): string {
  return `${MARKER} This note uses CriticMarkup review marks (additions, deletions, substitutions, highlights, comments) with author/date attribute prefixes; adjacent comments form a thread and a reply is appended right after it. Guide for agents: ${url} (also installed at .obsidian/plugins/critique/SKILL.md) -->`;
}

/** Range of the header line, or null. */
export function findAgentHeader(text: string): { from: number; to: number } | null {
  const m = HEADER_RE.exec(text);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

export function hasAgentHeader(text: string): boolean {
  return HEADER_RE.test(text);
}

/** Offset just after the YAML frontmatter block, or 0. */
export function afterFrontmatter(text: string): number {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return 0;
  const end = text.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end === -1) return 0;
  const close = text.indexOf("\n", end + 1);
  return close === -1 ? text.length : close + 1;
}

/** Edit that inserts the header after the frontmatter, or null when one is already there. */
export function insertAgentHeader(text: string, url: string): Edit | null {
  if (hasAgentHeader(text)) return null;
  const at = afterFrontmatter(text);
  const rest = text.slice(at);
  const sep = rest === "" ? "\n" : rest.startsWith("\n") ? "\n" : "\n\n";
  return { from: at, to: at, insert: buildAgentHeader(url) + sep, expected: "" };
}

/** Edit that removes the header line (and, at the top of a note, the blank line after it), or null when absent. */
export function removeAgentHeader(text: string): Edit | null {
  const r = findAgentHeader(text);
  if (!r) return null;
  let to = r.to;
  if (text.startsWith("\n", to)) to += 1;
  // At the very top there is nothing above to separate from, so drop the blank line too.
  if (r.from === 0 && text.startsWith("\n", to)) to += 1;
  return { from: r.from, to, insert: "", expected: text.slice(r.from, to) };
}

export function stripAgentHeader(text: string): string {
  const e = removeAgentHeader(text);
  return e ? text.slice(0, e.from) + text.slice(e.to) : text;
}
