// Text color and "not bold" are stored in notes as inline HTML, which is
// valid Markdown and renders in other apps that allow HTML:
//
//   ## <span style="color: #2860b8; font-weight: normal">Goals</span>
//
// Only spans in exactly this form are treated as formatting: one span per
// styled run, never nested, within a single line, with a style made only of
// `color` and/or `font-weight: normal`. Any other HTML is left alone.

export interface RunStyle {
  color?: string;
  normalWeight?: boolean;
}

export interface Run {
  text: string;
  style: RunStyle;
  // Positions within the raw line. For plain runs the tag positions equal the
  // inner positions.
  tagStart: number;
  innerStart: number;
  innerEnd: number;
  tagEnd: number;
}

export interface ParsedLine {
  prefix: string; // Markdown block syntax kept outside any span ("## ", "- [ ] ", "> ")
  runs: Run[];
}

export type StylePatch = { color?: string | null; normalWeight?: boolean | null };

// Same colors as the tag palette (their light-theme values). Notes store the
// hex value so other apps can show it; MD Notes swaps in the theme-aware
// variable so these colors stay readable in dark mode.
export const TEXT_COLORS: { name: string; label: string; hex: string }[] = [
  { name: 'gray', label: 'Gray', hex: '#5f5e5b' },
  { name: 'brown', label: 'Brown', hex: '#7a5540' },
  { name: 'orange', label: 'Orange', hex: '#b35815' },
  { name: 'yellow', label: 'Yellow', hex: '#92700c' },
  { name: 'green', label: 'Green', hex: '#2f7a48' },
  { name: 'teal', label: 'Teal', hex: '#1d7470' },
  { name: 'blue', label: 'Blue', hex: '#2860b8' },
  { name: 'purple', label: 'Purple', hex: '#6a45c9' },
  { name: 'pink', label: 'Pink', hex: '#b3336f' },
  { name: 'red', label: 'Red', hex: '#c1352b' },
];

// The CSS color to display for a stored color value.
export function displayColor(value: string): string {
  const named = TEXT_COLORS.find((c) => c.hex === value.toLowerCase());
  return named ? `var(--tag-${named.name}-fg)` : value;
}

const PREFIX_RE = /^[ \t]*(?:>[ \t]?)*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;
const HEADING_RE = /^[ \t]*#{1,6}[ \t]+/;
const SPAN_RE = /<span style="([^"<>]*)">([^<]*)<\/span>/g;
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+|rgba?\([0-9., %]+\))$/i;

function parseStyle(css: string): RunStyle | null {
  const style: RunStyle = {};
  for (const decl of css.split(';')) {
    if (!decl.trim()) continue;
    const m = decl.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i);
    if (!m) return null;
    const [, prop, value] = m;
    if (prop.toLowerCase() === 'color' && COLOR_RE.test(value)) style.color = value.toLowerCase();
    else if (prop.toLowerCase() === 'font-weight' && /^(normal|400)$/i.test(value)) style.normalWeight = true;
    else return null;
  }
  return style.color || style.normalWeight ? style : null;
}

function styleCss(style: RunStyle): string {
  return [style.color ? `color: ${style.color}` : '', style.normalWeight ? 'font-weight: normal' : ''].filter(Boolean).join('; ');
}

const hasStyle = (s: RunStyle) => Boolean(s.color || s.normalWeight);
const sameStyle = (a: RunStyle, b: RunStyle) => (a.color ?? '') === (b.color ?? '') && Boolean(a.normalWeight) === Boolean(b.normalWeight);

export function isHeading(line: string): boolean {
  return HEADING_RE.test(line);
}

export function parseLine(line: string): ParsedLine {
  const prefix = line.match(PREFIX_RE)?.[0] ?? '';
  const runs: Run[] = [];
  let pos = prefix.length;
  const pushPlain = (end: number) => {
    if (end > pos) runs.push({ text: line.slice(pos, end), style: {}, tagStart: pos, innerStart: pos, innerEnd: end, tagEnd: end });
  };
  SPAN_RE.lastIndex = prefix.length;
  for (let m = SPAN_RE.exec(line); m; m = SPAN_RE.exec(line)) {
    const style = parseStyle(m[1]);
    if (!style) continue;
    pushPlain(m.index);
    const innerStart = m.index + `<span style="${m[1]}">`.length;
    runs.push({ text: m[2], style, tagStart: m.index, innerStart, innerEnd: innerStart + m[2].length, tagEnd: m.index + m[0].length });
    pos = m.index + m[0].length;
  }
  pushPlain(line.length);
  return { prefix, runs };
}

export function serializeLine({ prefix, runs }: ParsedLine): string {
  return prefix + runs.map((r) => (hasStyle(r.style) && r.text ? `<span style="${styleCss(r.style)}">${r.text}</span>` : r.text)).join('');
}

// Converts a raw offset in the line to an offset in its visible text (the
// text after the prefix, without tags). Offsets inside tags snap to the
// nearest edge of the run's text.
export function visibleOffset(parsed: ParsedLine, raw: number): number {
  let vis = 0;
  for (const r of parsed.runs) {
    if (raw <= r.innerStart) return vis;
    if (raw <= r.innerEnd) return vis + raw - r.innerStart;
    vis += r.text.length;
  }
  return vis;
}

// Converts a visible offset back to a raw offset. At a run boundary, `bias`
// picks the end of the earlier run (-1) or the start of the later one (1).
export function rawOffset(parsed: ParsedLine, vis: number, bias: -1 | 1 = 1): number {
  let acc = 0;
  for (let i = 0; i < parsed.runs.length; i++) {
    const r = parsed.runs[i];
    const end = acc + r.text.length;
    if (vis < end || (vis === end && (bias < 0 || i === parsed.runs.length - 1))) return r.innerStart + (vis - acc);
    acc = end;
  }
  return parsed.prefix.length;
}

export function visibleLength(parsed: ParsedLine): number {
  return parsed.runs.reduce((n, r) => n + r.text.length, 0);
}

function merge(runs: { text: string; style: RunStyle }[]) {
  const out: { text: string; style: RunStyle }[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, r.style)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

function applyPatch(style: RunStyle, patch: StylePatch): RunStyle {
  const next = { ...style };
  if (patch.color !== undefined) {
    if (patch.color) next.color = patch.color.toLowerCase();
    else delete next.color;
  }
  if (patch.normalWeight !== undefined) {
    if (patch.normalWeight) next.normalWeight = true;
    else delete next.normalWeight;
  }
  return next;
}

// Applies a style change to the visible text range [from, to) of a line and
// returns the new line, with adjacent runs of the same style merged.
export function applyStyle(line: string, from: number, to: number, patch: StylePatch): string {
  const parsed = parseLine(line);
  const pieces: { text: string; style: RunStyle }[] = [];
  let acc = 0;
  for (const r of parsed.runs) {
    const start = acc;
    const end = acc + r.text.length;
    const a = Math.max(from, start) - start;
    const b = Math.min(to, end) - start;
    if (b <= a) pieces.push({ text: r.text, style: r.style });
    else {
      pieces.push({ text: r.text.slice(0, a), style: r.style });
      pieces.push({ text: r.text.slice(a, b), style: applyPatch(r.style, patch) });
      pieces.push({ text: r.text.slice(b), style: r.style });
    }
    acc = end;
  }
  return serializeLine({ prefix: parsed.prefix, runs: merge(pieces).map((p) => ({ ...p, tagStart: 0, innerStart: 0, innerEnd: 0, tagEnd: 0 })) });
}

// The style shared by every character in [from, to), or by the character at
// `from` when the range is empty. Properties that differ are left out.
export function styleAt(line: string, from: number, to: number): RunStyle {
  const parsed = parseLine(line);
  const styles: RunStyle[] = [];
  let acc = 0;
  for (const r of parsed.runs) {
    const start = acc;
    const end = acc + r.text.length;
    if (from === to ? from >= start && from < end : start < to && end > from) styles.push(r.style);
    acc = end;
  }
  if (!styles.length && from === to && parsed.runs.length) styles.push(parsed.runs[parsed.runs.length - 1].style);
  if (!styles.length) return {};
  const first = styles[0];
  return {
    ...(styles.every((s) => s.color === first.color) && first.color ? { color: first.color } : {}),
    ...(styles.every((s) => Boolean(s.normalWeight)) ? { normalWeight: true } : {}),
  };
}

// Removes formatting spans left broken by an edit (an opening tag without its
// closing tag or the reverse) and empty spans. Other HTML, including spans
// with other styles and their closing tags, is kept.
export function normalizeLine(line: string): string {
  const parsed = parseLine(line);
  let foreignOpen = 0; // unclosed non-formatting <span>s seen so far
  const clean = (text: string) =>
    text.replace(/<span\b[^>]*>|<\/span>/g, (tag) => {
      if (tag === '</span>') {
        if (foreignOpen > 0) {
          foreignOpen--;
          return tag;
        }
        return '';
      }
      const style = tag.match(/^<span style="([^"<>]*)">$/);
      if (style && parseStyle(style[1])) return '';
      foreignOpen++;
      return tag;
    });
  let out = '';
  let pos = 0;
  for (const r of parsed.runs) {
    if (!hasStyle(r.style)) continue;
    out += clean(line.slice(pos, r.tagStart));
    if (r.text) out += line.slice(r.tagStart, r.tagEnd);
    pos = r.tagEnd;
  }
  return out + clean(line.slice(pos));
}

// Removes formatting tags from text (for snippets, search and word counts).
export function stripFormatting(text: string): string {
  return text.replace(/<span style="[^"<>]*">|<\/span>/g, '');
}
