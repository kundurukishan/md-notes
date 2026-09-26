import { useEffect } from 'react';
import type { Settings, Theme } from './api';
import { FONTS } from './theme';
import { IconFolder, IconX } from './Icons';

interface SettingsDialogProps {
  settings: Settings;
  isDesktop: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onChooseFolder: () => void;
  onRevealFolder: () => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const WIDTHS = [
  { value: 620, label: 'Narrow' },
  { value: 720, label: 'Medium' },
  { value: 880, label: 'Wide' },
  { value: 10000, label: 'Full' },
];

export function SettingsDialog({ settings, isDesktop, onChange, onChooseFolder, onRevealFolder, onClose }: SettingsDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <IconX />
          </button>
        </div>

        <section className="settings-section">
          <h3>Note font</h3>
          <div className="font-grid">
            {FONTS.map((font) => (
              <button
                key={font.name}
                className={`font-card${settings.font === font.name ? ' selected' : ''}`}
                onClick={() => onChange({ font: font.name })}
              >
                <span className="font-sample" style={{ fontFamily: font.stack }}>
                  Aa
                </span>
                <span className="font-name" style={{ fontFamily: font.stack }}>
                  {font.name}
                </span>
                <span className="font-kind">{font.kind}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section settings-row">
          <div>
            <h3>Text size</h3>
            <p className="hint">{settings.fontSize}px</p>
          </div>
          <input
            type="range"
            min={12}
            max={24}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            aria-label="Text size"
          />
        </section>

        <section className="settings-section settings-row">
          <h3>Line width</h3>
          <div className="segmented">
            {WIDTHS.map((w) => (
              <button key={w.value} className={settings.lineWidth === w.value ? 'active' : ''} onClick={() => onChange({ lineWidth: w.value })}>
                {w.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section settings-row">
          <h3>Appearance</h3>
          <div className="segmented">
            {THEMES.map((t) => (
              <button key={t.value} className={settings.theme === t.value ? 'active' : ''} onClick={() => onChange({ theme: t.value })}>
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Notes folder</h3>
          <p className="hint">Each note is saved as a <code>.md</code> file in this folder. Point it at an iCloud Drive folder to sync across Macs.</p>
          <div className="folder-row">
            <code className="folder-path" title={settings.notesDir}>
              {settings.notesDir}
            </code>
            {isDesktop && (
              <>
                <button className="button" onClick={onChooseFolder}>
                  Change…
                </button>
                <button className="button" onClick={onRevealFolder}>
                  <IconFolder size={14} /> Show in Finder
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
