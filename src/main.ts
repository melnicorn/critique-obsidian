import { MarkdownView, Notice, Plugin, editorInfoField, type Editor, type Menu, type MenuItem, type MarkdownFileInfo, type WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Actions } from "./actions";
import { Authoring } from "./authoring";
import { decorationsField } from "./editor/decorations";
import { hoverPlugin } from "./editor/hover";
import { parseField, parsedOf, settingsChanged, settingsFacet } from "./editor/state";
import { selectionToolbar } from "./editor/toolbar";
import { changesInRange, plainText, stripMetadata } from "./operations";
import { ReviewView, VIEW_TYPE_REVIEW } from "./panel/view";
import { counts, isChange, markAt, parse, threadOf, type Mark, type ParseResult } from "./parser";
import { ReadingMode } from "./reading";
import { CritiqueSettingTab, DEFAULT_SETTINGS, applySettingsToDocument, type CritiqueSettings, type MarkStyle } from "./settings";
import { MARK_TYPES, type MarkType } from "./syntax";
import { TYPE_ICON, TYPE_LABEL } from "./ui/dom";
import { closeAllPopovers } from "./ui/popover";
import { stripAgentHeader } from "./agent-header";
import { ThreadPopovers } from "./ui/thread-popover";

export default class CritiquePlugin extends Plugin {
  settings: CritiqueSettings = { ...DEFAULT_SETTINGS };
  actions = new Actions(this);
  authoring = new Authoring(this);
  threadPopovers = new ThreadPopovers(this);
  reading = new ReadingMode(this);
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CritiqueSettingTab(this.app, this));
    this.applyStyles();
    this.registerEvent(this.app.workspace.on("window-open", (_w, win) => applySettingsToDocument(win.document, this.settings)));

    // Editor
    this.registerEditorExtension([
      settingsFacet.of(this.settings),
      parseField,
      decorationsField((view, markId, el) => {
        const info = view.state.field(editorInfoField, false);
        this.threadPopovers.openForEditor(view, { file: info?.file ?? null, editor: info?.editor ?? null }, markId, true);
        void el;
      }),
      selectionToolbar(this),
      hoverPlugin(this),
    ]);

    // Reading mode
    this.registerMarkdownPostProcessor(this.reading.postProcessor);
    this.registerDomEvent(document, "mouseover", this.reading.onMouseOver);
    this.registerDomEvent(document, "mouseout", this.reading.onMouseOut);
    this.registerDomEvent(document, "click", this.reading.onClick);
    this.registerDomEvent(document, "contextmenu", this.reading.onContextMenu);
    this.registerDomEvent(document, "selectionchange", () => this.reading.onSelectionChange(document));

    // Panel
    this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, this));
    this.addRibbonIcon("message-square-text", "Critique: review panel", () => void this.togglePanel());
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("cq-status");
    this.statusEl.addEventListener("click", () => void this.togglePanel());
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatus()));
    this.registerEvent(this.app.workspace.on("editor-change", () => this.updateStatus()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateStatus()));
    this.app.workspace.onLayoutReady(() => this.updateStatus());

    // Context menu in the editor
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => this.editorMenu(menu, editor, info)));

    // Copy without markup
    this.registerDomEvent(document, "copy", (ev) => this.onCopy(ev));

    this.addCommands();
  }

  onunload(): void {
    closeAllPopovers();
    this.reading.destroy();
    for (const cls of Array.from(document.body.classList)) if (cls.startsWith("cq-")) document.body.classList.remove(cls);
  }

  // ---------- Settings ----------

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<CritiqueSettings>;
    this.settings = { ...DEFAULT_SETTINGS, ...data, colors: { ...DEFAULT_SETTINGS.colors, ...(data.colors ?? {}) } };
  }

  async saveSettings(refresh = true): Promise<void> {
    await this.saveData(this.settings);
    if (!refresh) return;
    this.applyStyles();
    this.forEachEditor((cm) => cm.dispatch({ effects: settingsChanged.of(Date.now()) }));
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "preview") leaf.view.previewMode.rerender(true);
    });
    this.panel()?.refresh();
    this.updateStatus();
  }

  private applyStyles(): void {
    applySettingsToDocument(document, this.settings);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const doc = leaf.view.containerEl.ownerDocument;
      if (doc !== document) applySettingsToDocument(doc, this.settings);
    });
  }

  // ---------- Helpers ----------

  parsedForView(view: EditorView): ParseResult {
    return parsedOf(view.state);
  }

  cmOf(editor: Editor): EditorView | null {
    const cm = (editor as unknown as { cm?: EditorView }).cm;
    return cm && typeof cm.dispatch === "function" ? cm : null;
  }

  private forEachEditor(f: (cm: EditorView) => void): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const cm = this.cmOf(leaf.view.editor);
        if (cm) f(cm);
      }
    });
  }

  private activeMarkdown(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private panel(): ReviewView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];
    return leaf?.view instanceof ReviewView ? leaf.view : null;
  }

  async togglePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];
    if (existing) {
      existing.detach();
      return;
    }
    await this.openPanel();
  }

  async openPanel(): Promise<WorkspaceLeaf | null> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0] ?? null;
    if (!leaf) {
      leaf = this.settings.panelLocation === "left" ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_TYPE_REVIEW, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const mv = this.activeMarkdown();
    if (!mv) {
      this.statusEl.setText("");
      this.statusEl.hide();
      return;
    }
    const c = counts(parse(mv.editor.getValue()));
    if (!c.changes && !c.openThreads && !c.resolvedThreads && !c.highlights) {
      this.statusEl.setText("");
      this.statusEl.hide();
      return;
    }
    this.statusEl.show();
    this.statusEl.setText(`✎ ${c.changes} · 💬 ${c.openThreads}`);
    this.statusEl.setAttribute("aria-label", `Critique: ${c.changes} pending change${c.changes === 1 ? "" : "s"}, ${c.openThreads} open thread${c.openThreads === 1 ? "" : "s"}. Click to open the review panel.`);
  }

  async copyPlain(parsed: ParseResult): Promise<void> {
    await this.actions.copy(stripAgentHeader(plainText(parsed.text, parsed, "accept")), "Note without markup");
  }

  async copyStrict(parsed: ParseResult): Promise<void> {
    await this.actions.copy(stripAgentHeader(stripMetadata(parsed.text, parsed)), "Strict CriticMarkup");
  }

  private onCopy(ev: ClipboardEvent): void {
    if (!this.settings.stripOnCopy) return;
    const mv = this.activeMarkdown();
    if (!mv || mv.getMode() !== "source") return;
    const target = ev.target as HTMLElement | null;
    if (!target?.closest?.(".cm-content")) return;
    const sel = mv.editor.getSelection();
    if (!sel || !/\{(\+\+|--|~~|==|>>)|\{[A-Za-z][\w-]*="/.test(sel)) return;
    const p = parse(sel);
    if (!p.marks.length) return;
    ev.preventDefault();
    ev.clipboardData?.setData("text/plain", stripAgentHeader(plainText(sel, p, "accept")));
  }

  // ---------- Context menu ----------

  private editorMenu(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    const cm = this.cmOf(editor);
    if (!cm) return;
    const parsed = parsedOf(cm.state);
    const sel = cm.state.selection.main;
    const target = { file: info.file ?? null, editor };
    const at = markAt(parsed, sel.from);
    const thread = at ? threadOf(parsed, at) : null;

    // Submenus exist on desktop (MenuItem.setSubmenu); fall back to a flat section elsewhere.
    let sub: Menu = menu;
    let flat = true;
    menu.addItem((item) => {
      item.setTitle("Critique").setIcon("message-square-text").setSection("critique");
      const withSub = item as MenuItem & { setSubmenu?: () => Menu };
      if (typeof withSub.setSubmenu === "function") {
        sub = withSub.setSubmenu();
        flat = false;
      } else {
        item.onClick(() => void this.openPanel());
      }
    });
    const add = (title: string, icon: string, onClick: () => void) =>
      sub.addItem((i) => {
        i.setTitle(flat ? `Critique: ${title}` : title).setIcon(icon).onClick(onClick);
        if (flat) i.setSection("critique");
      });
    for (const type of MARK_TYPES) {
      if (sel.empty && type !== "comment" && type !== "addition") continue;
      add(TYPE_LABEL[type], TYPE_ICON[type], () => void this.authoring.markInEditor(cm, type as MarkType));
    }
    const inSel = sel.empty ? [] : changesInRange(parsed, sel.from, sel.to);
    if (inSel.length > 1) {
      if (!flat) sub.addSeparator();
      add(`Accept ${inSel.length} changes in selection`, "check-check", () => void this.actions.decideInSelection(target, parsed, sel.from, sel.to, "accept"));
      add(`Reject ${inSel.length} changes in selection`, "x", () => void this.actions.decideInSelection(target, parsed, sel.from, sel.to, "reject"));
    } else if (at && isChange(at)) {
      if (!flat) sub.addSeparator();
      add("Accept change", "check", () => void this.actions.decide(target, parsed, at, "accept"));
      add("Reject change", "x", () => void this.actions.decide(target, parsed, at, "reject"));
    } else if (at && at.type === "highlight" && !thread) {
      if (!flat) sub.addSeparator();
      add("Remove highlight", "eraser", () => void this.actions.decide(target, parsed, at, "accept"));
    }
    if (thread) {
      if (!flat) sub.addSeparator();
      add(thread.resolved ? "Reopen thread" : "Resolve thread", thread.resolved ? "rotate-ccw" : "check-circle", () => void this.actions.setStatus(target, parsed, thread, thread.resolved ? null : "resolved"));
      add("Delete thread", "trash-2", () => void this.actions.deleteThread(target, parsed, thread));
    }
    if (!flat) {
      sub.addSeparator();
      add("Open review panel", "panel-right", () => void this.openPanel());
    }
  }

  // ---------- Commands ----------

  private addCommands(): void {
    this.addCommand({ id: "toggle-panel", name: "Toggle review panel", callback: () => void this.togglePanel() });

    for (const type of MARK_TYPES) {
      this.addCommand({
        id: `mark-${type}`,
        name: `Mark selection as ${TYPE_LABEL[type].toLowerCase()}`,
        editorCallback: (editor) => {
          const cm = this.cmOf(editor);
          if (cm) void this.authoring.markInEditor(cm, type as MarkType);
        },
      });
    }

    const decideAtCursor = (decision: "accept" | "reject") => (checking: boolean, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      const cm = this.cmOf(editor);
      if (!cm) return false;
      const parsed = parsedOf(cm.state);
      const at = markAt(parsed, cm.state.selection.main.from);
      if (!at || at.type === "comment") return false;
      if (!checking) void this.actions.decide({ file: info.file ?? null, editor }, parsed, at, decision);
      return true;
    };
    this.addCommand({ id: "accept-at-cursor", name: "Accept change at cursor", editorCheckCallback: decideAtCursor("accept") });
    this.addCommand({ id: "reject-at-cursor", name: "Reject change at cursor", editorCheckCallback: decideAtCursor("reject") });

    const decideInSelection = (decision: "accept" | "reject") => (checking: boolean, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      const cm = this.cmOf(editor);
      if (!cm) return false;
      const sel = cm.state.selection.main;
      if (sel.empty) return false;
      const parsed = parsedOf(cm.state);
      if (!changesInRange(parsed, sel.from, sel.to).length) return false;
      if (!checking) void this.actions.decideInSelection({ file: info.file ?? null, editor }, parsed, sel.from, sel.to, decision);
      return true;
    };
    this.addCommand({ id: "accept-in-selection", name: "Accept changes in selection", editorCheckCallback: decideInSelection("accept") });
    this.addCommand({ id: "reject-in-selection", name: "Reject changes in selection", editorCheckCallback: decideInSelection("reject") });

    const decideAll = (decision: "accept" | "reject") => (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      void this.actions.decideAll({ file: info.file ?? null, editor }, parse(editor.getValue()), decision);
    };
    this.addCommand({ id: "accept-all", name: "Accept all changes in note", editorCallback: decideAll("accept") });
    this.addCommand({ id: "reject-all", name: "Reject all changes in note", editorCallback: decideAll("reject") });

    const step = (dir: 1 | -1) => (editor: Editor) => {
      const cm = this.cmOf(editor);
      if (!cm) return;
      const parsed = parsedOf(cm.state);
      if (!parsed.marks.length) {
        new Notice("Critique: no marks in this note.");
        return;
      }
      const pos = cm.state.selection.main.head;
      let next: Mark | undefined;
      if (dir === 1) next = parsed.marks.find((m) => m.from > pos) ?? parsed.marks[0];
      else next = [...parsed.marks].reverse().find((m) => m.to < pos) ?? parsed.marks[parsed.marks.length - 1];
      cm.dispatch({ selection: { anchor: next.from, head: next.to }, scrollIntoView: true });
      cm.focus();
    };
    this.addCommand({ id: "next-mark", name: "Go to next mark", editorCallback: step(1) });
    this.addCommand({ id: "previous-mark", name: "Go to previous mark", editorCallback: step(-1) });

    this.addCommand({
      id: "resolve-thread",
      name: "Resolve or reopen thread at cursor",
      editorCheckCallback: (checking, editor, info) => {
        const cm = this.cmOf(editor);
        if (!cm) return false;
        const parsed = parsedOf(cm.state);
        const at = markAt(parsed, cm.state.selection.main.from);
        const thread = at ? threadOf(parsed, at) : null;
        if (!thread) return false;
        if (!checking) void this.actions.setStatus({ file: info.file ?? null, editor }, parsed, thread, thread.resolved ? null : "resolved");
        return true;
      },
    });

    this.addCommand({
      id: "copy-plain",
      name: "Copy selection (or note) without markup",
      editorCallback: (editor) => {
        const sel = editor.getSelection();
        const text = sel || editor.getValue();
        void this.actions.copy(stripAgentHeader(plainText(text, parse(text), "accept")), sel ? "Selection without markup" : "Note without markup");
      },
    });
    this.addCommand({
      id: "copy-strict",
      name: "Copy note as strict CriticMarkup (no metadata)",
      editorCallback: (editor) => void this.copyStrict(parse(editor.getValue())),
    });

    this.addCommand({
      id: "insert-agent-header",
      name: "Insert agent guide header",
      editorCallback: (editor, info) => void this.actions.addHeader({ file: info.file ?? null, editor }),
    });
    this.addCommand({
      id: "remove-agent-header",
      name: "Remove agent guide header",
      editorCallback: (editor, info) => void this.actions.removeHeader({ file: info.file ?? null, editor }),
    });

    this.addCommand({
      id: "cycle-mark-style",
      name: "Cycle mark style (highlighted / dashed underline / off)",
      callback: () => {
        const order: MarkStyle[] = ["highlight", "underline", "off"];
        this.settings.markStyle = order[(order.indexOf(this.settings.markStyle) + 1) % order.length];
        void this.saveSettings();
        new Notice(`Critique: mark style ${({ highlight: "highlighted", underline: "dashed underline", off: "off (tray only)" } as const)[this.settings.markStyle]}`);
      },
    });
    this.addCommand({
      id: "toggle-reading-marks",
      name: "Toggle marks in Reading mode (accepted preview)",
      callback: () => {
        this.settings.showMarksReading = !this.settings.showMarksReading;
        void this.saveSettings();
      },
    });
  }
}

