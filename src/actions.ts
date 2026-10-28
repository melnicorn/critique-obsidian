// Bridges the pure operations to a file: reads the live text, rebases edits and writes them
// through the open editor when there is one, or through the vault otherwise.
import { Notice, TFile, normalizePath, type App, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { counts, isChange, parse, type Mark, type ParseResult, type Thread } from "./parser";
import { sameAuthor } from "./authors";
import { stripAgentHeader } from "./agent-header";
import * as ops from "./operations";
import type { Attrs, Decision, Edit, InsertOptions } from "./operations";
import { formatTimestamp } from "./time";
import type { MarkType } from "./syntax";
import type CritiquePlugin from "./main";
import { confirm } from "./ui/confirm";
import { hasAgentHeader, insertAgentHeader, removeAgentHeader } from "./agent-header";

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
    let textBefore = "";
    let textAfter = "";
    await this.app.vault.process(t.file, (data) => {
      const rebased = ops.rebaseAll(data, edits);
      if (!rebased) {
        ok = false;
        return data;
      }
      textBefore = data;
      textAfter = ops.applyEdits(data, rebased);
      return textAfter;
    });
    if (ok) this.plugin.vaultHistory.record(t.file, textBefore, textAfter);
    return ok ? true : fail();
  }

  // ---------- High-level actions. `parsed` is the parse the caller is holding; edits are rebased. ----------

  async decide(t: Target, parsed: ParseResult, mark: Mark, decision: Decision): Promise<boolean> {
    const ok = await this.apply(t, ops.decideMark(parsed.text, parsed, mark, decision));
    if (ok) await this.cleanupHeader(t);
    return ok;
  }

  /** With the agent header option on, drop the header once a note has no marks left. */
  private async cleanupHeader(t: Target): Promise<void> {
    if (!this.plugin.settings.agentHeader) return;
    const text = await this.readText(t);
    if (text === null || !hasAgentHeader(text) || parse(text).marks.length) return;
    const e = removeAgentHeader(text);
    if (e) await this.apply(t, [e]);
  }

  /** Insert the agent header into a note by hand. */
  async addHeader(t: Target): Promise<boolean> {
    const text = await this.readText(t);
    if (text === null) return false;
    const e = insertAgentHeader(text, this.plugin.settings.agentGuideUrl);
    if (!e) {
      new Notice("Critique: this note already has the agent guide header.");
      return false;
    }
    return this.apply(t, [e]);
  }

  async removeHeader(t: Target): Promise<boolean> {
    const text = await this.readText(t);
    if (text === null) return false;
    const e = removeAgentHeader(text);
    if (!e) {
      new Notice("Critique: this note has no agent guide header.");
      return false;
    }
    return this.apply(t, [e]);
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
    const ok = await this.apply(t, edits);
    if (ok) await this.cleanupHeader(t);
    return ok;
  }

  async decideInSelection(t: Target, parsed: ParseResult, from: number, to: number, decision: Decision): Promise<boolean> {
    const edits = ops.decideInRange(parsed.text, parsed, from, to, decision);
    if (!edits.length) {
      new Notice("Critique: no changes in the selection.");
      return false;
    }
    const ok = await this.apply(t, edits);
    if (ok) await this.cleanupHeader(t);
    return ok;
  }

  /** Accept or reject every change by one author. */
  async decideAllBy(t: Target, parsed: ParseResult, decision: Decision, author: string | null): Promise<boolean> {
    const who = author ?? "";
    const edits = ops.decideAll(parsed.text, parsed, decision, (m) => isChange(m) && (author === null ? !m.meta.author : sameAuthor(m.meta.author, who)));
    if (!edits.length) {
      new Notice("Critique: no changes by that author.");
      return false;
    }
    const label = author ?? "unsigned";
    const ok = await confirm(this.app, `${decision === "accept" ? "Accept" : "Reject"} all changes by ${label}?`, `${edits.length} change${edits.length === 1 ? "" : "s"} will be ${decision === "accept" ? "accepted" : "rejected"}.`, decision === "accept" ? "Accept" : "Reject");
    if (!ok) return false;
    const applied = await this.apply(t, edits);
    if (applied) await this.cleanupHeader(t);
    return applied;
  }

  /** Apply every change, drop every highlight, comment and the agent header: the clean note, in place. */
  async finalize(t: Target): Promise<boolean> {
    const text = await this.readText(t);
    if (text === null || !t.file) return false;
    const parsed = parse(text);
    if (!parsed.marks.length) {
      new Notice("Critique: nothing to finalize; the note has no marks.");
      return false;
    }
    const c = counts(parsed);
    const backup = this.plugin.settings.finalizeBackup;
    const ok = await confirm(
      this.app,
      "Finalize note?",
      `Every change is accepted (${c.changes}), every highlight unwrapped (${c.highlights}) and every comment thread removed (${c.openThreads + c.resolvedThreads}), leaving a clean note. ${backup ? "A backup copy is saved next to the note first." : "No backup copy will be made."}`,
      "Finalize",
    );
    if (!ok) return false;
    if (backup) {
      const path = await this.siblingPath(t.file, `review backup ${stamp()}`);
      await this.app.vault.create(path, text);
      new Notice(`Critique: backup saved as ${path.split("/").pop()}`);
    }
    const final = stripAgentHeader(ops.plainText(text, parsed, "accept"));
    return this.apply(t, [{ from: 0, to: text.length, insert: final, expected: text }]);
  }

  /** Write a sibling note in strict CriticMarkup (no attribute prefixes) and open it. */
  async exportStrict(t: Target): Promise<boolean> {
    const text = await this.readText(t);
    if (text === null || !t.file) return false;
    const parsed = parse(text);
    const out = stripAgentHeader(ops.stripMetadata(text, parsed));
    const path = await this.siblingPath(t.file, "strict");
    const file = await this.app.vault.create(path, out);
    await this.app.workspace.getLeaf("tab").openFile(file);
    new Notice(`Critique: exported ${file.basename}`);
    return true;
  }

  private async siblingPath(file: TFile, suffix: string): Promise<string> {
    const dir = file.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
    let n = 0;
    for (;;) {
      const candidate = normalizePath(`${dir}${file.basename} (${suffix}${n ? ` ${n}` : ""}).${file.extension}`);
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
      n++;
    }
  }

  async deleteComment(t: Target, parsed: ParseResult, mark: Mark): Promise<boolean> {
    if (this.plugin.settings.confirmDelete) {
      const ok = await confirm(this.app, "Delete comment?", "The comment is removed from the note.");
      if (!ok) return false;
    }
    const ok = await this.apply(t, ops.deleteComment(parsed.text, parsed, mark));
    if (ok) await this.cleanupHeader(t);
    return ok;
  }

  async deleteThread(t: Target, parsed: ParseResult, thread: Thread): Promise<boolean> {
    if (this.plugin.settings.confirmDelete) {
      const n = thread.comments.length;
      const ok = await confirm(this.app, "Delete thread?", `${n} comment${n === 1 ? "" : "s"} will be removed from the note. A highlight anchor is unwrapped; a change stays.`);
      if (!ok) return false;
    }
    const ok = await this.apply(t, ops.deleteThread(parsed.text, parsed, thread));
    if (ok) await this.cleanupHeader(t);
    return ok;
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
    const edits = [...r.edits];
    let cursor = r.cursor;
    let select = r.select;
    // First mark in a note: add the agent guide header when the option is on.
    if (this.plugin.settings.agentHeader && parsed.marks.length === 0) {
      const h = insertAgentHeader(parsed.text, this.plugin.settings.agentGuideUrl);
      if (h && !edits.some((e) => e.from < h.from && e.to > h.from)) {
        edits.push(h);
        const shift = (pos: number) => (h.from <= pos ? pos + h.insert.length : pos);
        if (cursor !== undefined) cursor = shift(cursor);
        if (select) select = { from: shift(select.from), to: shift(select.to) };
      }
    }
    return this.apply(t, edits, { cursor, select, focus });
  }

  /** Copy text to the clipboard. */
  async copy(text: string, what: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    new Notice(`Critique: ${what} copied.`);
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}
