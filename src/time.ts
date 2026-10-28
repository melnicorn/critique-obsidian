// Timestamp formatting: ISO 8601 with the local UTC offset, minute precision by default.

export type TimestampPrecision = "date" | "minutes" | "seconds";

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, "0");
}

export function formatTimestamp(d: Date, precision: TimestampPrecision = "minutes"): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (precision === "date") return date;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}` + (precision === "seconds" ? `:${pad(d.getSeconds())}` : "");
  return `${date}T${time}${offset}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parse the formats we write plus plain dates and UTC "Z" timestamps. Returns null when unreadable. */
export function parseTimestamp(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = ISO_RE.exec(s.trim());
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const [, y, mo, d, h, mi, sec, tz] = m;
  if (h === undefined) return new Date(Number(y), Number(mo) - 1, Number(d));
  if (!tz) return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec ?? 0));
  let offset = 0;
  if (tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec ?? 0));
  return new Date(utc - offset * 60_000);
}

/** "just now", "5m", "3h", "2d", or a short date for anything older than a week. */
export function relativeTime(d: Date, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - d.getTime());
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" });
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fullTime(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
