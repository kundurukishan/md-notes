// CodeMirror support for text color and "not bold" formatting (see
// richtext.ts). The formatting tags are hidden and the text is drawn in its
// color, so notes read cleanly while the file stays plain Markdown.
import { Annotation, ChangeSet, EditorSelection, EditorState, Prec, RangeSetBuilder, Transaction, type ChangeSpec, type Line, type Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import {
  applyStyle,
  displayColor,
  isHeading,
  normalizeLine,
  parseLine,
  rawOffset,
  styleAt,
  visibleLength,
  visibleOffset,
  type RunStyle,
  type StylePatch,
} from './richtext';

// Transactions carrying this annotation (e.g. loading a note) are left as-is.
export const skipFormatting = Annotation.define<boolean>();

const isStyled = (s: RunStyle) => Boolean(s.color || s.normalWeight);
const hiddenTag = Decoration.replace({});

function inCodeBlock(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
}

// Whether line `n` (1-based) is inside a fenced code block, by scanning for
// fences. Used where no up-to-date syntax tree is available.
function lineInFence(doc: Text, n: number): boolean {
  let fence: string | null = null;
  for (let i = 1; i <= n; i++) {
    const m = doc.line(i).text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      if (fence === null) {
        if (i === n) return false;
        fence = m[1];
      } else if (m[1][0] === fence[0] && m[1].length >= fence.length) {
        if (i === n) return true;
        fence = null;
      }
    }
  }
  return fence !== null;
}

// ---- Drawing --------------------------------------------------------------

class FormattingView {
  decorations: DecorationSet = Decoration.none;
  hidden: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.build(view);
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.build(u.view);
  }

  build(view: EditorView) {
    const deco = new RangeSetBuilder<Decoration>();
    const hidden = new RangeSetBuilder<Decoration>();
    const { doc } = view.state;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        if (line.text.includes('<span') && !inCodeBlock(view.state, line.from)) {
          for (const r of parseLine(line.text).runs) {
            if (!isStyled(r.style)) continue;
            const classes = ['cm-format', r.style.color ? 'cm-format-color' : '', r.style.normalWeight ? 'cm-format-normal' : ''].filter(Boolean).join(' ');
            const attrs: Record<string, string> = { class: classes };
            if (r.style.color) attrs.style = `--format-color: ${displayColor(r.style.color)}`;
            deco.add(line.from + r.tagStart, line.from + r.innerStart, hiddenTag);
            deco.add(line.from + r.innerStart, line.from + r.innerEnd, Decoration.mark({ attributes: attrs }));
            deco.add(line.from + r.innerEnd, line.from + r.tagEnd, hiddenTag);
            hidden.add(line.from + r.tagStart, line.from + r.innerStart, hiddenTag);
            hidden.add(line.from + r.innerEnd, line.from + r.tagEnd, hiddenTag);
          }
        }
        pos = line.to + 1;
      }
    }
    this.decorations = deco.finish();
    this.hidden = hidden.finish();
  }
}

const formattingView = ViewPlugin.fromClass(FormattingView, {
  decorations: (v) => v.decorations,
  provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none),
});

// ---- Keeping spans intact while editing -------------------------------------

// Enter inside colored text closes the span before the line break and reopens
// it after, so both halves keep their formatting. After deletions, any span
// left half-deleted (or empty) is removed so no stray tags show up.
const keepSpansIntact = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(skipFormatting)) return tr;
  let deletes = false;
  let newlines = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (toA > fromA) deletes = true;
    if (inserted.toString().includes('\n')) newlines = true;
  });
  if (!deletes && !newlines) return tr;

  const startDoc = tr.startState.doc;
  const specs: ChangeSpec[] = [];
  let split = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    let text = inserted.toString();
    // A line break typed inside colored text (Enter may also remove spaces
    // next to the cursor, so the replaced range can be non-empty).
    if (text.includes('\n') && startDoc.lineAt(fromA).number === startDoc.lineAt(toA).number) {
      const line = startDoc.lineAt(fromA);
      const start = fromA - line.from;
      const end = toA - line.from;
      const run = parseLine(line.text).runs.find((r) => isStyled(r.style) && start >= r.innerStart && end <= r.innerEnd);
      if (run && !lineInFence(startDoc, line.number)) {
        text = `</span>${text}${line.text.slice(run.tagStart, run.innerStart)}`;
        split = true;
      }
    }
    specs.push({ from: fromA, to: toA, insert: text });
  });

  const changes = split ? ChangeSet.of(specs, startDoc.length) : tr.changes;
  const newDoc = changes.apply(startDoc);
  const fixes: ChangeSpec[] = [];
  const seen = new Set<number>();
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let n = newDoc.lineAt(fromB).number; n <= newDoc.lineAt(toB).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = newDoc.line(n);
      if (!line.text.includes('span')) continue;
      const fixed = normalizeLine(line.text);
      if (fixed !== line.text && !lineInFence(newDoc, n)) fixes.push({ from: line.from, to: line.to, insert: fixed });
    }
  });
  if (!split && !fixes.length) return tr;

  const fixSet = ChangeSet.of(fixes, newDoc.length);
  const all = changes.compose(fixSet);
  return {
    changes: all,
    selection: split ? tr.startState.selection.map(all, 1) : tr.newSelection.map(fixSet),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
  };
});

// Backspace/Delete next to a hidden tag remove the neighbouring character
// instead of the tag.
function skipTags(view: EditorView, forward: boolean): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (!line.text.includes('<span')) return false;
  const runs = parseLine(line.text).runs.filter((r) => isStyled(r.style));
  // Step over every hidden tag directly before (or after) the cursor.
  let pos = sel.head - line.from;
  for (let moved = true; moved; ) {
    moved = false;
    for (const r of runs) {
      const next = forward
        ? pos === r.tagStart ? r.innerStart : pos === r.innerEnd ? r.tagEnd : null
        : pos === r.tagEnd ? r.innerEnd : pos === r.innerStart ? r.tagStart : null;
      if (next !== null) {
        pos = next;
        moved = true;
      }
    }
  }
  if (pos === sel.head - line.from) return false;
  view.dispatch({ selection: { anchor: line.from + pos } });
  return forward ? deleteCharForward(view) : deleteCharBackward(view);
}

const tagAwareKeys = Prec.high(
  keymap.of([
    { key: 'Backspace', run: (view) => skipTags(view, false) },
    { key: 'Delete', run: (view) => skipTags(view, true) },
  ]),
);

// Typing right after colored text continues it, like in a word processor.
// At the very start of a line's text, typing joins the span that follows.
const continueFormatting = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || text.includes('\n')) return false;
  const line = view.state.doc.lineAt(from);
  if (!line.text.includes('<span') || inCodeBlock(view.state, line.from)) return false;
  const parsed = parseLine(line.text);
  const offset = from - line.from;
  let target: number | null = null;
  for (const r of parsed.runs) {
    if (!isStyled(r.style)) continue;
    if (offset === r.tagEnd) target = r.innerEnd;
    else if (offset === r.tagStart && r.tagStart === parsed.prefix.length && target === null) target = r.innerStart;
  }
  if (target === null) return false;
  const at = line.from + target;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type', scrollIntoView: true });
  return true;
});

export function textFormatting() {
  return [formattingView, keepSpansIntact, tagAwareKeys, continueFormatting];
}

// ---- Commands -----------------------------------------------------------------

export interface FormatState {
  color: string | null; // shared color of the selection (or line), null if none or mixed
  heading: boolean; // the cursor is on a heading line
  headingBold: boolean;
}

// The lines a format command applies to, with the visible range on each line:
// the selected part, or the whole line text when nothing is selected.
function targets(state: EditorState) {
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  const out: { line: Line; from: number; to: number }[] = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    const parsed = parseLine(line.text);
    const len = visibleLength(parsed);
    let from = 0;
    let to = len;
    if (!sel.empty) {
      if (n === first.number) from = visibleOffset(parsed, sel.from - line.from);
      if (n === last.number) to = visibleOffset(parsed, sel.to - line.from);
    }
    if (to > from) out.push({ line, from, to });
  }
  return out;
}

export function formatState(state: EditorState): FormatState {
  const line = state.doc.lineAt(state.selection.main.head);
  const heading = isHeading(line.text);
  const ranges = targets(state);
  let color: string | null = null;
  if (ranges.length) {
    const colors = ranges.map((r) => styleAt(r.line.text, r.from, r.to).color ?? null);
    color = colors.every((c) => c === colors[0]) ? colors[0] : null;
  }
  const len = visibleLength(parseLine(line.text));
  const headingBold = heading && !(len > 0 && styleAt(line.text, 0, len).normalWeight);
  return { color, heading, headingBold };
}

function applyToLines(view: EditorView, ranges: ReturnType<typeof targets>, patch: StylePatch): boolean {
  if (!ranges.length) return false;
  const { state } = view;
  const sel = state.selection.main;
  const changes: ChangeSpec[] = [];
  let delta = 0;
  let anchor: number | null = null;
  let head: number | null = null;
  const firstLine = state.doc.lineAt(sel.from).number;
  const lastLine = state.doc.lineAt(sel.to).number;
  for (const { line, from, to } of ranges) {
    const next = applyStyle(line.text, from, to, patch);
    const newFrom = line.from + delta;
    const parsed = parseLine(next);
    if (sel.empty) {
      const vis = visibleOffset(parseLine(line.text), sel.head - line.from);
      anchor = head = newFrom + rawOffset(parsed, vis, -1);
    } else {
      if (line.number === firstLine) anchor = newFrom + rawOffset(parsed, from, 1);
      if (line.number === lastLine) head = newFrom + rawOffset(parsed, to, -1);
    }
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    delta += next.length - line.text.length;
  }
  if (!changes.length) return true;
  const newSel =
    anchor !== null && head !== null
      ? EditorSelection.single(sel.anchor <= sel.head ? anchor : head, sel.anchor <= sel.head ? head : anchor)
      : undefined;
  view.dispatch({ changes, selection: newSel, userEvent: 'format', scrollIntoView: true });
  return true;
}

// Sets (or with null, removes) the text color of the selection, or of the
// whole line when nothing is selected.
export function setTextColor(view: EditorView, color: string | null): boolean {
  return applyToLines(view, targets(view.state), { color });
}

// Turns bold on or off for the heading the cursor is on.
export function toggleHeadingBold(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (!isHeading(line.text)) return false;
  const len = visibleLength(parseLine(line.text));
  if (!len) return false;
  const bold = formatState(view.state).headingBold;
  return applyToLines(view, [{ line, from: 0, to: len }], { normalWeight: bold ? true : null });
}
