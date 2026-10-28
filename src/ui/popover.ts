// Floating, fixed-position popovers: a base class, a text prompt, and a thread card popover.
import { Component } from "obsidian";
import { button, placeNear } from "./dom";

export type AnchorRect = DOMRect | (() => DOMRect | null);

export interface PopoverOptions {
  prefer?: "above" | "below";
  /** Close when the pointer leaves the popover (hover mode). */
  hover?: boolean;
  /** Called after the popover is removed. */
  onClose?: () => void;
  cls?: string;
}

let openPopovers: Popover[] = [];

export function closeAllPopovers(except?: Popover): void {
  for (const p of [...openPopovers]) if (p !== except) p.close();
}

export class Popover {
  readonly el: HTMLElement;
  readonly component = new Component();
  private closed = false;
  private readonly win: Window;
  private anchor: AnchorRect;
  private hoverTimer: number | null = null;
  private pinned = false;

  constructor(
    readonly doc: Document,
    anchor: AnchorRect,
    private opts: PopoverOptions = {},
  ) {
    this.win = doc.defaultView ?? window;
    this.anchor = anchor;
    this.el = doc.body.createDiv({ cls: `cq-popover ${opts.cls ?? ""}`.trim() });
    this.el.tabIndex = -1;
    this.component.load();
    openPopovers.push(this);

    this.component.registerDomEvent(doc, "mousedown", (ev) => {
      if (!this.el.contains(ev.target as Node)) this.close();
    });
    this.component.registerDomEvent(doc, "keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });
    this.component.registerDomEvent(doc, "scroll", () => this.reposition(), { capture: true, passive: true });
    this.component.registerDomEvent(this.win, "resize", () => this.reposition());
    if (opts.hover) {
      this.el.addEventListener("mouseenter", () => this.cancelHoverClose());
      this.el.addEventListener("mouseleave", () => this.scheduleHoverClose());
      this.el.addEventListener("mousedown", () => this.pin());
    }
  }

  /** Hover popovers become sticky once the user interacts with them. */
  pin(): void {
    this.pinned = true;
    this.cancelHoverClose();
  }

  scheduleHoverClose(delay = 250): void {
    if (this.pinned) return;
    this.cancelHoverClose();
    this.hoverTimer = this.win.setTimeout(() => this.close(), delay);
  }

  cancelHoverClose(): void {
    if (this.hoverTimer !== null) {
      this.win.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  reposition(): void {
    if (this.closed) return;
    const r = typeof this.anchor === "function" ? this.anchor() : this.anchor;
    if (!r) {
      this.close();
      return;
    }
    placeNear(this.el, r, { prefer: this.opts.prefer, win: this.win });
  }

  show(): this {
    this.reposition();
    // Measure once rendered, then place for real.
    this.win.requestAnimationFrame(() => this.reposition());
    return this;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelHoverClose();
    this.component.unload();
    this.el.remove();
    openPopovers = openPopovers.filter((p) => p !== this);
    this.opts.onClose?.();
  }
}

export interface PromptOptions {
  title: string;
  placeholder?: string;
  initial?: string;
  labels?: string[];
  initialLabel?: string | null;
  submitLabel?: string;
  /** Single-line input instead of a textarea. */
  singleLine?: boolean;
  prefer?: "above" | "below";
}

export interface PromptResult {
  text: string;
  label: string | null;
}

/** Ask for a piece of text near an anchor. Resolves null on cancel. ⌘/Ctrl+Enter submits. */
export function promptText(doc: Document, anchor: AnchorRect, opts: PromptOptions): Promise<PromptResult | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: PromptResult | null) => {
      if (done) return;
      done = true;
      resolve(r);
      pop.close();
    };
    const pop = new Popover(doc, anchor, { prefer: opts.prefer, cls: "cq-prompt", onClose: () => finish(null) });
    const el = pop.el;
    el.createDiv({ cls: "cq-popover-title", text: opts.title });
    let labelSelect: HTMLSelectElement | null = null;
    if (opts.labels && opts.labels.length) {
      labelSelect = el.createEl("select", { cls: "dropdown cq-label-select" });
      labelSelect.createEl("option", { value: "", text: "No label" });
      for (const l of opts.labels) labelSelect.createEl("option", { value: l, text: l });
      labelSelect.value = opts.initialLabel ?? "";
    }
    const input: HTMLInputElement | HTMLTextAreaElement = opts.singleLine ? el.createEl("input", { type: "text", cls: "cq-prompt-input" }) : el.createEl("textarea", { cls: "cq-prompt-input" });
    input.placeholder = opts.placeholder ?? "";
    input.value = opts.initial ?? "";
    if (!opts.singleLine) (input as HTMLTextAreaElement).rows = 3;
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      finish({ text, label: labelSelect?.value || null });
    };
    (input as HTMLElement).addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey || opts.singleLine)) {
        ev.preventDefault();
        submit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      }
      ev.stopPropagation();
    });
    const row = el.createDiv({ cls: "cq-popover-actions" });
    row.createSpan({ cls: "cq-hint", text: opts.singleLine ? "↩ to save" : "⌘↩ to save" });
    button(row, "Cancel", { onClick: () => finish(null) });
    button(row, opts.submitLabel ?? "Save", { cls: "mod-cta", onClick: submit });
    pop.show();
    setTimeout(() => {
      input.focus();
      if (opts.initial) input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  });
}
