// Tells the review panel where the cursor is, so it can keep the matching card in view.
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type CritiquePlugin from "../main";

export function cursorSync(plugin: CritiquePlugin) {
  return ViewPlugin.fromClass(
    class {
      timer: number | null = null;
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate): void {
        if (!u.selectionSet || !u.view.hasFocus) return;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          const file = this.view.state.field(editorInfoField, false)?.file ?? null;
          plugin.panel()?.followCursor(file, this.view.state.selection.main.head);
        }, 150);
      }
      destroy(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
      }
    },
  );
}
