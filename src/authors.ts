// Stable per-author hues.

export function authorHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function authorColor(name: string | null | undefined): string | null {
  if (!name) return null;
  return `hsl(${authorHue(name)} 55% 50%)`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return s.toUpperCase();
}
