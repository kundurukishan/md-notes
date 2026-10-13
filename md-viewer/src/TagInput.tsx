import { useMemo, useState } from 'react';
import { tagColor } from './theme';

interface TagChipProps {
  tag: string;
  colors: Record<string, string>;
  onRemove?: () => void;
  onClick?: () => void;
  small?: boolean;
}

export function TagChip({ tag, colors, onRemove, onClick, small }: TagChipProps) {
  return (
    <span className={`tag-chip tag-${tagColor(tag, colors)}${small ? ' small' : ''}`} onClick={onClick}>
      <span className="tag-hash">#</span>
      {tag}
      {onRemove && (
        <button
          className="tag-remove"
          aria-label={`Remove tag ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

interface TagInputProps {
  tags: string[];
  allTags: string[];
  colors: Record<string, string>;
  onChange: (tags: string[]) => void;
  onSelectTag: (tag: string) => void;
}

const normalize = (tag: string) => tag.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();

export function TagInput({ tags, allTags, colors, onChange, onSelectTag }: TagInputProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    const q = normalize(text);
    return allTags.filter((t) => !tags.includes(t) && (!q || t.includes(q))).slice(0, 6);
  }, [text, allTags, tags]);

  const add = (raw: string) => {
    const tag = normalize(raw);
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setText('');
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = focused && text && suggestions.length > 0;
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!text.trim()) return;
      e.preventDefault();
      add(open && active < suggestions.length ? suggestions[active] : text);
    } else if (e.key === 'Backspace' && !text && tags.length) {
      onChange(tags.slice(0, -1));
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Escape') {
      setText('');
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="tag-input">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} colors={colors} onClick={() => onSelectTag(tag)} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <div className="tag-entry">
        <input
          value={text}
          placeholder={tags.length ? 'Add tag' : 'Add tags…'}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim()) add(text);
          }}
        />
        {focused && text && suggestions.length > 0 && (
          <div className="tag-suggestions">
            {suggestions.map((s, i) => (
              <div
                key={s}
                className={`tag-suggestion${i === active ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <TagChip tag={s} colors={colors} small />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
