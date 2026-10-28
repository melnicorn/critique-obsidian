// Per-note preview mode controller: a view-header button and commands that switch a MarkdownView
// between Markup, Accepted preview and Original preview. Display only.
import { MarkdownView, Notice, setIcon } from "obsidian";
import type CritiquePlugin from "./main";
import { PREVIEW_ICON, PREVIEW_LABEL, PREVIEW_MODES, previewModeField, setPreviewMode, type PreviewMode } from "./editor/preview";

export class PreviewModes {
  private modes = new WeakMap<MarkdownView, PreviewMode>();
  private buttons = new WeakMap<MarkdownView, HTMLElement>();
  private allButtons = new Set<HTMLElement>();

  constructor(private plugin: CritiquePlugin) {}

  get(view: MarkdownView): PreviewMode {
    return this.modes.get(view) ?? "markup";
  }

  set(view: MarkdownView, mode: PreviewMode, announce = true): void {
    this.modes.set(view, mode);
    const cm = this.plugin.cmOf(view.editor);
    if (cm && cm.state.field(previewModeField, false) !== mode) cm.dispatch({ effects: setPreviewMode.of(mode) });
    for (const m of PREVIEW_MODES) view.containerEl.classList.toggle(`cq-preview-${m}`, m === mode && m !== "markup");
    if (view.getMode() === "preview") view.previewMode.rerender(true);
    this.updateButton(view);
    this.plugin.updateStatus();
    if (announce) new Notice(`Critique: ${PREVIEW_LABEL[mode]}${mode === "markup" ? "" : " (display only)"}`);
  }

  cycle(view: MarkdownView): void {
    const next = PREVIEW_MODES[(PREVIEW_MODES.indexOf(this.get(view)) + 1) % PREVIEW_MODES.length];
    this.set(view, next);
  }

  /** Make sure every open markdown view has the header button. */
  attachAll(): void {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) this.attach(leaf.view);
    });
  }

  private attach(view: MarkdownView): void {
    if (this.buttons.has(view)) return;
    const btn = view.addAction(PREVIEW_ICON.markup, "Critique: cycle preview (markup / accepted / original)", () => this.cycle(view));
    this.buttons.set(view, btn);
    this.allButtons.add(btn);
    this.updateButton(view);
  }

  /** Remove every header button and preview class (plugin unload). */
  detachAll(): void {
    for (const b of this.allButtons) b.remove();
    this.allButtons.clear();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        for (const m of PREVIEW_MODES) leaf.view.containerEl.classList.remove(`cq-preview-${m}`);
        this.buttons.delete(leaf.view);
      }
    });
  }

  private updateButton(view: MarkdownView): void {
    const btn = this.buttons.get(view);
    if (!btn) return;
    const mode = this.get(view);
    btn.classList.toggle("is-active", mode !== "markup");
    btn.setAttribute("aria-label", `Critique: ${PREVIEW_LABEL[mode]} (click to cycle)`);
    setIcon(btn, PREVIEW_ICON[mode]);
  }
}
