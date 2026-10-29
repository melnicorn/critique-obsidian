// Live Preview edits a table cell in a nested EditorView whose document is just that cell's text,
// while the note's editor is the one that gets written to. Map the cell editor back to the note.
import { EditorView } from "@codemirror/view";

export interface Hosted {
  /** The note's editor. */
  view: EditorView;
  /** Offset of the cell editor's position 0 in the note. */
  offset: number;
}

/** The note editor that hosts `view` and the cell's offset in it, or null when `view` is not a table cell editor. */
export function cellHost(view: EditorView): Hosted | null {
  const widget = view.dom.closest<HTMLElement>(".cm-table-widget");
  const outerDom = widget?.parentElement?.closest<HTMLElement>(".cm-editor");
  const host = outerDom ? EditorView.findFromDOM(outerDom) : null;
  if (!widget || !host || host === view) return null;
  const td = view.dom.closest("td, th");
  const tr = td?.parentElement;
  const table = tr?.closest("table");
  if (!td || !tr || !table) return null;
  const rowIdx = Array.from(table.querySelectorAll("tr")).indexOf(tr as HTMLTableRowElement);
  const colIdx = Array.from(tr.children).indexOf(td);
  const doc = host.state.doc;
  const firstLine = doc.lineAt(host.posAtDOM(widget)).number;
  // Source rows: header, delimiter, then body rows.
  const lineNo = firstLine + (rowIdx === 0 ? 0 : rowIdx + 1);
  if (rowIdx < 0 || colIdx < 0 || lineNo > doc.lines) return null;
  const line = doc.line(lineNo);
  const cellText = view.state.doc.toString();
  const start = cellStart(line.text, colIdx, cellText);
  return start === null ? null : { view: host, offset: line.from + start };
}

/** Offset within a table row of column `col`'s content, checked against the cell editor's text. */
export function cellStart(row: string, col: number, cellText: string): number | null {
  const bounds: number[] = [];
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\") i++;
    else if (row[i] === "|") bounds.push(i);
  }
  // A row may omit its leading pipe.
  if (!row.trimStart().startsWith("|")) bounds.unshift(-1);
  if (col >= bounds.length) return null;
  const from = bounds[col] + 1;
  const to = col + 1 < bounds.length ? bounds[col + 1] : row.length;
  const segment = row.slice(from, to);
  if (cellText === "") return from + segment.length - segment.trimStart().length;
  const at = segment.indexOf(cellText);
  return at === -1 ? null : from + at;
}

/**
 * The editor to read and write for `view` and its main selection in that editor's coordinates.
 * Null for a table cell editor that cannot be placed in the note, so callers write nothing.
 */
export function hostSelection(view: EditorView): { view: EditorView; from: number; to: number } | null {
  const sel = view.state.selection.main;
  if (!view.dom.parentElement?.closest(".cm-table-widget")) return { view, from: sel.from, to: sel.to };
  const hosted = cellHost(view);
  return hosted ? { view: hosted.view, from: sel.from + hosted.offset, to: sel.to + hosted.offset } : null;
}

/** The table cell editor currently open inside `host`, with its offset in the note. */
export function openCell(host: EditorView): { view: EditorView; offset: number } | null {
  for (const dom of Array.from(host.contentDOM.querySelectorAll<HTMLElement>(".cm-table-widget .cm-editor"))) {
    const view = EditorView.findFromDOM(dom);
    const hosted = view ? cellHost(view) : null;
    if (view && hosted?.view === host) return { view, offset: hosted.offset };
  }
  return null;
}
