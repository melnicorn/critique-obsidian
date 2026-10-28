// Stable per-author hues.

export function authorHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function normalizeAuthor(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function sameAuthor(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeAuthor(a);
  return na !== "" && na === normalizeAuthor(b);
}

/** Stable colour for an author: a configured override when one matches, else a hashed hue. */
export function authorColor(name: string | null | undefined, overrides?: Record<string, string>): string | null {
  if (!name) return null;
  if (overrides) {
    const key = normalizeAuthor(name);
    for (const [k, v] of Object.entries(overrides)) if (normalizeAuthor(k) === key && v) return v;
  }
  return `hsl(${authorHue(name.trim())} 55% 50%)`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return s.toUpperCase();
}
