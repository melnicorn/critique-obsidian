// Live Preview renders tables as a widget of plain HTML cells that CodeMirror decorations cannot
// reach. Watch for those cells and decorate them from their rendered DOM instead.
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type CritiquePlugin from "../main";

export function tableCells(plugin: CritiquePlugin) {
  return ViewPlugin.fromClass(
    class {
      observer: MutationObserver;
      scheduled = false;

      constructor(readonly view: EditorView) {
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.schedule();
      }

      schedule(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        window.requestAnimationFrame(() => {
          this.scheduled = false;
          this.process();
        });
      }

      process(): void {
        const cells = this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-table-widget .table-cell-wrapper");
        if (!cells.length) return;
        const path = this.view.state.field(editorInfoField, false)?.file?.path ?? "";
        for (const cell of Array.from(cells)) {
          // Obsidian refreshes a cell's content in place after an edit, dropping our spans: start over then.
          if (cell.dataset.cqSection && !cell.querySelector("[data-cq-id]")) {
            delete cell.dataset.cqSection;
            delete cell.dataset.cqDone;
          }
          if (cell.dataset.cqDone === plugin.instanceId && (!cell.dataset.cqSection || plugin.reading.knows(cell))) continue;
          cell.dataset.cqDone = plugin.instanceId;
          if (cell.querySelector(".cm-editor")) continue; // the cell being edited is a nested editor
          plugin.reading.decorateRendered(cell, path);
        }
      }

      destroy(): void {
        this.observer.disconnect();
      }
    },
  );
}
