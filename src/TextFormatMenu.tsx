import { useEffect, useRef } from 'react';
import { TEXT_COLORS } from './richtext';

interface TextFormatMenuProps {
  // What the menu applies to, e.g. "the whole line" or "the note title".
  target: string;
  color: string | null;
  onColor: (color: string | null) => void;
  // Section label for the bold switch ("Heading" or "Title").
  boldLabel: string;
  // The bold switch, or null when it doesn't apply (with a hint shown instead).
  bold: { on: boolean; onToggle: () => void } | null;
  boldHint: string;
  onClose: (refocus: boolean) => void;
}

// Popover for text color and bold. Buttons keep the current focus (editor or
// title) so the selection stays put while you pick.
export function TextFormatMenu({ target, color, onColor, boldLabel, bold, boldHint, onClose }: TextFormatMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const onColorRef = useRef(onColor);
  onColorRef.current = onColor;
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-format-toggle]')) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(true);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // The native color picker fires "change" once when a color is chosen
  // (React's onChange would fire on every drag step).
  useEffect(() => {
    const input = customRef.current;
    if (!input) return;
    const onChange = () => onColorRef.current(input.value);
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, []);

  const custom = color && !TEXT_COLORS.some((c) => c.hex === color) ? color : null;

  return (
    <div className="format-menu" ref={ref} role="dialog" aria-label="Text formatting">
      <div className="format-section-title">Text color</div>
      <div className="format-hint">Applies to {target}.</div>
      <div className="format-swatches">
        <button className={`format-swatch default${color === null ? ' selected' : ''}`} onMouseDown={keepFocus} onClick={() => onColor(null)} title="Default" aria-label="Default color">
          <span>A</span>
        </button>
        {TEXT_COLORS.map((c) => (
          <button
            key={c.name}
            className={`format-swatch tag-${c.name}${color === c.hex ? ' selected' : ''}`}
            onMouseDown={keepFocus}
            onClick={() => onColor(c.hex)}
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
      <div className="format-section-title">{boldLabel}</div>
      {bold ? (
        <button className="format-toggle" role="switch" aria-checked={bold.on} onMouseDown={keepFocus} onClick={bold.onToggle}>
          <span className={`switch${bold.on ? ' on' : ''}`} />
          Bold
        </button>
      ) : (
        <div className="format-hint">{boldHint}</div>
      )}
    </div>
  );
}
