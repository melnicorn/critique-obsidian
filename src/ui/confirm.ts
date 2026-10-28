import { Modal, type App } from "obsidian";

export class ConfirmModal extends Modal {
  private resolved = false;
  constructor(
    app: App,
    private title: string,
    private body: string,
    private confirmLabel: string,
    private resolve: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    const ok = row.createEl("button", { cls: "mod-warning", text: this.confirmLabel });
    ok.addEventListener("click", () => this.done(true));
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.done(false));
    ok.focus();
  }

  private done(ok: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(ok);
    this.close();
  }

  onClose(): void {
    this.done(false);
  }
}

export function confirm(app: App, title: string, body: string, confirmLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, title, body, confirmLabel, resolve).open());
}
