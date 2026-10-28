// Reading mode: decorate rendered sections, add margin indicators, open thread popovers,
// and map a DOM selection back to source offsets so marks can be authored here too.
import { Menu, TFile, setIcon, type MarkdownPostProcessorContext } from "obsidian";
import { alignText, sourceEnd, sourceStart } from "./align";
import { parse, threadOf, type Mark, type ParseResult, type Thread } from "./parser";
import type CritiquePlugin from "./main";
import { authorColor, sameAuthor } from "./authors";
import { TYPE_ICON, TYPE_LABEL } from "./ui/dom";
import { MARK_TYPES, type MarkType } from "./syntax";
import type { Target } from "./actions";
import type { CritiqueSettings } from "./settings";

interface SectionInfo {
  text: string;
  from: number;
  to: number;
  sourcePath: string;
  parsed: ParseResult;
  map: Int32Array | null;
  rendered: string | null;
}

interface Segment {
  from: number;
  to: number;
  cls: string;
  attrs?: Record<string, string>;
  /** Element to insert before the first piece of this segment. */
  before?: HTMLElement;
  /** Element to insert after the last piece. */
  after?: HTMLElement;
}

interface TextRun {
  node: Text;
  start: number;
}

function textRuns(el: HTMLElement): { runs: TextRun[]; text: string } {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(".cq-tray-host, .cq-chip, .cq-sub-arrow") ?? null) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const runs: TextRun[] = [];
  let text = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    runs.push({ node: t, start: text.length });
    text += t.data;
  }
  return { runs, text };
}

export class ReadingMode {
  private sections = new WeakMap<HTMLElement, SectionInfo>();
  private parseCache = new Map<string, ParseResult>();
  private toolbar: HTMLElement | null = null;
  private toolbarTimer: number | null = null;

  constructor(private plugin: CritiquePlugin) {}

  get settings(): CritiqueSettings {
    return this.plugin.settings;
  }

  parseCached(text: string): ParseResult {
    const hit = this.parseCache.get(text);
    if (hit) return hit;
    const p = parse(text);
    this.parseCache.set(text, p);
    if (this.parseCache.size > 12) this.parseCache.delete(this.parseCache.keys().next().value as string);
    return p;
  }

  readonly postProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const lines = info.text.split("\n");
    let from = 0;
    for (let i = 0; i < info.lineStart && i < lines.length; i++) from += lines[i].length + 1;
    let to = from;
    for (let i = info.lineStart; i <= info.lineEnd && i < lines.length; i++) to += lines[i].length + 1;
    to = Math.min(to - 1, info.text.length);
    const parsed = this.parseCached(info.text);
    const section: SectionInfo = { text: info.text, from, to, sourcePath: ctx.sourcePath, parsed, map: null, rendered: null };
    this.sections.set(el, section);
    el.dataset.cqSection = "1";
    const marks = parsed.marks.filter((m) => m.from >= from && m.to <= to);
    if (!marks.length) return;
    this.decorate(el, section, marks);
  };

  private ensureAligned(el: HTMLElement, section: SectionInfo): { runs: TextRun[]; map: Int32Array } {
    const { runs, text } = textRuns(el);
    if (!section.map || section.rendered !== text) {
      section.map = alignText(section.text.slice(section.from, section.to), text);
      section.rendered = text;
    }
    return { runs, map: section.map };
  }

  private decorate(el: HTMLElement, section: SectionInfo, marks: Mark[]): void {
    const { runs, map } = this.ensureAligned(el, section);
    const s = this.settings;
    const parsed = section.parsed;
    const r = (pos: number) => map[Math.max(0, Math.min(map.length - 1, pos - section.from))];
    const segments: Segment[] = [];
    const trays = new Map<number, { items: TrayItem[]; at: number }>();

    for (const m of marks) {
      const thread = threadOf(parsed, m);
      const isCmt = m.type === "comment";
      const isRoot = isCmt && !!thread && thread.comments[0] === m.id;
      const anchored = isCmt && !!thread && thread.anchor !== null;
      const base = ["cq-mark", `cq-${m.type}`];
      if (thread) base.push(thread.resolved ? "cq-resolved" : "cq-threaded");
      if (m.type === "highlight" && thread) base.push("cq-anchor");
      if (sameAuthor(m.meta.author, s.authorName)) base.push("cq-mine");
      const attrs: Record<string, string> = { "data-cq-id": String(m.id) };
      const color = s.colorByAuthor ? authorColor(isCmt ? m.meta.author : thread ? parsed.marks[thread.comments[0]].meta.author : m.meta.author, s.authorColors) : null;
      if (color) attrs.style = `--cq-author:${color}`;
      const seg = (from: number, to: number, cls: string, extra: Partial<Segment> = {}) => {
        const rf = r(from);
        const rt = r(to);
        if (rt > rf || extra.before || extra.after) segments.push({ from: rf, to: Math.max(rf, rt), cls: `${base.join(" ")} ${cls}`.trim(), attrs, ...extra });
      };

      if (isCmt) {
        let before: HTMLElement | undefined;
        if (isRoot && !anchored) before = this.chip(el.ownerDocument, m, thread!, s);
        seg(m.from, m.to, "cq-hidden", { before });
      } else {
        seg(m.from, m.contentFrom, "cq-hidden");
        switch (m.type) {
          case "addition":
            seg(m.contentFrom, m.contentTo, "cq-add-text");
            break;
          case "deletion":
            seg(m.contentFrom, m.contentTo, "cq-del-text");
            break;
          case "substitution": {
            seg(m.contentFrom, m.sepFrom!, "cq-del-text cq-sub-old");
            const arrow = el.ownerDocument.createElement("span");
            arrow.className = "cq-sub-arrow";
            arrow.textContent = "→";
            seg(m.sepFrom!, m.sepFrom! + 2, "cq-hidden", { after: arrow });
            seg(m.sepFrom! + 2, m.contentTo, "cq-add-text cq-sub-new");
            break;
          }
          case "highlight":
            seg(m.contentFrom, m.contentTo, "cq-hl-text");
            break;
        }
        seg(m.contentTo, m.to, "cq-hidden");
      }

      if (wantsIndicator(m, thread, s)) {
        const g = trays.get(m.line) ?? { items: [], at: r(m.from) };
        const rootAuthor = thread ? parsed.marks[thread.comments[0]].meta.author : m.meta.author;
        g.items.push({ markId: m.id, type: m.type, count: thread ? thread.comments.length : 1, resolved: !!thread?.resolved, author: rootAuthor });
        trays.set(m.line, g);
      }
    }

    for (const g of trays.values()) {
      const host = this.tray(el.ownerDocument, g.items, s, section);
      // Attach to the first segment at or after the tray position.
      const target = segments.filter((x) => x.from >= g.at).sort((a, b) => a.from - b.from)[0];
      if (target) {
        if (target.before) {
          const wrap = el.ownerDocument.createElement("span");
          wrap.append(host, target.before);
          target.before = wrap;
        } else target.before = host;
      }
    }

    el.classList.add("cq-rd-section");
    segments.sort((a, b) => a.from - b.from || a.to - b.to);
    for (let i = segments.length - 1; i >= 0; i--) this.wrap(runs, segments[i], el.ownerDocument);
  }

  private wrap(runs: TextRun[], seg: Segment, doc: Document): void {
    const make = (piece: Text) => {
      const span = doc.createElement("span");
      span.className = seg.cls;
      if (seg.attrs) for (const [k, v] of Object.entries(seg.attrs)) span.setAttribute(k, v);
      piece.parentNode?.insertBefore(span, piece);
      span.appendChild(piece);
      return span;
    };
    let first: HTMLElement | null = null;
    let last: HTMLElement | null = null;
    if (seg.to <= seg.from) {
      // Zero-width segment: only used to carry an inserted element.
      const run = runs.find((x) => x.start + x.node.data.length >= seg.from) ?? runs[runs.length - 1];
      if (!run) return;
      const at = Math.max(0, Math.min(run.node.data.length, seg.from - run.start));
      const tail = run.node.splitText(at);
      if (seg.before) tail.parentNode?.insertBefore(seg.before, tail);
      if (seg.after) tail.parentNode?.insertBefore(seg.after, tail);
      return;
    }
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      const start = run.start;
      const end = start + run.node.data.length;
      if (end <= seg.from || start >= seg.to) continue;
      let node = run.node;
      const pieceStart = Math.max(seg.from, start) - start;
      const pieceEnd = Math.min(seg.to, end) - start;
      if (pieceEnd < node.data.length) node.splitText(pieceEnd);
      if (pieceStart > 0) node = node.splitText(pieceStart);
      const span = make(node);
      if (!last) last = span;
      first = span;
    }
    if (first && seg.before) first.parentNode?.insertBefore(seg.before, first);
    if (last && seg.after) last.parentNode?.insertBefore(seg.after, last.nextSibling);
  }

  private chip(doc: Document, root: Mark, thread: Thread, s: CritiqueSettings): HTMLElement {
    const chip = doc.createElement("span");
    chip.className = `cq-chip ${thread.resolved ? "cq-resolved" : ""}`.trim();
    chip.dataset.cqId = String(root.id);
    const c = s.colorByAuthor ? authorColor(root.meta.author, s.authorColors) : null;
    if (c) chip.style.setProperty("--cq-author", c);
    setIcon(chip, "message-square");
    if (thread.comments.length > 1) chip.append(doc.createTextNode(String(thread.comments.length)));
    return chip;
  }

  private tray(doc: Document, items: TrayItem[], s: CritiqueSettings, section: SectionInfo): HTMLElement {
    const host = doc.createElement("span");
    host.className = "cq-tray-host cq-rd";
    const tray = host.appendChild(doc.createElement("span"));
    tray.className = "cq-tray";
    for (const it of items) {
      const b = tray.appendChild(doc.createElement("button"));
      b.className = `cq-tray-item cq-tray-${it.type} ${it.resolved ? "cq-resolved" : ""}`.trim();
      b.dataset.cqId = String(it.markId);
      const c = s.colorByAuthor ? authorColor(it.author, s.authorColors) : null;
      if (c) b.style.setProperty("--cq-author", c);
      setIcon(b, it.type === "comment" ? "message-square" : TYPE_ICON[it.type]);
      if (it.count > 1) {
        const n = b.appendChild(doc.createElement("span"));
        n.className = "cq-tray-count";
        n.textContent = String(it.count);
      }
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openPopover(b, section, it.markId, true);
      });
      b.addEventListener("mouseenter", () => this.flash(b, it.markId, true));
      b.addEventListener("mouseleave", () => this.flash(b, it.markId, false));
    }
    return host;
  }

  private flash(from: HTMLElement, id: number, on: boolean): void {
    const section = from.closest<HTMLElement>("[data-cq-section]");
    section?.querySelectorAll<HTMLElement>(`[data-cq-id="${id}"]`).forEach((p) => p.classList.toggle("cq-flash", on));
  }

  private targetFor(section: SectionInfo): Target {
    const f = this.plugin.app.vault.getAbstractFileByPath(section.sourcePath);
    return { file: f instanceof TFile ? f : null, editor: null };
  }

  private openPopover(anchorEl: HTMLElement, section: SectionInfo, markId: number, pinned: boolean): void {
    const mark = section.parsed.marks[markId];
    if (!mark) return;
    const sectionEl = anchorEl.closest<HTMLElement>("[data-cq-section]");
    const anchor = () => {
      const pieces = sectionEl?.querySelectorAll<HTMLElement>(`[data-cq-id="${markId}"]:not(.cq-hidden)`);
      const list = pieces && pieces.length ? Array.from(pieces) : [anchorEl];
      if (!list[0].isConnected) return null;
      const rects = list.map((p) => p.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rects.length) return anchorEl.getBoundingClientRect();
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return new DOMRect(left, top, right - left, bottom - top);
    };
    this.plugin.threadPopovers.open(anchorEl.ownerDocument, anchor, this.targetFor(section), section.parsed, mark, pinned, (m) => this.scrollTo(sectionEl, m), section.sourcePath);
  }

  scrollTo(sectionEl: HTMLElement | null, m: Mark): void {
    const piece = sectionEl?.querySelector<HTMLElement>(`[data-cq-id="${m.id}"]:not(.cq-hidden)`);
    piece?.scrollIntoView({ block: "center" });
  }

  // ---------- Hover and click on marks ----------

  readonly onMouseOver = (ev: MouseEvent): void => {
    const target = (ev.target as HTMLElement).closest?.<HTMLElement>(".markdown-preview-view [data-cq-id]");
    if (!target || target.classList.contains("cq-tray-item")) return;
    const sectionEl = target.closest<HTMLElement>("[data-cq-section]");
    const section = sectionEl ? this.sections.get(sectionEl) : null;
    if (!section) return;
    const id = Number(target.dataset.cqId);
    this.plugin.panel()?.highlightMark(id);
    if (this.hoverTimer !== null) window.clearTimeout(this.hoverTimer);
    this.plugin.threadPopovers.cancelClose();
    this.hoverTimer = window.setTimeout(() => {
      this.hoverTimer = null;
      this.openPopover(target, section, id, false);
    }, 450);
  };
  private hoverTimer: number | null = null;

  readonly onMouseOut = (ev: MouseEvent): void => {
    const from = (ev.target as HTMLElement).closest?.(".markdown-preview-view [data-cq-id]");
    if (!from) return;
    const to = (ev.relatedTarget as HTMLElement | null)?.closest?.("[data-cq-id]") ?? null;
    if (to === from) return;
    this.plugin.panel()?.highlightMark(null);
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.plugin.threadPopovers.scheduleClose();
  };

  readonly onClick = (ev: MouseEvent): void => {
    const chip = (ev.target as HTMLElement).closest?.<HTMLElement>(".markdown-preview-view .cq-chip");
    if (!chip) return;
    const sectionEl = chip.closest<HTMLElement>("[data-cq-section]");
    const section = sectionEl ? this.sections.get(sectionEl) : null;
    if (!section) return;
    ev.preventDefault();
    this.openPopover(chip, section, Number(chip.dataset.cqId), true);
  };

  // ---------- Selection → source, toolbar and context menu ----------

  /** Map the current DOM selection inside a preview to source offsets. */
  selectionToSource(doc: Document): { section: SectionInfo; from: number; to: number; rect: DOMRect } | null {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : (range.startContainer as HTMLElement))?.closest<HTMLElement>("[data-cq-section]") ?? null;
    const endEl = (range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : (range.endContainer as HTMLElement))?.closest<HTMLElement>("[data-cq-section]") ?? null;
    if (!startEl || !endEl) return null;
    const a = this.sections.get(startEl);
    const b = this.sections.get(endEl);
    if (!a || !b || a.text !== b.text) return null;
    const from = this.domToSource(startEl, a, range.startContainer, range.startOffset, "start");
    const to = this.domToSource(endEl, b, range.endContainer, range.endOffset, "end");
    if (from === null || to === null || to <= from) return null;
    return { section: a, from, to, rect: range.getBoundingClientRect() };
  }

  private domToSource(el: HTMLElement, section: SectionInfo, node: Node, offset: number, kind: "start" | "end"): number | null {
    const { runs, map } = this.ensureAligned(el, section);
    let rendered = -1;
    if (node.nodeType === Node.TEXT_NODE) {
      const run = runs.find((x) => x.node === node);
      if (!run) return null;
      rendered = run.start + offset;
    } else {
      // Element container: position before the child at `offset`.
      const child = node.childNodes[offset] ?? null;
      if (child) {
        const firstText = child.nodeType === Node.TEXT_NODE ? (child as Text) : (child as HTMLElement).querySelector ? firstTextIn(child) : null;
        const run = firstText ? runs.find((x) => x.node === firstText) : null;
        rendered = run ? run.start : -1;
      }
      if (rendered === -1) {
        const lastText = lastTextIn(node);
        const run = lastText ? runs.find((x) => x.node === lastText) : null;
        rendered = run ? run.start + run.node.data.length : 0;
      }
    }
    const local = kind === "start" ? sourceStart(map, rendered) : sourceEnd(map, rendered);
    return section.from + local;
  }

  readonly onSelectionChange = (doc: Document): void => {
    if (this.toolbarTimer !== null) window.clearTimeout(this.toolbarTimer);
    this.toolbarTimer = window.setTimeout(() => {
      this.toolbarTimer = null;
      this.refreshToolbar(doc);
    }, 250);
  };

  private refreshToolbar(doc: Document): void {
    if (!this.settings.toolbarInReading) {
      this.hideToolbar();
      return;
    }
    const sel = doc.getSelection();
    const anchorEl = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    if (!anchorEl?.closest(".markdown-preview-view")) {
      this.hideToolbar();
      return;
    }
    const mapped = this.selectionToSource(doc);
    if (!mapped) {
      this.hideToolbar();
      return;
    }
    const tb = this.toolbar ?? this.buildToolbar(doc);
    tb.classList.remove("is-hidden");
    const w = tb.offsetWidth || 180;
    const h = tb.offsetHeight || 32;
    const win = doc.defaultView ?? window;
    let left = mapped.rect.left + mapped.rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, win.innerWidth - w - 8));
    let top = mapped.rect.top - h - 8;
    if (top < 8) top = mapped.rect.bottom + 8;
    tb.style.left = `${Math.round(left)}px`;
    tb.style.top = `${Math.round(top)}px`;
  }

  private buildToolbar(doc: Document): HTMLElement {
    const tb = doc.body.createDiv({ cls: "cq-toolbar cq-toolbar-fixed" });
    tb.addEventListener("mousedown", (ev) => ev.preventDefault());
    for (const type of MARK_TYPES) {
      const b = tb.createEl("button", { cls: `cq-toolbar-btn cq-tb-${type}`, attr: { "aria-label": TYPE_LABEL[type] } });
      setIcon(b, TYPE_ICON[type]);
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        void this.markSelection(doc, type as MarkType);
      });
    }
    this.toolbar = tb;
    return tb;
  }

  hideToolbar(): void {
    this.toolbar?.classList.add("is-hidden");
  }

  async markSelection(doc: Document, type: MarkType): Promise<void> {
    const mapped = this.selectionToSource(doc);
    this.hideToolbar();
    if (!mapped) return;
    const rect = mapped.rect;
    const anchor = new DOMRect(rect.left, rect.top, rect.width, rect.height);
    doc.getSelection()?.removeAllRanges();
    await this.plugin.authoring.mark(this.targetFor(mapped.section), mapped.section.parsed, mapped.from, mapped.to, type, anchor, doc, false);
  }

  readonly onContextMenu = (ev: MouseEvent): void => {
    const target = ev.target as HTMLElement;
    if (!target.closest?.(".markdown-preview-view")) return;
    const doc = target.ownerDocument;
    const mapped = this.selectionToSource(doc);
    if (!mapped) return;
    ev.preventDefault();
    const menu = new Menu();
    for (const type of MARK_TYPES) {
      menu.addItem((i) =>
        i
          .setTitle(TYPE_LABEL[type])
          .setIcon(TYPE_ICON[type])
          .setSection("critique")
          .onClick(() => void this.markSelection(doc, type as MarkType)),
      );
    }
    menu.addItem((i) =>
      i
        .setTitle("Copy")
        .setIcon("copy")
        .setSection("clipboard")
        .onClick(() => void navigator.clipboard.writeText(doc.getSelection()?.toString() ?? "")),
    );
    menu.showAtMouseEvent(ev);
  };

  destroy(): void {
    this.toolbar?.remove();
    this.toolbar = null;
  }
}

interface TrayItem {
  markId: number;
  type: MarkType;
  count: number;
  resolved: boolean;
  author: string | null;
}

function wantsIndicator(m: Mark, thread: Thread | null, s: CritiqueSettings): boolean {
  const isRoot = m.type === "comment" && !!thread && thread.comments[0] === m.id;
  if (s.markStyle === "off") {
    if (m.type === "comment") return isRoot && thread!.anchor === null;
    return true;
  }
  if (!s.indicatorsReading) return false;
  return isRoot;
}

function firstTextIn(n: Node): Text | null {
  const w = n.ownerDocument!.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  return (w.nextNode() as Text | null) ?? null;
}

function lastTextIn(n: Node): Text | null {
  const w = n.ownerDocument!.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let c: Node | null;
  while ((c = w.nextNode())) last = c as Text;
  return last;
}
