// Hover cards and click-to-open thread popovers for marks in the editor.
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type CritiquePlugin from "../main";
import { closeAllPopovers } from "../ui/popover";

export function hoverPlugin(plugin: CritiquePlugin) {
  return ViewPlugin.fromClass(
    class {
      timer: number | null = null;
      hoveredId: number | null = null;
      private readonly onOver = (ev: MouseEvent) => {
        const target = (ev.target as HTMLElement).closest?.("[data-cq-id]") as HTMLElement | null;
        if (!target || !this.view.contentDOM.contains(target)) return;
        const id = Number(target.dataset.cqId);
        if (Number.isNaN(id)) return;
        if (this.hoveredId === id) {
          plugin.threadPopovers.cancelClose();
          return;
        }
        this.hoveredId = id;
        this.clearTimer();
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.open(id, false);
        }, 450);
      };
      private readonly onOut = (ev: MouseEvent) => {
        const from = (ev.target as HTMLElement).closest?.("[data-cq-id]");
        const to = (ev.relatedTarget as HTMLElement | null)?.closest?.("[data-cq-id]") ?? null;
        if (from && to === from) return;
        this.hoveredId = null;
        this.clearTimer();
        plugin.threadPopovers.scheduleClose();
      };
      private readonly onClick = (ev: MouseEvent) => {
        const chip = (ev.target as HTMLElement).closest?.(".cq-chip") as HTMLElement | null;
        if (!chip) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.open(Number(chip.dataset.cqId), true);
      };

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("mouseover", this.onOver);
        view.contentDOM.addEventListener("mouseout", this.onOut);
        view.contentDOM.addEventListener("click", this.onClick);
      }

      update(u: ViewUpdate): void {
        if (u.docChanged) closeAllPopovers();
      }

      open(id: number, pinned: boolean): void {
        const info = this.view.state.field(editorInfoField, false);
        if (!info) return;
        plugin.threadPopovers.openForEditor(this.view, { file: info.file ?? null, editor: info.editor ?? null }, id, pinned);
      }

      clearTimer(): void {
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
          this.timer = null;
        }
      }

      destroy(): void {
        this.clearTimer();
        this.view.contentDOM.removeEventListener("mouseover", this.onOver);
        this.view.contentDOM.removeEventListener("mouseout", this.onOut);
        this.view.contentDOM.removeEventListener("click", this.onClick);
      }
    },
  );
}
