// Undo and redo for writes Critique makes through the vault (Reading mode, or the panel while a
// note is in Reading mode), where no editor history exists. Each entry is a before/after snapshot
// of the whole note; an entry applies only while the note still reads exactly as it did after the
// write, so an edit made elsewhere in between simply drops the stale entries.
import { Notice, TFile, type App } from "obsidian";

interface Entry {
  path: string;
  before: string;
  after: string;
}

const LIMIT = 50;

export class VaultHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  constructor(private app: App) {}

  record(file: TFile, before: string, after: string): void {
    if (before === after) return;
    this.undoStack.push({ path: file.path, before, after });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo(file: TFile): Promise<boolean> {
    return this.step(file, this.undoStack, this.redoStack, "after", "before", "Nothing to undo for this note.");
  }

  async redo(file: TFile): Promise<boolean> {
    return this.step(file, this.redoStack, this.undoStack, "before", "after", "Nothing to redo for this note.");
  }

  private async step(file: TFile, from: Entry[], to: Entry[], expect: "before" | "after", restore: "before" | "after", empty: string): Promise<boolean> {
    // Drop entries for other notes from the top only when they are stale; look for the newest for this note.
    let idx = from.length - 1;
    while (idx >= 0 && from[idx].path !== file.path) idx--;
    if (idx < 0) {
      new Notice(`Critique: ${empty}`);
      return false;
    }
    const entry = from[idx];
    const current = await this.app.vault.read(file);
    if (current !== entry[expect]) {
      from.splice(idx, 1);
      new Notice("Critique: the note changed since that action; nothing to undo here.");
      return false;
    }
    from.splice(idx, 1);
    await this.app.vault.modify(file, entry[restore]);
    to.push(entry);
    return true;
  }
}
