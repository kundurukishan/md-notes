import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Matches task items, including nested (`- - [ ]`) and quoted (`> - [ ]`) ones.
const TASK_RE = /^((?:\s*>)*\s*(?:(?:[-*+]|\d+[.)])\s+)+\[)([ xX])(\])/gm;

// Flips the nth Markdown task checkbox in the source text.
export function toggleTask(body: string, index: number): string {
  let i = 0;
  return body.replace(TASK_RE, (match, open: string, mark: string, close: string) =>
    i++ === index ? `${open}${mark === ' ' ? 'x' : ' '}${close}` : match,
  );
}

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
