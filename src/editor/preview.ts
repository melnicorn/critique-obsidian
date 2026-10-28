// Per-editor preview mode: show the note as it would read with every change accepted or rejected.
// Display only; the document is untouched.
import { StateEffect, StateField } from "@codemirror/state";

export type PreviewMode = "markup" | "accepted" | "original";

export const PREVIEW_MODES: PreviewMode[] = ["markup", "accepted", "original"];

export const PREVIEW_LABEL: Record<PreviewMode, string> = {
  markup: "Markup",
  accepted: "Accepted preview",
  original: "Original preview",
};

export const PREVIEW_ICON: Record<PreviewMode, string> = {
  markup: "file-diff",
  accepted: "file-check",
  original: "file-x",
};

export const setPreviewMode = StateEffect.define<PreviewMode>();

export const previewModeField = StateField.define<PreviewMode>({
  create: () => "markup",
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setPreviewMode)) return e.value;
    return value;
  },
});
