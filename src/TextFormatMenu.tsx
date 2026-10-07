import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { TEXT_COLORS } from './richtext';
import { formatState, setTextColor, toggleHeadingBold, type FormatState } from './richtextEditor';

interface TextFormatMenuProps {
  view: EditorView;
  onClose: () => void;
}

// Popover for coloring text and un-bolding headings. Buttons keep the editor
// focused so the selection stays put while you pick.
export function TextFormatMenu({ view, onClose }: TextFormatMenuProps) {
  const [state, setState] = useState<FormatState>(() => formatState(view.state));
  const ref = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const refresh = () => setState(formatState(view.state));
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-format-toggle]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        view.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, view]);

  // The native color picker fires "change" once when a color is chosen
  // (React's onChange would fire on every drag step).
  useEffect(() => {
    const input = customRef.current;
    if (!input) return;
    const onChange = () => {
      setTextColor(view, input.value);
      refresh();
      view.focus();
    };
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const pick = (color: string | null) => {
    setTextColor(view, color);
    refresh();
    view.focus();
  };

  const custom = state.color && !TEXT_COLORS.some((c) => c.hex === state.color) ? state.color : null;
  const range = view.state.selection.main.empty ? 'the whole line' : 'the selected text';

  return (
    <div className="format-menu" ref={ref} role="dialog" aria-label="Text formatting">
      <div className="format-section-title">Text color</div>
      <div className="format-hint">Applies to {range}.</div>
      <div className="format-swatches">
        <button className={`format-swatch default${state.color === null ? ' selected' : ''}`} onMouseDown={keepFocus} onClick={() => pick(null)} title="Default" aria-label="Default color">
          <span>A</span>
        </button>
        {TEXT_COLORS.map((c) => (
          <button
            key={c.name}
            className={`format-swatch tag-${c.name}${state.color === c.hex ? ' selected' : ''}`}
            onMouseDown={keepFocus}
            onClick={() => pick(c.hex)}
            title={c.label}
            aria-label={c.label}
          >
            <span>A</span>
          </button>
        ))}
        <label
          className={`format-swatch custom${custom ? ' selected' : ''}`}
          title="Custom color…"
          aria-label="Custom color"
          style={custom ? ({ '--custom-color': custom } as React.CSSProperties) : undefined}
        >
          <span>{custom ? 'A' : '+'}</span>
          <input ref={customRef} type="color" defaultValue={custom ?? '#6a5cff'} />
        </label>
      </div>

      <div className="context-sep" />
      <div className="format-section-title">Heading</div>
      {state.heading ? (
        <button
          className="format-toggle"
          role="switch"
          aria-checked={state.headingBold}
          onMouseDown={keepFocus}
          onClick={() => {
            toggleHeadingBold(view);
            refresh();
          }}
        >
          <span className={`switch${state.headingBold ? ' on' : ''}`} />
          Bold
        </button>
      ) : (
        <div className="format-hint">Put the cursor on a heading to turn its bold on or off.</div>
      )}
    </div>
  );
}
