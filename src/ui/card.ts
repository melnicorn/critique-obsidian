// Card rendering shared by the review panel and the thread popover.
import { MarkdownRenderer, type App, type Component } from "obsidian";
import { commentText, isChange, threadOf, type Mark, type ParseResult, type Thread } from "../parser";
import type { Actions, Target } from "../actions";
import type { CritiqueSettings } from "../settings";
import { TYPE_ICON, TYPE_LABEL, button, byline, iconButton, iconEl, quoteEl } from "./dom";
import { sameAuthor } from "../authors";

export type Item = { kind: "mark"; mark: Mark; thread: Thread | null; from: number; to: number } | { kind: "thread"; thread: Thread; from: number; to: number };

/** Every mark id an item covers: the mark itself plus its thread's comments. */
export function itemMarkIds(item: Item): number[] {
  const t = itemThread(item);
  const ids = item.kind === "mark" ? [item.mark.id] : [];
  if (t) ids.push(...t.comments);
  return ids;
}

/** One item per change/highlight (with its rationale thread) and per standalone thread, in document order. */
export function collectItems(parsed: ParseResult): Item[] {
  const items: Item[] = [];
  for (const m of parsed.marks) {
    if (m.type !== "comment") {
      const t = threadOf(parsed, m);
      items.push({ kind: "mark", mark: m, thread: t, from: m.from, to: t ? t.to : m.to });
      continue;
    }
    const t = threadOf(parsed, m);
    if (t && t.anchor === null && t.comments[0] === m.id) items.push({ kind: "thread", thread: t, from: t.from, to: t.to });
  }
  return items;
}

export function itemThread(item: Item): Thread | null {
  return item.kind === "thread" ? item.thread : item.thread;
}

export interface CardHost {
  app: App;
  settings: CritiqueSettings;
  actions: Actions;
  target: Target;
  component: Component;
  parsed: ParseResult;
  sourcePath: string;
  /** Scroll the note to a mark. */
  jumpTo(mark: Mark): void;
  /** Called after an action wrote to the note. */
  afterChange(): void;
  /** Called after the user starts/stops typing in a card, so the host can hold re-renders. */
  setBusy?(busy: boolean): void;
  /** Called while the pointer is over a card, so the host can light up the marks in the note. */
  hoverMarks?(ids: number[] | null): void;
}

export interface CardOptions {
  compact?: boolean;
  /** Open the reply box right away. */
  openReply?: boolean;
  showJump?: boolean;
}

function fallbackAuthor(_host: CardHost): string {
  return "Unknown";
}

function isMine(host: CardHost, m: Mark): boolean {
  return sameAuthor(m.meta.author, host.settings.authorName);
}

export function itemMatchesMine(host: CardHost, item: Item): boolean {
  const t = itemThread(item);
  if (item.kind === "mark" && isMine(host, item.mark)) return true;
  if (t) return t.comments.some((id) => isMine(host, host.parsed.marks[id]));
  return false;
}

export function renderItem(parent: HTMLElement, item: Item, host: CardHost, opts: CardOptions = {}): HTMLElement {
  const thread = itemThread(item);
  const resolved = !!thread?.resolved;
  const card = parent.createDiv({ cls: `cq-card ${item.kind === "mark" ? `cq-card-${item.mark.type}` : "cq-card-thread"} ${resolved ? "cq-resolved" : ""} ${opts.compact ? "cq-compact" : ""}`.trim() });
  card.dataset.cqFrom = String(item.from);
  card.dataset.cqIds = itemMarkIds(item).join(",");
  if (host.hoverMarks) {
    card.addEventListener("mouseenter", () => host.hoverMarks?.(itemMarkIds(item)));
    card.addEventListener("mouseleave", () => host.hoverMarks?.(null));
  }

  // Header
  const head = card.createDiv({ cls: "cq-card-head" });
  const typeMark: Mark = item.kind === "mark" ? item.mark : host.parsed.marks[item.thread.comments[0]];
  // A highlight that carries a thread is shown as a comment on its quoted text.
  const asComment = item.kind === "thread" || (item.mark.type === "highlight" && !!thread);
  const typeKey = asComment ? "comment" : (item as { mark: Mark }).mark.type;
  iconEl(head, TYPE_ICON[typeKey], `cq-type-icon cq-type-${typeKey}`);
  head.createSpan({ cls: "cq-card-type", text: TYPE_LABEL[typeKey] });
  if (resolved) head.createSpan({ cls: "cq-badge", text: "Resolved" });
  const spacer = head.createSpan({ cls: "cq-spacer" });
  spacer.setText("");
  if (opts.showJump !== false) iconButton(head, "corner-down-right", "Show in note", () => host.jumpTo(typeMark), "cq-jump");
  if (!opts.compact) {
    card.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest("button, textarea, input, select, a, .cq-msg-text")) return;
      host.jumpTo(typeMark);
    });
  }

  // Mark body: byline + quote
  if (item.kind === "mark") {
    if (!asComment && (item.mark.meta.author || item.mark.meta.date)) byline(card, item.mark, fallbackAuthor(host), host.settings);
    quoteEl(card, item.mark);
  }

  // Thread messages
  if (thread) {
    const list = card.createDiv({ cls: "cq-messages" });
    for (const id of thread.comments) renderMessage(list, host.parsed.marks[id], host, card);
  }

  // Footer actions
  const foot = card.createDiv({ cls: "cq-card-actions" });
  const t = host.target;
  const after = () => host.afterChange();
  if (item.kind === "mark" && isChange(item.mark)) {
    button(foot, "Accept", { icon: "check", cls: "cq-accept", onClick: () => void host.actions.decide(t, host.parsed, item.mark, "accept").then(after) });
    button(foot, "Reject", { icon: "x", cls: "cq-reject", onClick: () => void host.actions.decide(t, host.parsed, item.mark, "reject").then(after) });
  } else if (item.kind === "mark" && item.mark.type === "highlight" && !thread) {
    button(foot, "Remove highlight", { icon: "eraser", onClick: () => void host.actions.decide(t, host.parsed, item.mark, "accept").then(after) });
  }
  if (thread) {
    const replyBtn = button(foot, "Reply", { icon: "reply", onClick: () => openReply() });
    button(foot, resolved ? "Reopen" : "Resolve", { icon: resolved ? "rotate-ccw" : "check-circle", onClick: () => void host.actions.setStatus(t, host.parsed, thread, resolved ? null : "resolved").then(after) });
    const del = iconButton(foot, "trash-2", "Delete thread", () => void host.actions.deleteThread(t, host.parsed, thread).then(after), "cq-danger");
    del.addClass("cq-push-right");
    const replyBox = card.createDiv({ cls: "cq-reply-box is-hidden" });
    const openReply = () => {
      if (!replyBox.hasClass("is-hidden")) {
        replyBox.querySelector("textarea")?.focus();
        return;
      }
      replyBox.removeClass("is-hidden");
      replyBtn.addClass("is-active");
      replyBox.empty();
      const ta = replyBox.createEl("textarea", { cls: "cq-reply-input", attr: { placeholder: "Reply…", rows: "2" } });
      let labelSel: HTMLSelectElement | null = null;
      const row = replyBox.createDiv({ cls: "cq-popover-actions" });
      if (host.settings.commentLabels && host.settings.labels.length) {
        labelSel = row.createEl("select", { cls: "dropdown cq-label-select" });
        labelSel.createEl("option", { value: "", text: "No label" });
        for (const l of host.settings.labels) labelSel.createEl("option", { value: l, text: l });
      }
      row.createSpan({ cls: "cq-hint", text: "⌘↩" });
      const cancel = () => {
        replyBox.addClass("is-hidden");
        replyBtn.removeClass("is-active");
        host.setBusy?.(false);
      };
      const send = () => {
        const text = ta.value.trim();
        if (!text) return;
        host.setBusy?.(false);
        void host.actions.reply(t, host.parsed, thread, text, labelSel?.value || null).then(after);
      };
      button(row, "Cancel", { onClick: cancel });
      button(row, "Reply", { cls: "mod-cta", onClick: send });
      ta.addEventListener("focus", () => host.setBusy?.(true));
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          send();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
        ev.stopPropagation();
      });
      ta.focus();
    };
    if (opts.openReply) openReply();
  } else if (item.kind === "mark") {
    button(foot, "Comment", { icon: "message-square-plus", onClick: () => openNewThread() });
    const box = card.createDiv({ cls: "cq-reply-box is-hidden" });
    const openNewThread = () => {
      box.removeClass("is-hidden");
      box.empty();
      const ta = box.createEl("textarea", { cls: "cq-reply-input", attr: { placeholder: "Comment on this change…", rows: "2" } });
      const row = box.createDiv({ cls: "cq-popover-actions" });
      row.createSpan({ cls: "cq-hint", text: "⌘↩" });
      const cancel = () => {
        box.addClass("is-hidden");
        host.setBusy?.(false);
      };
      const send = () => {
        const text = ta.value.trim();
        if (!text) return;
        host.setBusy?.(false);
        void host.actions.insert(t, host.parsed, item.mark.from, item.mark.to, "comment", { comment: text }, false).then(after);
      };
      button(row, "Cancel", { onClick: cancel });
      button(row, "Add", { cls: "mod-cta", onClick: send });
      ta.addEventListener("focus", () => host.setBusy?.(true));
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          send();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
        ev.stopPropagation();
      });
      ta.focus();
    };
    if (opts.openReply) openNewThread();
  }
  return card;
}

function renderMessage(list: HTMLElement, m: Mark, host: CardHost, card: HTMLElement): void {
  const msg = list.createDiv({ cls: "cq-msg" });
  const head = byline(msg, m, fallbackAuthor(host), host.settings);
  const tools = head.createSpan({ cls: "cq-msg-tools" });
  const textEl = msg.createDiv({ cls: "cq-msg-text" });
  const text = commentText(m);
  void MarkdownRenderer.render(host.app, text || "*(empty)*", textEl, host.sourcePath, host.component);

  const startEdit = () => {
    if (msg.hasClass("is-editing")) return;
    msg.addClass("is-editing");
    host.setBusy?.(true);
    textEl.addClass("is-hidden");
    const editor = msg.createDiv({ cls: "cq-msg-editor" });
    const ta = editor.createEl("textarea", { cls: "cq-reply-input", attr: { rows: "3" } });
    ta.value = text;
    const row = editor.createDiv({ cls: "cq-popover-actions" });
    row.createSpan({ cls: "cq-hint", text: "⌘↩ to save · Esc to cancel" });
    const cancel = () => {
      editor.remove();
      textEl.removeClass("is-hidden");
      msg.removeClass("is-editing");
      host.setBusy?.(false);
    };
    const save = () => {
      const v = ta.value.trim();
      if (!v || v === text) {
        cancel();
        return;
      }
      host.setBusy?.(false);
      void host.actions.editComment(host.target, host.parsed, m, v).then(() => host.afterChange());
    };
    button(row, "Cancel", { onClick: cancel });
    button(row, "Save", { cls: "mod-cta", onClick: save });
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        save();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
      ev.stopPropagation();
    });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };
  iconButton(tools, "pencil", "Edit comment", startEdit);
  iconButton(tools, "trash-2", "Delete comment", () => void host.actions.deleteComment(host.target, host.parsed, m).then(() => host.afterChange()), "cq-danger");
  textEl.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    startEdit();
  });
  card.addClass("cq-has-msgs");
}
