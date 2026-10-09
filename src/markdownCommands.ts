// Editing commands behind the formatting toolbar: headings, bold, italic,
// strikethrough, highlight and lists. They edit the Markdown directly, so
// the file stays plain Markdown (highlight is Obsidian's ==text== syntax).
import { EditorSelection, type EditorState, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export type InlineMark = 'bold' | 'italic' | 'strike' | 'highlight';
export type ListKind = 'bullet' | 'numbered' | 'checklist';

const MARKS: Record<InlineMark, string> = { bold: '**', italic: '*', strike: '~~', highlight: '==' };
const NODES: Partial<Record<InlineMark, { node: string; mark: string }>> = {
  bold: { node: 'StrongEmphasis', mark: 'EmphasisMark' },
  italic: { node: 'Emphasis', mark: 'EmphasisMark' },
  strike: { node: 'Strikethrough', mark: 'StrikethroughMark' },
};

const HEADING_RE = /^(#{1,6})[ \t]+/;
const LIST_RE = /^([ \t]*)(?:([-*+])[ \t]+\[[ xX]\][ \t]+|([-*+])[ \t]+|(\d+)[.)][ \t]+)/;
const HIGHLIGHT_RE = /==(?=\S)(.*?\S)==/g;

// The marker ranges of the formatting node of this kind around [from, to].
function enclosing(state: EditorState, kind: InlineMark, from: number, to: number): { open: [number, number]; close: [number, number] } | null {
  const spec = NODES[kind];
  if (!spec) {
    const line = state.doc.lineAt(from);
    if (state.doc.lineAt(to).number !== line.number) return null;
    for (const m of line.text.matchAll(HIGHLIGHT_RE)) {
      const start = line.from + m.index!;
      const end = start + m[0].length;
      if (start <= from && to <= end) return { open: [start, start + 2], close: [end - 2, end] };
    }
    return null;
  }
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, side); node; node = node.parent) {
      if (node.name !== spec.node || node.from > from || node.to < to) continue;
      const first = node.firstChild;
      const last = node.lastChild;
      if (first?.name === spec.mark && last?.name === spec.mark && first !== last) {
        return { open: [first.from, first.to], close: [last.from, last.to] };
      }
    }
  }
  return null;
}

export function toggleInline(view: EditorView, kind: InlineMark): boolean {
  const { state } = view;
  const mark = MARKS[kind];
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    if (range.empty) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const found = enclosing(state, kind, from, to);
    if (found) {
      const changes = state.changes([
        { from: found.open[0], to: found.open[1] },
        { from: found.close[0], to: found.close[1] },
      ]);
      return { changes, range: range.map(changes) };
    }
    if (from === to) {
      return { changes: { from, insert: mark + mark }, range: EditorSelection.cursor(from + mark.length) };
    }
    // Emphasis can't start or end with a space, so leave edge spaces outside.
    const text = state.sliceDoc(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    if (from >= to) return { range };
    const changes = [
      { from, insert: mark },
      { from: to, insert: mark },
    ];
    // A cursor stays where it was in the word; a selection keeps covering the text.
    return {
      changes,
      range: range.empty ? EditorSelection.cursor(range.head + mark.length) : EditorSelection.range(from + mark.length, to + mark.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
}

// Each selected line once, skipping blank lines unless that's all there is.
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  const filled = lines.filter((l) => l.text.trim());
  return filled.length ? filled : lines;
}

function applyLineChanges(view: EditorView, changes: ChangeSpec[]) {
  const set = view.state.changes(changes);
  view.dispatch({
    changes: set,
    selection: view.state.selection.map(set, 1),
    scrollIntoView: true,
    userEvent: 'input.format',
  });
}

export function headingLevel(text: string): number {
  return text.match(HEADING_RE)?.[1].length ?? 0;
}

export function setHeading(view: EditorView, level: number): boolean {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(view.state)) {
    const heading = line.text.match(HEADING_RE)?.[0] ?? '';
    const list = heading ? '' : (line.text.match(LIST_RE)?.[0] ?? '');
    const indent = list.match(/^[ \t]*/)![0];
    changes.push({ from: line.from, to: line.from + (heading || list).length, insert: (level ? `${indent}${'#'.repeat(level)} ` : indent) });
  }
  applyLineChanges(view, changes);
  return true;
}

export function listKind(text: string): ListKind | null {
  const m = text.match(LIST_RE);
  if (!m) return null;
  return m[2] ? 'checklist' : m[3] ? 'bullet' : 'numbered';
}

export function toggleList(view: EditorView, kind: ListKind): boolean {
  const lines = selectedLines(view.state);
  const off = lines.every((l) => listKind(l.text) === kind);
  const changes: ChangeSpec[] = [];
  lines.forEach((line, i) => {
    const m = line.text.match(LIST_RE);
    const heading = m ? '' : (line.text.match(HEADING_RE)?.[0] ?? '');
    const indent = m?.[1] ?? '';
    const marker = off ? '' : kind === 'bullet' ? '- ' : kind === 'checklist' ? '- [ ] ' : `${i + 1}. `;
    changes.push({ from: line.from, to: line.from + (m?.[0].length ?? heading.length), insert: indent + marker });
  });
  applyLineChanges(view, changes);
  return true;
}

export interface MarkdownState {
  heading: number;
  list: ListKind | null;
  marks: Record<InlineMark, boolean>;
}

export function markdownState(state: EditorState): MarkdownState {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from).text;
  const marks = {} as Record<InlineMark, boolean>;
  for (const kind of Object.keys(MARKS) as InlineMark[]) marks[kind] = enclosing(state, kind, from, to) !== null;
  return { heading: headingLevel(line), list: listKind(line), marks };
}
