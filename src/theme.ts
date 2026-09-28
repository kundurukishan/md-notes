import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/400-italic.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-serif/400.css';
import '@fontsource/ibm-plex-serif/400-italic.css';
import '@fontsource/ibm-plex-serif/600.css';
import '@fontsource/ibm-plex-serif/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/600.css';
import '@fontsource/lora/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/700.css';

export interface FontOption {
  name: string;
  stack: string;
  kind: 'Sans' | 'Serif' | 'Mono';
}

// All fonts are bundled with the app, so they work offline.
export const FONTS: FontOption[] = [
  { name: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif", kind: 'Sans' },
  { name: 'Roboto', stack: "'Roboto', system-ui, sans-serif", kind: 'Sans' },
  { name: 'Inter', stack: "'Inter', system-ui, sans-serif", kind: 'Sans' },
  { name: 'System', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", kind: 'Sans' },
  { name: 'IBM Plex Serif', stack: "'IBM Plex Serif', Georgia, serif", kind: 'Serif' },
  { name: 'Lora', stack: "'Lora', Georgia, serif", kind: 'Serif' },
  { name: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace", kind: 'Mono' },
  { name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", kind: 'Mono' },
];

export function fontStack(name: string): string {
  return (FONTS.find((f) => f.name === name) ?? FONTS[0]).stack;
}

export interface TagColor {
  name: string;
  label: string;
}

// Soft Capacities-style palette. Actual colors live in CSS (--tag-<name>-bg/fg)
// so they can adapt to light and dark mode.
export const TAG_COLORS: TagColor[] = [
  { name: 'gray', label: 'Gray' },
  { name: 'brown', label: 'Brown' },
  { name: 'orange', label: 'Orange' },
  { name: 'yellow', label: 'Yellow' },
  { name: 'green', label: 'Green' },
  { name: 'teal', label: 'Teal' },
  { name: 'blue', label: 'Blue' },
  { name: 'purple', label: 'Purple' },
  { name: 'pink', label: 'Pink' },
  { name: 'red', label: 'Red' },
];

// Tags without an explicit color get a stable one derived from their name.
export function tagColor(tag: string, colors: Record<string, string>): string {
  if (colors[tag]) return colors[tag];
  let hash = 0;
  for (const ch of tag) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const palette = TAG_COLORS.filter((c) => c.name !== 'gray');
  return palette[hash % palette.length].name;
}
