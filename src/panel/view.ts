// The review panel: every mark in the active note as a card, with filters and bulk actions.
import { ItemView, MarkdownView, Menu, TFile, debounce, type WorkspaceLeaf } from "obsidian";
import type CritiquePlugin from "../main";
import { counts, parse, type Mark, type ParseResult } from "../parser";
import { collectItems, itemMatchesMine, itemThread, renderItem, type CardHost, type Item } from "../ui/card";
import { isChange } from "../parser";
import { normalizeAuthor } from "../authors";
import { button, iconButton } from "../ui/dom";
import type { PanelFilter } from "../settings";
import type { Target } from "../actions";

export const VIEW_TYPE_REVIEW = "critique-review";

export class ReviewView extends ItemView {
  private file: TFile | null = null;
  private parsed: ParseResult | null = null;
  private text = "";
  private busy = false;
  private pending = false;
  private headerEl!: HTMLElement;
  private listEl!: HTMLElement;
  private readonly refreshDebounced = debounce(() => void this.refresh(), 200, true);

  constructor(leaf: WorkspaceLeaf, private plugin: CritiquePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_REVIEW;
  }
  getDisplayText(): string {
    return "Critique";
  }
  getIcon(): string {
    return "message-square-text";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("cq-panel");
    this.headerEl = root.createDiv({ cls: "cq-panel-head" });
    this.listEl = root.createDiv({ cls: "cq-panel-list" });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.follow()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.follow()));
    this.registerEvent(this.app.workspace.on("editor-change", (_e, info) => info.file && info.file === this.file && this.refreshDebounced()));
    this.registerEvent(this.app.vault.on("modify", (f) => f === this.file && this.refreshDebounced()));
    this.registerEvent(this.app.vault.on("rename", (f) => f === this.file && this.refreshDebounced()));
    this.follow();
  }

  /** Track the active markdown view; keep the last file when focus moves to a non-markdown leaf. */
  follow(): void {
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv?.file) {
      if (mv.file !== this.file) this.file = mv.file;
      void this.refresh();
      return;
    }
    if (this.file && !this.app.vault.getAbstractFileByPath(this.file.path)) {
      this.file = null;
      void this.refresh();
    } else if (!this.parsed) void this.refresh();
  }

  private markdownViewFor(file: TFile): MarkdownView | null {
    let found: MarkdownView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!found && leaf.view instanceof MarkdownView && leaf.view.file === file) found = leaf.view;
    });
    return found;
  }

  private target(): Target {
    const mv = this.file ? this.markdownViewFor(this.file) : null;
    const editing = mv && mv.getMode() === "source";
    return { file: this.file, editor: editing ? mv.editor : null };
  }

  async refresh(): Promise<void> {
    if (this.busy) {
      this.pending = true;
      return;
    }
    const t = this.target();
    const text = t.editor ? t.editor.getValue() : this.file ? await this.app.vault.cachedRead(this.file) : "";
    if (text === this.text && this.parsed && this.listEl.childElementCount) return;
    this.text = text;
    this.parsed = parse(text);
    this.render();
  }

  private render(): void {
    const s = this.plugin.settings;
    const parsed = this.parsed ?? parse("");
    const scrollTop = this.listEl.scrollTop;
    this.headerEl.empty();
    this.listEl.empty();

    const title = this.headerEl.createDiv({ cls: "cq-panel-title" });
    title.createSpan({ cls: "cq-panel-file", text: this.file ? this.file.basename : "No note" });
    const c = counts(parsed);
    const summaryEl = this.headerEl.createDiv({ cls: "cq-panel-summary" });
    const summary = [
      `${c.changes} change${c.changes === 1 ? "" : "s"}`,
      `${c.openThreads} open thread${c.openThreads === 1 ? "" : "s"}`,
      c.resolvedThreads ? `${c.resolvedThreads} resolved` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    summaryEl.setText(summary);
    const more = iconButton(title, "more-horizontal", "More", (ev) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Accept all changes").setIcon("check-check").onClick(() => void this.plugin.actions.decideAll(this.target(), parsed, "accept").then(() => this.afterChange())));
      menu.addItem((i) => i.setTitle("Reject all changes").setIcon("x").onClick(() => void this.plugin.actions.decideAll(this.target(), parsed, "reject").then(() => this.afterChange())));
      // Per-author bulk actions, when more than one author left changes.
      const authors = new Map<string, string | null>();
      for (const m of parsed.marks) if (isChange(m)) authors.set(normalizeAuthor(m.meta.author), m.meta.author);
      if (authors.size > 1) {
        menu.addSeparator();
        for (const author of authors.values()) {
          const label = author ?? "unsigned";
          menu.addItem((i) => i.setTitle(`Accept all changes by ${label}`).setIcon("check").onClick(() => void this.plugin.actions.decideAllBy(this.target(), parsed, "accept", author).then(() => this.afterChange())));
          menu.addItem((i) => i.setTitle(`Reject all changes by ${label}`).setIcon("x").onClick(() => void this.plugin.actions.decideAllBy(this.target(), parsed, "reject", author).then(() => this.afterChange())));
        }
      }
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Finalize note…").setIcon("file-check").onClick(() => void this.plugin.actions.finalize(this.target()).then(() => this.afterChange())));
      menu.addItem((i) => i.setTitle("Export strict CriticMarkup copy").setIcon("file-output").onClick(() => void this.plugin.actions.exportStrict(this.target())));
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Copy note without markup").setIcon("copy").onClick(() => void this.plugin.copyPlain(parsed)));
      menu.addItem((i) => i.setTitle("Copy as strict CriticMarkup").setIcon("clipboard-copy").onClick(() => void this.plugin.copyStrict(parsed)));
      menu.showAtMouseEvent(ev);
    });
    more.addClass("cq-push-right");

    const filters = this.headerEl.createDiv({ cls: "cq-filters" });
    const seg = filters.createDiv({ cls: "cq-seg" });
    const setFilter = (f: PanelFilter) => {
      s.panelFilter = f;
      void this.plugin.saveSettings(false);
      this.render();
    };
    for (const [key, label] of [
      ["all", "All"],
      ["changes", "Changes"],
      ["comments", "Comments"],
    ] as [PanelFilter, string][]) {
      const b = button(seg, label, { cls: s.panelFilter === key ? "is-active" : "", onClick: () => setFilter(key) });
      b.addClass("cq-seg-btn");
    }
    const mine = button(filters, "Mine", {
      cls: `cq-seg-btn cq-toggle ${s.panelMine ? "is-active" : ""}`,
      title: s.authorName ? `Only marks by ${s.authorName}` : "Set your author name in settings first",
      onClick: () => {
        s.panelMine = !s.panelMine;
        void this.plugin.saveSettings(false);
        this.render();
      },
    });
    if (!s.authorName) mine.disabled = true;
    button(filters, "Resolved", {
      cls: `cq-seg-btn cq-toggle ${s.panelShowResolved ? "is-active" : ""}`,
      title: "Show resolved threads",
      onClick: () => {
        s.panelShowResolved = !s.panelShowResolved;
        void this.plugin.saveSettings(false);
        this.render();
      },
    });

    const host: CardHost = {
      app: this.app,
      settings: s,
      actions: this.plugin.actions,
      target: this.target(),
      component: this,
      parsed,
      sourcePath: this.file?.path ?? "",
      jumpTo: (m) => this.jumpTo(m),
      afterChange: () => this.afterChange(),
      setBusy: (b) => this.setBusy(b),
      hoverMarks: (ids) => this.hoverMarks(ids),
    };

    const items = collectItems(parsed).filter((it) => this.passes(it, host));
    if (!items.length) {
      this.listEl.createDiv({ cls: "cq-empty", text: this.file ? (parsed.marks.length ? "Nothing matches the current filter." : "No marks in this note. Select text and use the toolbar, the context menu, or a Critique command to add one.") : "Open a note to review it." });
    }
    for (const it of items) renderItem(this.listEl, it, host, { showJump: true });
    this.listEl.scrollTop = scrollTop;
  }

  private passes(it: Item, host: CardHost): boolean {
    const s = this.plugin.settings;
    const thread = itemThread(it);
    if (thread?.resolved && !s.panelShowResolved) return false;
    if (s.panelFilter === "changes" && !(it.kind === "mark" && it.mark.type !== "highlight")) return false;
    if (s.panelFilter === "comments" && !thread) return false;
    if (s.panelMine && !itemMatchesMine(host, it)) return false;
    return true;
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    if (!b && this.pending) {
      this.pending = false;
      void this.refresh();
    }
  }

  private afterChange(): void {
    this.busy = false;
    this.pending = false;
    this.refreshDebounced();
  }

  jumpTo(m: Mark): void {
    if (!this.file) return;
    const mv = this.markdownViewFor(this.file);
    if (!mv) {
      void this.app.workspace.getLeaf(false).openFile(this.file);
      return;
    }
    if (mv.getMode() === "source") {
      const editor = mv.editor;
      const from = editor.offsetToPos(m.from);
      const to = editor.offsetToPos(m.to);
      this.app.workspace.setActiveLeaf(mv.leaf, { focus: true });
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
      editor.focus();
    } else {
      const piece = mv.containerEl.querySelector<HTMLElement>(`.markdown-preview-view [data-cq-id="${m.id}"]:not(.cq-hidden)`);
      if (piece) {
        piece.scrollIntoView({ block: "center" });
        piece.classList.add("cq-flash");
        window.setTimeout(() => piece.classList.remove("cq-flash"), 1200);
      } else {
        // Section not rendered yet: scroll by line, then retry.
        mv.previewMode.applyScroll(m.line);
        window.setTimeout(() => mv.containerEl.querySelector<HTMLElement>(`.markdown-preview-view [data-cq-id="${m.id}"]:not(.cq-hidden)`)?.scrollIntoView({ block: "center" }), 150);
      }
    }
  }

  /** Light up the card that covers a mark while the pointer is over it in the note. */
  highlightMark(id: number | null): void {
    for (const card of this.listEl.querySelectorAll<HTMLElement>(".cq-card.cq-hover")) card.classList.remove("cq-hover");
    if (id === null) return;
    const card = this.cardFor(id);
    card?.classList.add("cq-hover");
  }

  /** Keep the card at the cursor in view. */
  followCursor(file: TFile | null, pos: number): void {
    if (!file || file !== this.file || !this.parsed) return;
    const item = collectItems(this.parsed).find((it) => pos >= it.from && pos <= it.to);
    const current = this.listEl.querySelector<HTMLElement>(".cq-card.cq-current");
    const card = item ? this.listEl.querySelector<HTMLElement>(`.cq-card[data-cq-from="${item.from}"]`) : null;
    if (current === card) return;
    current?.classList.remove("cq-current");
    if (card) {
      card.classList.add("cq-current");
      card.scrollIntoView({ block: "nearest" });
    }
  }

  private cardFor(id: number): HTMLElement | null {
    for (const card of this.listEl.querySelectorAll<HTMLElement>(".cq-card[data-cq-ids]")) {
      if ((card.dataset.cqIds ?? "").split(",").includes(String(id))) return card;
    }
    return null;
  }

  /** Light up the marks in the note while the pointer is over a card. */
  private hoverMarks(ids: number[] | null): void {
    const mv = this.file ? this.markdownViewFor(this.file) : null;
    if (!mv) return;
    for (const el of mv.containerEl.querySelectorAll<HTMLElement>(".cq-flash")) el.classList.remove("cq-flash");
    if (!ids) return;
    for (const id of ids) for (const el of mv.containerEl.querySelectorAll<HTMLElement>(`[data-cq-id="${id}"]:not(.cq-hidden)`)) el.classList.add("cq-flash");
  }

  /** Scroll the panel to the card for a mark. */
  reveal(from: number): void {
    const card = this.listEl.querySelector<HTMLElement>(`.cq-card[data-cq-from="${from}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    card.classList.add("cq-flash");
    window.setTimeout(() => card.classList.remove("cq-flash"), 1200);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
