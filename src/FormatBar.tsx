import { useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { markdownState, setHeading, toggleInline, toggleList, type InlineMark, type ListKind } from './markdownCommands';
import {
  IconBold,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconHighlight,
  IconItalic,
  IconListBullet,
  IconListNumbered,
  IconRedo,
  IconStrike,
  IconTextColor,
  IconUndo,
} from './Icons';

interface FormatBarProps {
  editor: EditorView | null;
  // Bumped whenever the editor's text or selection changes, to redraw.
  tick: number;
  // In preview the text can't be edited, so only the color button works.
  readOnly: boolean;
  colorOpen: boolean;
  onToggleColor: () => void;
}

const HEADINGS = [
  { level: 0, label: 'Text', short: 'Text' },
  { level: 1, label: 'Heading 1', short: 'H1' },
  { level: 2, label: 'Heading 2', short: 'H2' },
  { level: 3, label: 'Heading 3', short: 'H3' },
];

const INLINE: { kind: InlineMark; label: string; keys: string; icon: React.ReactNode }[] = [
  { kind: 'bold', label: 'Bold', keys: '⌘B', icon: <IconBold /> },
  { kind: 'italic', label: 'Italic', keys: '⌘I', icon: <IconItalic /> },
  { kind: 'strike', label: 'Strikethrough', keys: '⇧⌘X', icon: <IconStrike /> },
  { kind: 'highlight', label: 'Highlight', keys: '⇧⌘H', icon: <IconHighlight /> },
];

const LISTS: { kind: ListKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'bullet', label: 'Bulleted list', icon: <IconListBullet /> },
  { kind: 'numbered', label: 'Numbered list', icon: <IconListNumbered /> },
  { kind: 'checklist', label: 'Checklist', icon: <IconChecklist /> },
];

// The row of formatting buttons above a note, like Craft or Bear.
export function FormatBar({ editor, tick, readOnly, colorOpen, onToggleColor }: FormatBarProps) {
  const [menu, setMenu] = useState<'heading' | 'list' | null>(null);
  void tick;
  const state = editor ? markdownState(editor.state) : null;
  const disabled = readOnly || !editor;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // Runs a command on the editor and keeps the cursor in the text.
  const run = (command: (view: EditorView) => unknown) => {
    if (!editor) return;
    command(editor);
    editor.focus();
    setMenu(null);
  };
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const heading = HEADINGS.find((h) => h.level === state?.heading) ?? { short: `H${state?.heading}` };
  const list = LISTS.find((l) => l.kind === state?.list) ?? LISTS[0];

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting" onMouseDown={keepFocus}>
      <div className="menu-anchor">
        <button
          className="format-button wide"
          disabled={disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setMenu(menu === 'heading' ? null : 'heading')}
          title="Text style"
          aria-label="Text style"
          aria-haspopup="menu"
        >
          <span className="format-heading-label">{readOnly ? 'Text' : heading.short}</span>
          <IconChevronDown size={12} />
        </button>
        {menu === 'heading' && (
          <div className="format-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
            {HEADINGS.map((h) => (
              <button key={h.level} className={`context-item format-menu-item h${h.level}`} role="menuitem" onMouseDown={keepFocus} onClick={() => run((v) => setHeading(v, h.level))}>
                <span>{h.label}</span>
                {state?.heading === h.level && <IconCheck size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="format-sep" />
      {INLINE.map((b) => (
        <button
          key={b.kind}
          className={`format-button${!readOnly && state?.marks[b.kind] ? ' on' : ''}`}
          disabled={disabled}
          onClick={() => run((v) => toggleInline(v, b.kind))}
          title={`${b.label} (${b.keys})`}
          aria-label={b.label}
          aria-pressed={!readOnly && Boolean(state?.marks[b.kind])}
        >
          {b.icon}
        </button>
      ))}
      <span className="format-sep" />
      <div className="menu-anchor">
        <button
          className={`format-button wide${!readOnly && state?.list ? ' on' : ''}`}
          disabled={disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setMenu(menu === 'list' ? null : 'list')}
          title="Lists"
          aria-label="Lists"
          aria-haspopup="menu"
        >
          {list.icon}
          <IconChevronDown size={12} />
        </button>
        {menu === 'list' && (
          <div className="format-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
            {LISTS.map((l) => (
              <button key={l.kind} className="context-item format-menu-item" role="menuitem" onMouseDown={keepFocus} onClick={() => run((v) => toggleList(v, l.kind))}>
                {l.icon}
                <span>{l.label}</span>
                {state?.list === l.kind && <IconCheck size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="format-sep" />
      <button className="format-button" disabled={!editor || readOnly || !undoDepth(editor.state)} onClick={() => run(undo)} title="Undo (⌘Z)" aria-label="Undo">
        <IconUndo />
      </button>
      <button className="format-button" disabled={!editor || readOnly || !redoDepth(editor.state)} onClick={() => run(redo)} title="Redo (⇧⌘Z)" aria-label="Redo">
        <IconRedo />
      </button>
      <span className="format-spacer" />
      <button
        className={`format-button${colorOpen ? ' on' : ''}`}
        onClick={onToggleColor}
        title={colorOpen ? 'Hide text color panel (⇧⌘C)' : 'Text color and bold (⇧⌘C)'}
        aria-label="Text formatting"
        aria-pressed={colorOpen}
      >
        <IconTextColor />
      </button>
    </div>
  );
}
