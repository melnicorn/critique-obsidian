// One-gesture authoring: turns a selection into a mark, asking for text when the type needs it.
import type { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { Target } from "./actions";
import type { ParseResult } from "./parser";
import type { MarkType } from "./syntax";
import type CritiquePlugin from "./main";
import { promptText, type AnchorRect } from "./ui/popover";
import { TYPE_LABEL } from "./ui/dom";

export class Authoring {
  constructor(private plugin: CritiquePlugin) {}

  /** Create a mark of `type` over [from, to] in the target. Prompts for comment or replacement text near `anchor`. */
  async mark(target: Target, parsed: ParseResult, from: number, to: number, type: MarkType, anchor: AnchorRect, doc: Document, focus = true): Promise<boolean> {
    const s = this.plugin.settings;
    const actions = this.plugin.actions;
    if (type === "substitution") {
      const sel = parsed.text.slice(Math.min(from, to), Math.max(from, to)).trim();
      if (!sel) return actions.insert(target, parsed, from, to, "substitution", {}, focus);
      const r = await promptText(doc, anchor, { title: "Replace with", placeholder: "Replacement text", initial: sel, singleLine: !sel.includes("\n"), submitLabel: "Replace" });
      if (!r) return false;
      return actions.insert(target, parsed, from, to, "substitution", { newText: r.text }, focus);
    }
    if (type === "comment") {
      const r = await promptText(doc, anchor, { title: from === to ? "Comment" : `Comment on “${shorten(parsed.text.slice(Math.min(from, to), Math.max(from, to)))}”`, placeholder: "Write a comment…", labels: s.commentLabels ? s.labels : undefined, submitLabel: "Comment" });
      if (!r) return false;
      return actions.insert(target, parsed, from, to, "comment", { comment: r.text, label: r.label }, focus);
    }
    return actions.insert(target, parsed, from, to, type, {}, focus);
  }

  /** Mark the main selection of a CodeMirror editor. */
  async markInEditor(view: EditorView, type: MarkType): Promise<boolean> {
    const info = view.state.field(editorInfoField, false);
    const editor = info?.editor ?? null;
    const file = info?.file ?? null;
    if (!editor) return false;
    const sel = view.state.selection.main;
    const parsed = this.plugin.parsedForView(view);
    const anchor = () => rectAt(view, sel.to) ?? rectAt(view, sel.from);
    return this.mark({ file, editor }, parsed, sel.from, sel.to, type, anchor, view.dom.ownerDocument, true);
  }

  label(type: MarkType): string {
    return TYPE_LABEL[type];
  }
}

export function rectAt(view: EditorView, pos: number): DOMRect | null {
  const c = view.coordsAtPos(pos);
  if (!c) return null;
  return new DOMRect(c.left, c.top, Math.max(1, c.right - c.left), c.bottom - c.top);
}

export function shorten(s: string, n = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
