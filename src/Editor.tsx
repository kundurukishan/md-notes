import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { skipFormatting, textFormatting } from './richtextEditor';

// Styles the Markdown source so it reads almost like rendered text: headings
// are larger, emphasis is applied, and the syntax marks fade into the background.
const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '650', lineHeight: '1.35' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-muted)', textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: 'var(--mono-font)', fontSize: '0.9em', color: 'var(--code-fg)' },
  { tag: t.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  { tag: t.list, color: 'var(--text-muted)' },
]);

interface EditorProps {
  docKey: string;
  value: string;
  onChange: (value: string) => void;
  editorRef?: React.MutableRefObject<EditorView | null>;
  // Called when the selection, text or focus changes.
  onActivity?: (view: EditorView) => void;
}

export function Editor({ docKey, value, onChange, editorRef, onActivity }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownStyle),
        placeholder('Start writing…'),
        textFormatting(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet || update.focusChanged) onActivityRef.current?.(update.view);
        }),
      ],
    });

  useEffect(() => {
    view.current = new EditorView({ state: makeState(value), parent: host.current! });
    if (editorRef) editorRef.current = view.current;
    return () => {
      view.current?.destroy();
      view.current = null;
      if (editorRef) editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different note gets a fresh editor state (and its own undo history).
  useEffect(() => {
    view.current?.setState(makeState(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Pick up changes made outside the editor, e.g. ticking a checkbox in preview.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: skipFormatting.of(true) });
    }
  }, [value]);

  return <div className="editor" ref={host} />;
}
