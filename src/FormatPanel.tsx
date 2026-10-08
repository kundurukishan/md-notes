import { useEffect, useRef } from 'react';
import { TEXT_COLORS } from './richtext';
import { IconX } from './Icons';

interface FormatPanelProps {
  // What the panel applies to, e.g. "the whole line" or "the note title".
  target: string;
  color: string | null;
  onColor: (color: string | null) => void;
  // Section label for the bold switch ("Heading" or "Title").
  boldLabel: string;
  // The bold switch, or null when it doesn't apply (with a hint shown instead).
  bold: { on: boolean; onToggle: () => void } | null;
  boldHint: string;
  onClose: () => void;
}

// Formatting panel docked at the right edge of the note (like Craft's style
// panel). Its buttons keep the current focus (editor or title), so the
// selection stays put while you pick.
export function FormatPanel({ target, color, onColor, boldLabel, bold, boldHint, onClose }: FormatPanelProps) {
  const customRef = useRef<HTMLInputElement>(null);
  const onColorRef = useRef(onColor);
  onColorRef.current = onColor;
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

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
    <aside className="format-panel" aria-label="Format" onMouseDown={keepFocus}>
      <div className="format-panel-header">
        <span>Format</span>
        <button className="icon-button" onClick={onClose} title="Hide format panel (⇧⌘C)" aria-label="Hide format panel">
          <IconX size={14} />
        </button>
      </div>

      <section className="format-section">
        <div className="format-section-title">Text color</div>
        <div className="format-hint">Applies to {target}.</div>
        <div className="format-swatches">
          <button className={`format-swatch default${color === null ? ' selected' : ''}`} onClick={() => onColor(null)} title="Default" aria-label="Default color">
            <span>A</span>
          </button>
          {TEXT_COLORS.map((c) => (
            <button key={c.name} className={`format-swatch tag-${c.name}${color === c.hex ? ' selected' : ''}`} onClick={() => onColor(c.hex)} title={c.label} aria-label={c.label}>
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
      </section>

      <section className="format-section">
        <div className="format-section-title">{boldLabel}</div>
        {bold ? (
          <button className="format-toggle" role="switch" aria-checked={bold.on} onClick={bold.onToggle}>
            <span className={`switch${bold.on ? ' on' : ''}`} />
            Bold
          </button>
        ) : (
          <div className="format-hint">{boldHint}</div>
        )}
      </section>
    </aside>
  );
}
