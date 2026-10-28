// Opens a card for a mark or thread in a floating popover, from the editor or Reading mode.
import type { EditorView } from "@codemirror/view";
import type { Target } from "../actions";
import { parsedOf } from "../editor/state";
import { threadOf, type Mark, type ParseResult } from "../parser";
import type CritiquePlugin from "../main";
import { collectItems, renderItem, type CardHost, type Item } from "./card";
import { Popover, closeAllPopovers, type AnchorRect } from "./popover";

export function itemForMark(parsed: ParseResult, mark: Mark): Item | null {
  const items = collectItems(parsed);
  if (mark.type !== "comment") return items.find((i) => i.kind === "mark" && i.mark.id === mark.id) ?? null;
  const t = threadOf(parsed, mark);
  if (!t) return null;
  if (t.anchor !== null) return items.find((i) => i.kind === "mark" && i.mark.id === t.anchor) ?? null;
  return items.find((i) => i.kind === "thread" && i.thread.id === t.id) ?? null;
}

export class ThreadPopovers {
  private current: Popover | null = null;
  private currentKey = "";

  constructor(private plugin: CritiquePlugin) {}

  cancelClose(): void {
    this.current?.cancelHoverClose();
  }

  scheduleClose(): void {
    this.current?.scheduleHoverClose();
  }

  closeCurrent(): void {
    this.current?.close();
    this.current = null;
  }

  openForEditor(view: EditorView, target: Target, markId: number, pinned: boolean): void {
    const parsed = parsedOf(view.state);
    const mark = parsed.marks[markId];
    if (!mark) return;
    const anchor: AnchorRect = () => {
      const pieces = view.contentDOM.querySelectorAll<HTMLElement>(`[data-cq-id="${markId}"]`);
      if (!pieces.length) return null;
      return unionRect(Array.from(pieces).map((p) => p.getBoundingClientRect()));
    };
    this.open(view.dom.ownerDocument, anchor, target, parsed, mark, pinned, (m) => {
      view.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true });
      view.focus();
    }, target.file?.path ?? "");
  }

  open(doc: Document, anchor: AnchorRect, target: Target, parsed: ParseResult, mark: Mark, pinned: boolean, jumpTo: (m: Mark) => void, sourcePath: string): void {
    const item = itemForMark(parsed, mark);
    if (!item) return;
    const key = `${sourcePath}:${item.kind}:${item.from}`;
    if (this.current?.isOpen && this.currentKey === key) {
      if (pinned) this.current.pin();
      else this.current.cancelHoverClose();
      return;
    }
    closeAllPopovers();
    const pop = new Popover(doc, anchor, { hover: !pinned, cls: "cq-thread-popover", onClose: () => (this.current === pop ? (this.current = null) : null) });
    if (pinned) pop.pin();
    this.current = pop;
    this.currentKey = key;
    const host: CardHost = {
      app: this.plugin.app,
      settings: this.plugin.settings,
      actions: this.plugin.actions,
      target,
      component: pop.component,
      parsed,
      sourcePath,
      jumpTo: (m) => {
        pop.close();
        jumpTo(m);
      },
      afterChange: () => pop.close(),
      setBusy: () => pop.pin(),
    };
    renderItem(pop.el, item, host, { compact: true, openReply: false });
    pop.show();
  }
}

export function unionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}
