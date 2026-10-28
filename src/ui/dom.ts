// Small DOM helpers shared by popovers, the panel and reading mode.
import { setIcon } from "obsidian";
import { authorColor, initials } from "../authors";
import { fullTime, parseTimestamp, relativeTime } from "../time";
import type { Mark } from "../parser";
import type { MarkType } from "../syntax";
import type { CritiqueSettings } from "../settings";

export const TYPE_ICON: Record<MarkType, string> = {
  addition: "plus",
  deletion: "minus",
  substitution: "replace",
  highlight: "highlighter",
  comment: "message-square",
};

export const TYPE_LABEL: Record<MarkType, string> = {
  addition: "Addition",
  deletion: "Deletion",
  substitution: "Substitution",
  highlight: "Highlight",
  comment: "Comment",
};

export function iconEl(parent: HTMLElement, icon: string, cls = ""): HTMLElement {
  const el = parent.createSpan({ cls: `cq-icon ${cls}`.trim() });
  setIcon(el, icon);
  return el;
}

export function avatarEl(parent: HTMLElement, author: string | null, settings: CritiqueSettings): HTMLElement {
  const el = parent.createSpan({ cls: "cq-avatar", text: initials(author) });
  const c = settings.colorByAuthor ? authorColor(author, settings.authorColors) : null;
  if (c) el.style.setProperty("--cq-author", c);
  el.setAttribute("aria-label", author ?? "Unknown author");
  return el;
}

export function timeEl(parent: HTMLElement, iso: string | null, edited?: string | null): HTMLElement | null {
  const d = parseTimestamp(iso);
  if (!d) return null;
  const el = parent.createSpan({ cls: "cq-time", text: relativeTime(d) });
  let tip = fullTime(d);
  const e = parseTimestamp(edited);
  if (e) {
    tip += ` · edited ${fullTime(e)}`;
    el.appendText(" (edited)");
  }
  el.setAttribute("aria-label", tip);
  el.setAttribute("title", tip);
  return el;
}

/** Author + time line used in cards and popovers. */
export function byline(parent: HTMLElement, mark: Mark, fallbackAuthor: string, settings: CritiqueSettings): HTMLElement {
  const el = parent.createDiv({ cls: "cq-byline" });
  avatarEl(el, mark.meta.author, settings);
  el.createSpan({ cls: "cq-author", text: mark.meta.author ?? fallbackAuthor });
  if (mark.meta.label) el.createSpan({ cls: "cq-label", text: mark.meta.label });
  timeEl(el, mark.meta.date, mark.meta.edited);
  return el;
}

/** Quote of a mark's content for cards: old → new for substitutions. */
export function quoteEl(parent: HTMLElement, mark: Mark): HTMLElement {
  const el = parent.createDiv({ cls: `cq-quote cq-quote-${mark.type}` });
  if (mark.type === "substitution") {
    el.createSpan({ cls: "cq-del-text", text: mark.oldText ?? "" });
    el.createSpan({ cls: "cq-sub-arrow", text: " → " });
    el.createSpan({ cls: "cq-add-text", text: mark.newText ?? "" });
  } else {
    const cls = mark.type === "addition" ? "cq-add-text" : mark.type === "deletion" ? "cq-del-text" : "";
    el.createSpan({ cls, text: mark.text });
  }
  return el;
}

export function button(parent: HTMLElement, label: string, opts: { icon?: string; cls?: string; title?: string; onClick: (ev: MouseEvent) => void }): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `cq-btn ${opts.cls ?? ""}`.trim() });
  if (opts.icon) setIcon(b.createSpan({ cls: "cq-btn-icon" }), opts.icon);
  if (label) b.createSpan({ text: label });
  if (opts.title) b.setAttribute("aria-label", opts.title);
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    opts.onClick(ev);
  });
  return b;
}

export function iconButton(parent: HTMLElement, icon: string, title: string, onClick: (ev: MouseEvent) => void, cls = ""): HTMLButtonElement {
  return button(parent, "", { icon, title, cls: `cq-icon-btn ${cls}`.trim(), onClick });
}

/** Keep a fixed-position element inside the viewport, preferring a spot below (or above) an anchor rect. */
export function placeNear(el: HTMLElement, anchor: DOMRect, opts: { prefer?: "above" | "below"; gap?: number; win?: Window } = {}): void {
  const win = opts.win ?? window;
  const gap = opts.gap ?? 6;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const r = el.getBoundingClientRect();
  const w = r.width || el.offsetWidth;
  const h = r.height || el.offsetHeight;
  let left = anchor.left;
  if (left + w > vw - 8) left = Math.max(8, vw - 8 - w);
  let top: number;
  const prefer = opts.prefer ?? "below";
  const spaceBelow = vh - anchor.bottom;
  const spaceAbove = anchor.top;
  if (prefer === "above" ? spaceAbove >= h + gap || spaceAbove > spaceBelow : spaceBelow < h + gap && spaceAbove > spaceBelow) {
    top = Math.max(8, anchor.top - h - gap);
  } else {
    top = Math.min(anchor.bottom + gap, vh - 8 - h);
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(8, top))}px`;
}
