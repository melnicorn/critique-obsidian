// CriticMarkup syntax constants and string builders. Pure, no Obsidian imports.

export type MarkType = "addition" | "deletion" | "substitution" | "highlight" | "comment";

export const MARK_TYPES: MarkType[] = ["addition", "deletion", "substitution", "highlight", "comment"];

export const OPENER: Record<MarkType, string> = {
  addition: "++",
  deletion: "--",
  substitution: "~~",
  highlight: "==",
  comment: ">>",
};

export const CLOSER: Record<MarkType, string> = {
  addition: "++",
  deletion: "--",
  substitution: "~~",
  highlight: "==",
  comment: "<<",
};

export const SUB_SEPARATOR = "~>";

/** Attribute pair as written in a metadata prefix: key="value". Values may not contain quotes, braces or newlines. */
export const META_PAIR_SOURCE = '[A-Za-z][\\w-]*="[^"{}\\n]*"';

export function isChangeType(t: MarkType): boolean {
  return t === "addition" || t === "deletion" || t === "substitution";
}

/** Make a value safe for an attribute: no quotes, braces or newlines. */
export function sanitizeAttrValue(v: string): string {
  return v.replace(/"/g, "'").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]+/g, " ").trim();
}

/** Serialize attributes in a stable order: author, date, then the rest alphabetically. */
export function formatAttrs(attrs: Record<string, string | null | undefined>): string {
  const order = ["author", "date", "edited", "label", "status"];
  const keys = Object.keys(attrs).filter((k) => attrs[k] != null && attrs[k] !== "");
  keys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
  return keys.map((k) => `${k}="${sanitizeAttrValue(attrs[k] as string)}"`).join(" ");
}

/** Comments are stored on one line: newlines become a literal backslash-n, backslashes are doubled. */
export function encodeCommentText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").trim();
}

export function decodeCommentText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      const n = text[i + 1];
      if (n === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "\\") {
        out += "\\";
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

export interface BuildOptions {
  attrs?: Record<string, string | null | undefined>;
}

function prefix(attrs?: Record<string, string | null | undefined>): string {
  if (!attrs) return "";
  const s = formatAttrs(attrs);
  return s ? s + " " : "";
}

export function buildMark(type: Exclude<MarkType, "substitution" | "comment">, content: string, opts: BuildOptions = {}): string {
  return `{${prefix(opts.attrs)}${OPENER[type]}${content}${CLOSER[type]}}`;
}

export function buildSubstitution(oldText: string, newText: string, opts: BuildOptions = {}): string {
  return `{${prefix(opts.attrs)}~~${oldText}~>${newText}~~}`;
}

export function buildComment(text: string, opts: BuildOptions = {}): string {
  return `{${prefix(opts.attrs)}>>${encodeCommentText(text)}<<}`;
}
