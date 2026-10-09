import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { toggleTask } from './markdown';
import { displayColor } from './richtext';

// Text colors from the palette are stored as hex values; show them with the
// theme-aware palette colors so they stay readable in dark mode.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const style = node.getAttribute?.('style');
  if (style) node.setAttribute('style', style.replace(/(^|;)(\s*color\s*:\s*)(#[0-9a-f]{3,6})/gi, (_m, sep, prop, hex) => `${sep}${prop}${displayColor(hex)}`));
});

// ==text== is a highlight, as in Obsidian.
marked.use({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenizer(src: string) {
        const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
      },
    },
  ],
});

interface PreviewProps {
  body: string;
  onChange: (body: string) => void;
}

export function Preview({ body, onChange }: PreviewProps) {
  const html = useMemo(() => {
    const raw = marked.parse(body, { gfm: true, breaks: true, async: false });
    return DOMPurify.sanitize(raw);
  }, [body]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const boxes = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'));
      onChange(toggleTask(body, boxes.indexOf(target)));
      return;
    }
    const link = target.closest('a');
    if (link && link.getAttribute('href')) {
      e.preventDefault();
      window.open(link.href, '_blank');
    }
  };

  // marked renders task checkboxes as disabled; enable them so they can be ticked.
  const interactive = html.replace(/<input ([^>]*?)disabled=""/g, '<input $1');

  return <div className="preview markdown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: interactive }} />;
}
