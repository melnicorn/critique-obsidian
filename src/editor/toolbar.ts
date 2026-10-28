// Selection toolbar: appears above a non-empty selection in the editor.
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { setIcon } from "obsidian";
import type CritiquePlugin from "../main";
import { MARK_TYPES, type MarkType } from "../syntax";
import { TYPE_ICON, TYPE_LABEL } from "../ui/dom";
import { settingsFacet } from "./state";

export function selectionToolbar(plugin: CritiquePlugin) {
  return ViewPlugin.fromClass(
    class {
      el: HTMLElement | null = null;
      timer: number | null = null;
      dragging = false;
      private readonly onMouseDown = () => {
        this.dragging = true;
        this.hide();
      };
      private readonly onMouseUp = () => {
        this.dragging = false;
        this.schedule(80);
      };
      private readonly onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") this.hide();
      };

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("mousedown", this.onMouseDown);
        view.dom.ownerDocument.addEventListener("mouseup", this.onMouseUp);
        view.contentDOM.addEventListener("keydown", this.onKeyDown);
      }

      update(u: ViewUpdate): void {
        if (u.selectionSet || u.docChanged || u.focusChanged) this.schedule(u.docChanged ? 400 : 250);
        else if (u.viewportChanged || u.geometryChanged) this.position();
      }

      schedule(ms: number): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.refresh();
        }, ms);
      }

      refresh(): void {
        const s = this.view.state.facet(settingsFacet);
        const sel = this.view.state.selection.main;
        if (!s.showToolbar || this.dragging || sel.empty || !this.view.hasFocus || this.view.state.selection.ranges.length > 1) {
          this.hide();
          return;
        }
        if (!this.el) this.el = this.build();
        this.el.removeClass("is-hidden");
        this.position();
      }

      build(): HTMLElement {
        const el = this.view.scrollDOM.createDiv({ cls: "cq-toolbar" });
        el.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        });
        for (const type of MARK_TYPES) {
          const b = el.createEl("button", { cls: `cq-toolbar-btn cq-tb-${type}`, attr: { "aria-label": TYPE_LABEL[type] } });
          setIcon(b, TYPE_ICON[type]);
          b.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.hide();
            void plugin.authoring.markInEditor(this.view, type as MarkType);
          });
        }
        return el;
      }

      position(): void {
        if (!this.el || this.el.hasClass("is-hidden")) return;
        const sel = this.view.state.selection.main;
        const head = this.view.coordsAtPos(sel.from);
        const tail = this.view.coordsAtPos(sel.to);
        if (!head) {
          this.el.addClass("is-hidden");
          return;
        }
        const scroll = this.view.scrollDOM;
        const base = scroll.getBoundingClientRect();
        const w = this.el.offsetWidth || 180;
        const h = this.el.offsetHeight || 32;
        // Above the first selected line, horizontally centred on the selection when it is on one line.
        const sameLine = tail && Math.abs(tail.top - head.top) < 2;
        const centre = sameLine && tail ? (head.left + tail.right) / 2 : head.left + w / 2;
        let left = centre - base.left + scroll.scrollLeft - w / 2;
        left = Math.max(4, Math.min(left, scroll.clientWidth - w - 4));
        let top = head.top - base.top + scroll.scrollTop - h - 8;
        if (top < scroll.scrollTop + 2) top = (tail ?? head).bottom - base.top + scroll.scrollTop + 8;
        this.el.style.left = `${Math.round(left)}px`;
        this.el.style.top = `${Math.round(top)}px`;
      }

      hide(): void {
        this.el?.addClass("is-hidden");
      }

      destroy(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.view.contentDOM.removeEventListener("mousedown", this.onMouseDown);
        this.view.dom.ownerDocument.removeEventListener("mouseup", this.onMouseUp);
        this.view.contentDOM.removeEventListener("keydown", this.onKeyDown);
        this.el?.remove();
      }
    },
  );
}
