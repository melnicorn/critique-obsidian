// Editor state: the parse of the document and a settings facet, shared by every editor extension.
import { Facet, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { parse, type ParseResult } from "../parser";
import type { CritiqueSettings } from "../settings";

export const settingsFacet = Facet.define<CritiqueSettings, CritiqueSettings>({
  combine: (values) => values[0],
});

/** Dispatched to every editor when settings change, so decorations rebuild. */
export const settingsChanged = StateEffect.define<number>();

export const parseField = StateField.define<ParseResult>({
  create: (state) => parse(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? parse(tr.newDoc.toString()) : value),
});

export function parsedOf(state: EditorState): ParseResult {
  return state.field(parseField);
}
