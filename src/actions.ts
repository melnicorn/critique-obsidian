// Bridges the pure operations to a file: reads the live text, rebases edits and writes them
// through the open editor when there is one, or through the vault otherwise.
import { Notice, TFile, type App, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { parse, type Mark, type ParseResult, type Thread } from "./parser";
import * as ops from "./operations";
import type { Attrs, Decision, Edit, InsertOptions } from "./operations";
import { formatTimestamp } from "./time";
import type { MarkType } from "./syntax";
import type CritiquePlugin from "./main";
import { confirm } from "./ui/confirm";

export interface Target {
  file: TFile | null;
  /** The editor to write through, when the note is open in an editing mode. */
  editor: Editor | null;
}

export interface After {
  /** Cursor position in the post-edit document, relative to the first edit's original offset. */
  cursor?: number;
  select?: { from: number; to: number };
  focus?: boolean;
}

function cmOf(editor: Editor): EditorView | null {
  const cm = (editor as unknown as { cm?: EditorView }).cm;
  return cm && typeof cm.dispatch === "function" ? cm : null;
}

export class Actions {
  constructor(private plugin: CritiquePlugin) {}

  get app(): App {
    return this.plugin.app;
  }

  /** author/date attributes for a mark created now. */
  signature(extra: Attrs = {}): Attrs {
    const s = this.plugin.settings;
    return {
      author: s.authorName || null,
      date: s.addTimestamps ? formatTimestamp(new Date(), s.timestampPrecision) : null,
      ...extra,
    };
  }

  now(): string {
    return formatTimestamp(new Date(), this.plugin.settings.timestampPrecision);
  }

  async readText(t: Target): Promise<string | null> {
    if (t.editor) return t.editor.getValue();
    if (t.file) return this.app.vault.cachedRead(t.file);
    return null;
  }

  async parseTarget(t: Target): Promise<ParseResult | null> {
    const text = await this.readText(t);
    return text === null ? null : parse(text);
  }

  /** Apply edits to the target, re-validating them against the live text first. */
  async apply(t: Target, edits: Edit[], after: After = {}): Promise<boolean> {
    if (!edits.length) return true;
    const fail = () => {
      new Notice("Critique: the note changed under this action. Nothing was written; try again.");
      return false;
    };
    if (t.editor) {
      const editor = t.editor;
      const doc = editor.getValue();
      const rebased = ops.rebaseAll(doc, edits);
      if (!rebased) return fail();
      const delta = rebased[0].from - edits[0].from;
      const cm = cmOf(editor);
      if (cm) {
        const spec: Parameters<EditorView["dispatch"]>[0] = { changes: rebased.map((e) => ({ from: e.from, to: e.to, insert: e.insert })) };
        if (after.select) spec.selection = { anchor: after.select.from + delta, head: after.select.to + delta };
        else if (after.cursor !== undefined) spec.selection = { anchor: after.cursor + delta };
        spec.scrollIntoView = after.focus === true;
        cm.dispatch(spec);
        if (after.focus) cm.focus();
      } else {
        editor.transaction({ changes: rebased.map((e) => ({ from: editor.offsetToPos(e.from), to: editor.offsetToPos(e.to), text: e.insert })) });
        if (after.select) editor.setSelection(editor.offsetToPos(after.select.from + delta), editor.offsetToPos(after.select.to + delta));
        else if (after.cursor !== undefined) editor.setCursor(editor.offsetToPos(after.cursor + delta));
        if (after.focus) editor.focus();
      }
      return true;
    }
    if (!t.file) return false;
    let ok = true;
    await this.app.vault.process(t.file, (data) => {
      const rebased = ops.rebaseAll(data, edits);
      if (!rebased) {
        ok = false;
        return data;
      }
      return ops.applyEdits(data, rebased);
    });
    return ok ? true : fail();
  }

  // ---------- High-level actions. `parsed` is the parse the caller is holding; edits are rebased. ----------

  decide(t: Target, parsed: ParseResult, mark: Mark, decision: Decision): Promise<boolean> {
    return this.apply(t, ops.decideMark(parsed.text, parsed, mark, decision));
  }

  async decideAll(t: Target, parsed: ParseResult, decision: Decision, confirmFirst = true): Promise<boolean> {
    const edits = ops.decideAll(parsed.text, parsed, decision);
    if (!edits.length) {
      new Notice("Critique: no pending changes.");
      return false;
    }
    if (confirmFirst) {
      const ok = await confirm(this.app, decision === "accept" ? "Accept all changes?" : "Reject all changes?", `${edits.length} change${edits.length === 1 ? "" : "s"} in this note will be ${decision === "accept" ? "accepted" : "rejected"}. Comments attached to them are removed; standalone comments stay.`, decision === "accept" ? "Accept all" : "Reject all");
      if (!ok) return false;
    }
    return this.apply(t, edits);
  }

  async deleteComment(t: Target, parsed: ParseResult, mark: Mark): Promise<boolean> {
    if (this.plugin.settings.confirmDelete) {
      const ok = await confirm(this.app, "Delete comment?", "The comment is removed from the note.");
      if (!ok) return false;
    }
    return this.apply(t, ops.deleteComment(parsed.text, parsed, mark));
  }

  async deleteThread(t: Target, parsed: ParseResult, thread: Thread): Promise<boolean> {
    if (this.plugin.settings.confirmDelete) {
      const n = thread.comments.length;
      const ok = await confirm(this.app, "Delete thread?", `${n} comment${n === 1 ? "" : "s"} will be removed from the note. A highlight anchor is unwrapped; a change stays.`);
      if (!ok) return false;
    }
    return this.apply(t, ops.deleteThread(parsed.text, parsed, thread));
  }

  setStatus(t: Target, parsed: ParseResult, thread: Thread, status: string | null): Promise<boolean> {
    return this.apply(t, ops.setThreadStatus(parsed.text, parsed, thread, status));
  }

  reply(t: Target, parsed: ParseResult, thread: Thread, text: string, label: string | null = null): Promise<boolean> {
    return this.apply(t, ops.replyToThread(parsed.text, parsed, thread, text, this.signature({ label })));
  }

  editComment(t: Target, parsed: ParseResult, mark: Mark, text: string): Promise<boolean> {
    const edited = this.plugin.settings.recordEditTime ? this.now() : null;
    return this.apply(t, ops.editComment(parsed.text, mark, text, edited));
  }

  /** Wrap [from, to] of the target's text in a mark. Returns false (with a Notice) when refused. */
  async insert(t: Target, parsed: ParseResult, from: number, to: number, type: MarkType, opts: Omit<InsertOptions, "attrs"> & { label?: string | null } = {}, focus = true): Promise<boolean> {
    const r = ops.insertMark(parsed.text, parsed, from, to, type, { ...opts, attrs: this.signature(type === "comment" ? { label: opts.label ?? null } : {}) });
    if ("error" in r) {
      new Notice(`Critique: ${r.error}`);
      return false;
    }
    return this.apply(t, r.edits, { cursor: r.cursor, select: r.select, focus });
  }

  /** Copy text to the clipboard. */
  async copy(text: string, what: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    new Notice(`Critique: ${what} copied.`);
  }
}
