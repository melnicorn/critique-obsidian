// Decorations for Live Preview and Source mode, plus the per-line margin tray widgets.
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { StateField } from "@codemirror/state";
import { threadOf, type Mark, type ParseResult, type Thread } from "../parser";
import { authorColor } from "../authors";
import { parseField, settingsChanged, settingsFacet } from "./state";
import type { CritiqueSettings } from "../settings";
import { TYPE_ICON } from "../ui/dom";
import { setIcon } from "obsidian";
import { parseTimestamp, relativeTime } from "../time";
import { findAgentHeader } from "../agent-header";

export interface TrayItem {
  markId: number;
  type: Mark["type"];
  count: number;
  resolved: boolean;
  author: string | null;
}

export type TrayClickHandler = (view: EditorView, markId: number, el: HTMLElement) => void;

class TrayWidget extends WidgetType {
  constructor(
    readonly items: TrayItem[],
    readonly onClick: TrayClickHandler,
    readonly colorByAuthor: boolean,
  ) {
    super();
  }

  eq(other: TrayWidget): boolean {
    if (other.items.length !== this.items.length) return false;
    return this.items.every((it, i) => {
      const o = other.items[i];
      return it.markId === o.markId && it.type === o.type && it.count === o.count && it.resolved === o.resolved && it.author === o.author;
    });
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("span");
    host.className = "cq-tray-host";
    const tray = host.appendChild(document.createElement("span"));
    tray.className = "cq-tray";
    for (const it of this.items) {
      const b = tray.appendChild(document.createElement("button"));
      b.className = `cq-tray-item cq-tray-${it.type} ${it.resolved ? "cq-resolved" : ""}`.trim();
      b.dataset.cqId = String(it.markId);
      b.setAttribute("aria-label", it.type === "comment" ? `${it.count} comment${it.count === 1 ? "" : "s"}` : it.type);
      const c = this.colorByAuthor ? authorColor(it.author) : null;
      if (c) b.style.setProperty("--cq-author", c);
      setIcon(b, it.type === "comment" ? "message-square" : TYPE_ICON[it.type]);
      if (it.count > 1) {
        const n = b.appendChild(document.createElement("span"));
        n.className = "cq-tray-count";
        n.textContent = String(it.count);
      }
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onClick(view, it.markId, b);
      });
    }
    return host;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ArrowWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cq-sub-arrow";
    s.textContent = "→";
    return s;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class ChipWidget extends WidgetType {
  constructor(
    readonly markId: number,
    readonly count: number,
    readonly resolved: boolean,
    readonly author: string | null,
    readonly colorByAuthor: boolean,
  ) {
    super();
  }
  eq(o: ChipWidget): boolean {
    return o.markId === this.markId && o.count === this.count && o.resolved === this.resolved && o.author === this.author;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = `cq-chip ${this.resolved ? "cq-resolved" : ""}`.trim();
    s.dataset.cqId = String(this.markId);
    const c = this.colorByAuthor ? authorColor(this.author) : null;
    if (c) s.style.setProperty("--cq-author", c);
    setIcon(s, "message-square");
    if (this.count > 1) s.appendChild(document.createTextNode(String(this.count)));
    return s;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class MetaChipWidget extends WidgetType {
  constructor(
    readonly author: string | null,
    readonly date: string | null,
  ) {
    super();
  }
  eq(o: MetaChipWidget): boolean {
    return o.author === this.author && o.date === this.date;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cq-meta-chip";
    const d = parseTimestamp(this.date);
    s.textContent = `@${this.author ?? "?"}${d ? " · " + relativeTime(d) : ""}`;
    return s;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class GuideChipWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cq-guide-chip";
    setIcon(s, "bot");
    s.appendChild(document.createTextNode("Critique agent guide"));
    s.setAttribute("aria-label", "Hidden HTML comment that points AI agents at the Critique guide. Click into the line to see it.");
    return s;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const arrowWidget = new ArrowWidget();
const guideChip = new GuideChipWidget();

function wantsIndicator(m: Mark, thread: Thread | null, s: CritiqueSettings): boolean {
  const isRoot = m.type === "comment" && !!thread && thread.comments[0] === m.id;
  if (s.markStyle === "off") {
    if (m.type === "comment") return isRoot && thread!.anchor === null;
    return true;
  }
  if (!s.indicatorsEditor) return false;
  return isRoot;
}

export function buildDecorations(state: EditorState, onTrayClick: TrayClickHandler): DecorationSet {
  const parsed: ParseResult = state.field(parseField);
  const s = state.facet(settingsFacet);
  const lp = state.field(editorLivePreviewField, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  const sel = state.selection.ranges;
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const trayByLine = new Map<number, TrayItem[]>();

  const mark = (from: number, to: number, spec: Parameters<typeof Decoration.mark>[0]) => {
    if (from < to) ranges.push(Decoration.mark(spec).range(from, to));
  };
  const hide = (from: number, to: number) => {
    if (from < to) ranges.push(Decoration.replace({}).range(from, to));
  };

  for (const m of parsed.marks) {
    const thread = threadOf(parsed, m);
    const isCmt = m.type === "comment";
    const isRoot = isCmt && !!thread && thread.comments[0] === m.id;
    const anchored = isCmt && !!thread && thread.anchor !== null;
    const reveal = !lp || touches(m.from, m.to);
    const mine = !!s.authorName && m.meta.author === s.authorName;

    if (isCmt && !reveal) {
      if (anchored || !isRoot) hide(m.from, m.to);
      else ranges.push(Decoration.replace({ widget: new ChipWidget(m.id, thread!.comments.length, thread!.resolved, m.meta.author, s.colorByAuthor) }).range(m.from, m.to));
    } else {
      const cls = ["cq-mark", `cq-${m.type}`];
      if (thread) cls.push(thread.resolved ? "cq-resolved" : "cq-threaded");
      if (m.type === "highlight" && thread) cls.push("cq-anchor");
      if (mine) cls.push("cq-mine");
      if (reveal) cls.push("cq-revealed");
      const attributes: Record<string, string> = { "data-cq-id": String(m.id) };
      const color = s.colorByAuthor ? authorColor(isCmt ? m.meta.author : thread ? parsed.marks[thread.comments[0]].meta.author : m.meta.author) : null;
      if (color) attributes.style = `--cq-author:${color}`;
      mark(m.from, m.to, { class: cls.join(" "), attributes });

      if (reveal) {
        mark(m.from, m.metaFrom, { class: "cq-syntax cq-open" });
        if (m.metaTo > m.metaFrom) {
          if (s.foldMetadata && !touches(m.metaFrom, m.metaTo)) ranges.push(Decoration.replace({ widget: new MetaChipWidget(m.meta.author, m.meta.date) }).range(m.metaFrom, m.metaTo));
          else mark(m.metaFrom, m.metaTo, { class: "cq-meta" });
        }
        mark(m.metaTo, m.contentFrom, { class: "cq-syntax cq-open" });
        mark(m.contentTo, m.to, { class: "cq-syntax cq-close" });
        if (m.sepFrom !== undefined) mark(m.sepFrom, m.sepFrom + 2, { class: "cq-syntax cq-sep" });
      } else {
        hide(m.from, m.contentFrom);
        hide(m.contentTo, m.to);
        if (m.sepFrom !== undefined) ranges.push(Decoration.replace({ widget: arrowWidget }).range(m.sepFrom, m.sepFrom + 2));
      }

      switch (m.type) {
        case "addition":
          mark(m.contentFrom, m.contentTo, { class: "cq-add-text" });
          break;
        case "deletion":
          mark(m.contentFrom, m.contentTo, { class: "cq-del-text" });
          break;
        case "substitution":
          mark(m.contentFrom, m.sepFrom!, { class: "cq-del-text cq-sub-old" });
          mark(m.sepFrom! + 2, m.contentTo, { class: "cq-add-text cq-sub-new" });
          break;
        case "highlight":
          mark(m.contentFrom, m.contentTo, { class: "cq-hl-text" });
          break;
        case "comment":
          mark(m.contentFrom, m.contentTo, { class: "cq-cmt-text" });
          break;
      }
    }

    if (wantsIndicator(m, thread, s)) {
      const items = trayByLine.get(m.line) ?? [];
      const rootAuthor = thread ? parsed.marks[thread.comments[0]].meta.author : m.meta.author;
      items.push({ markId: m.id, type: m.type, count: thread ? thread.comments.length : 1, resolved: !!thread?.resolved, author: rootAuthor });
      trayByLine.set(m.line, items);
    }
  }

  // The agent guide header folds to a chip in Live Preview unless the cursor is on it.
  if (lp) {
    const h = findAgentHeader(parsed.text);
    if (h && !touches(h.from, h.to)) ranges.push(Decoration.replace({ widget: guideChip }).range(h.from, h.to));
  }

  for (const [line, items] of trayByLine) {
    if (line + 1 > state.doc.lines) continue;
    const pos = state.doc.line(line + 1).from;
    ranges.push(Decoration.widget({ widget: new TrayWidget(items, onTrayClick, s.colorByAuthor), side: -1 }).range(pos));
  }

  return Decoration.set(ranges, true);
}

export function decorationsField(onTrayClick: TrayClickHandler): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, onTrayClick),
    update: (value, tr) => {
      const lpChanged = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
      if (tr.docChanged || tr.selection || lpChanged || tr.effects.some((e) => e.is(settingsChanged))) return buildDecorations(tr.state, onTrayClick);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
