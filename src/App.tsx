import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { api, isDesktop, type MenuCommand, type Note, type Settings, type TagColors } from './api';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { SettingsDialog } from './SettingsDialog';
import { TagChip, TagInput } from './TagInput';
import { TAG_COLORS, fontStack, tagColor } from './theme';
import {
  IconEye,
  IconNotes,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSort,
  IconTrash,
  IconUntagged,
} from './Icons';

// `key` is a stable client-side identity; `id` is the filename and changes when
// a note's title changes.
type LocalNote = Note & { key: string };
type Filter = { kind: 'all' } | { kind: 'pinned' } | { kind: 'untagged' } | { kind: 'tag'; tag: string };

const SAVE_DELAY = 400;
let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function snippet(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 160);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function formatLong(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function App() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [colors, setColors] = useState<TagColors>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const notesRef = useRef<LocalNote[]>([]);
  const versions = useRef(new Map<string, number>());
  const saved = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, number>());
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<EditorView | null>(null);

  const commit = useCallback((fn: (prev: LocalNote[]) => LocalNote[]) => {
    notesRef.current = fn(notesRef.current);
    setNotes(notesRef.current);
  }, []);

  const isDirty = (key: string) => (versions.current.get(key) ?? 0) !== (saved.current.get(key) ?? 0) || inflight.current.has(key);

  // ---- Saving -------------------------------------------------------------

  const flush = useCallback(
    async (key: string) => {
      window.clearTimeout(timers.current.get(key));
      timers.current.delete(key);
      while (inflight.current.has(key)) await inflight.current.get(key);
      const note = notesRef.current.find((n) => n.key === key);
      const version = versions.current.get(key) ?? 0;
      if (!note || version === (saved.current.get(key) ?? 0)) return;

      const promise = api
        .saveNote({ id: note.id, title: note.title, body: note.body, tags: note.tags, pinned: note.pinned })
        .then((res) => {
          saved.current.set(key, version);
          commit((prev) => prev.map((n) => (n.key === key ? { ...n, id: res.id, updated: res.updated, created: res.created } : n)));
        })
        .catch((err) => {
          console.error('Failed to save note', err);
        });
      inflight.current.set(key, promise);
      try {
        await promise;
      } finally {
        inflight.current.delete(key);
      }
    },
    [commit],
  );

  const scheduleSave = useCallback(
    (key: string) => {
      window.clearTimeout(timers.current.get(key));
      timers.current.set(key, window.setTimeout(() => void flush(key), SAVE_DELAY));
    },
    [flush],
  );

  const updateNote = useCallback(
    (key: string, patch: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned'>>) => {
      commit((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch, updated: new Date().toISOString() } : n)));
      versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
      scheduleSave(key);
    },
    [commit, scheduleSave],
  );

  const flushAll = useCallback(() => Promise.all(notesRef.current.map((n) => flush(n.key))), [flush]);

  // ---- Loading ------------------------------------------------------------

  const reload = useCallback(async () => {
    const [disk, tagColors] = await Promise.all([api.listNotes(), api.getTagColors()]);
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    const next: LocalNote[] = disk.map((n) => {
      const local = byId.get(n.id);
      if (local && isDirty(local.key)) return local;
      return { ...n, key: local?.key ?? newKey() };
    });
    // Keep notes with unsaved edits even if their file is missing on disk.
    for (const local of notesRef.current) {
      if (!next.some((n) => n.key === local.key) && isDirty(local.key)) next.push(local);
    }
    commit(() => next);
    setColors(tagColors);
    return next;
  }, [commit]);

  useEffect(() => {
    api.getSettings().then(setSettings);
    reload().then((list) => {
      const first = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated))[0];
      if (first) setSelectedKey(first.key);
    });
    const off = api.onNotesChanged(() => void reload());
    const flushOnExit = () => void flushAll();
    window.addEventListener('beforeunload', flushOnExit);
    return () => {
      off();
      window.removeEventListener('beforeunload', flushOnExit);
    };
  }, [reload, flushAll]);

  // ---- Derived state ------------------------------------------------------

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith('#') && w.length > 1).map((w) => w.slice(1));
    const textTerms = words.filter((w) => !w.startsWith('#'));
    const sort = settings?.sort ?? 'updated';
    return notes
      .filter((n) => {
        if (filter.kind === 'pinned' && !n.pinned) return false;
        if (filter.kind === 'untagged' && n.tags.length) return false;
        if (filter.kind === 'tag' && !n.tags.includes(filter.tag)) return false;
        if (!tagTerms.every((t) => n.tags.some((tag) => tag.startsWith(t)))) return false;
        const hay = `${n.title}\n${n.body}`.toLowerCase();
        return textTerms.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sort === 'title') return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
        if (sort === 'created') return b.created.localeCompare(a.created);
        return b.updated.localeCompare(a.updated);
      });
  }, [notes, filter, query, settings?.sort]);

  const selected = notes.find((n) => n.key === selectedKey) ?? null;

  // ---- Actions ------------------------------------------------------------

  const select = useCallback(
    (key: string | null) => {
      const prev = notesRef.current.find((n) => n.key === selectedKey);
      if (prev && prev.key !== key) {
        void flush(prev.key).then(async () => {
          // Discard notes that were created but never written in.
          const current = notesRef.current.find((n) => n.key === prev.key);
          if (current && !current.title.trim() && !current.body.trim()) {
            await api.trashNote(current.id).catch(() => {});
            commit((list) => list.filter((n) => n.key !== prev.key));
          }
        });
      }
      setSelectedKey(key);
    },
    [selectedKey, flush, commit],
  );

  const createNote = useCallback(async () => {
    const tags = filter.kind === 'tag' ? [filter.tag] : [];
    const note = await api.createNote({ tags });
    const local: LocalNote = { ...note, key: newKey() };
    commit((prev) => [local, ...prev]);
    if (filter.kind === 'pinned') setFilter({ kind: 'all' });
    setQuery('');
    setPreview(false);
    select(local.key);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [filter, commit, select]);

  const trashSelected = useCallback(async () => {
    if (!selected) return;
    const index = visible.findIndex((n) => n.key === selected.key);
    const next = visible[index + 1] ?? visible[index - 1] ?? null;
    window.clearTimeout(timers.current.get(selected.key));
    while (inflight.current.has(selected.key)) await inflight.current.get(selected.key);
    const current = notesRef.current.find((n) => n.key === selected.key);
    if (current) await api.trashNote(current.id).catch(() => {});
    versions.current.delete(selected.key);
    saved.current.delete(selected.key);
    commit((prev) => prev.filter((n) => n.key !== selected.key));
    setSelectedKey(next?.key ?? null);
  }, [selected, visible, commit]);

  const togglePin = useCallback(() => {
    if (selected) updateNote(selected.key, { pinned: !selected.pinned });
  }, [selected, updateNote]);

  const changeSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api.setSettings(patch));
  }, []);

  const chooseFolder = useCallback(async () => {
    await flushAll();
    const next = await api.chooseFolder();
    setSettings(next);
    commit(() => []);
    const list = await reload();
    setSelectedKey(list[0]?.key ?? null);
  }, [flushAll, reload, commit]);

  const setTagColorFor = useCallback(async (tag: string, color: string) => {
    setColors((c) => ({ ...c, [tag]: color }));
    setColors(await api.setTagColor(tag, color));
  }, []);

  const renameTag = useCallback(
    async (from: string, to: string) => {
      await flushAll();
      await api.renameTag(from, to);
      await reload();
      if (filter.kind === 'tag' && filter.tag === from) {
        setFilter(to ? { kind: 'tag', tag: to.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase() } : { kind: 'all' });
      }
    },
    [flushAll, reload, filter],
  );

  const moveSelection = (delta: number) => {
    if (!visible.length) return;
    const index = visible.findIndex((n) => n.key === selectedKey);
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + delta))];
    if (next) select(next.key);
  };

  // ---- Commands & shortcuts ----------------------------------------------

  const runCommand = useCallback(
    (command: MenuCommand) => {
      switch (command) {
        case 'new':
          void createNote();
          break;
        case 'search':
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case 'preview':
          setPreview((p) => !p);
          break;
        case 'settings':
          setShowSettings(true);
          break;
        case 'pin':
          togglePin();
          break;
        case 'trash':
          void trashSelected();
          break;
        case 'sidebar':
          setSidebarOpen((o) => !o);
          break;
      }
    },
    [createNote, togglePin, trashSelected],
  );

  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;

  useEffect(() => api.onMenuCommand((c) => commandRef.current(c)), []);

  // In the browser build there is no native menu, so handle shortcuts here.
  useEffect(() => {
    if (isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, MenuCommand> = { e: 'preview', ',': 'settings', k: 'search', '\\': 'sidebar', j: 'new' };
      const command = map[e.key.toLowerCase()];
      if (command) {
        e.preventDefault();
        commandRef.current(command);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Appearance ---------------------------------------------------------

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    root.style.setProperty('--note-font', fontStack(settings.font));
    root.style.setProperty('--note-size', `${settings.fontSize}px`);
    root.style.setProperty('--line-width', `${settings.lineWidth}px`);
  }, [settings]);

  // Grow the title field to fit long titles.
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [selected?.title, selectedKey, settings?.font, settings?.fontSize]);

  useEffect(() => {
    if (!tagMenu) return;
    const close = () => {
      setTagMenu(null);
      setRenaming(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [tagMenu]);

  // ---- Render -------------------------------------------------------------

  const filterLabel =
    filter.kind === 'all' ? 'All notes' : filter.kind === 'pinned' ? 'Pinned' : filter.kind === 'untagged' ? 'Untagged' : `#${filter.tag}`;
  const counts = {
    all: notes.length,
    pinned: notes.filter((n) => n.pinned).length,
    untagged: notes.filter((n) => !n.tags.length).length,
  };
  const words = selected ? (selected.body.match(/\S+/g) ?? []).length : 0;
  const nextSort = { updated: 'created', created: 'title', title: 'updated' } as const;
  const sortLabel = { updated: 'Last edited', created: 'Date created', title: 'Title' };

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}${isDesktop ? ' desktop' : ''}`}>
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-top drag">
            <span className="brand">MD Notes</span>
          </div>
          <button className="new-note no-drag" onClick={() => void createNote()}>
            <IconPlus /> New note
            <kbd>{isDesktop ? '⌘N' : ''}</kbd>
          </button>
          <nav className="nav">
            <button className={`nav-item${filter.kind === 'all' ? ' active' : ''}`} onClick={() => setFilter({ kind: 'all' })}>
              <IconNotes /> All notes <span className="count">{counts.all}</span>
            </button>
            <button className={`nav-item${filter.kind === 'pinned' ? ' active' : ''}`} onClick={() => setFilter({ kind: 'pinned' })}>
              <IconPin /> Pinned <span className="count">{counts.pinned}</span>
            </button>
            <button className={`nav-item${filter.kind === 'untagged' ? ' active' : ''}`} onClick={() => setFilter({ kind: 'untagged' })}>
              <IconUntagged /> Untagged <span className="count">{counts.untagged}</span>
            </button>
          </nav>

          <div className="section-label">Tags</div>
          <nav className="nav tags-nav">
            {allTags.length === 0 && <p className="empty-hint">Tags you add to notes show up here.</p>}
            {allTags.map(([tag, count]) => (
              <button
                key={tag}
                className={`nav-item${filter.kind === 'tag' && filter.tag === tag ? ' active' : ''}`}
                onClick={() => setFilter({ kind: 'tag', tag })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTagMenu({ tag, x: e.clientX, y: e.clientY });
                }}
              >
                <span className={`tag-dot tag-${tagColor(tag, colors)}`} />
                <span className="nav-text">{tag}</span>
                <span className="count">{count}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setShowSettings(true)}>
              <IconSettings /> Settings
            </button>
          </div>
        </aside>
      )}

      <section className="list-pane">
        <div className="list-header drag">
          {!sidebarOpen && (
            <button className="icon-button no-drag" onClick={() => setSidebarOpen(true)} title="Show sidebar" aria-label="Show sidebar">
              <IconSidebar />
            </button>
          )}
          <div className="list-title">
            <h1>{filterLabel}</h1>
            <span>{visible.length} {visible.length === 1 ? 'note' : 'notes'}</span>
          </div>
          <button
            className="icon-button no-drag"
            title={`Sort: ${sortLabel[settings?.sort ?? 'updated']}`}
            aria-label="Change sort order"
            onClick={() => settings && void changeSettings({ sort: nextSort[settings.sort] })}
          >
            <IconSort />
          </button>
          <button className="icon-button no-drag" title="New note" aria-label="New note" onClick={() => void createNote()}>
            <IconPencil />
          </button>
        </div>
        <div className="search">
          <IconSearch size={14} />
          <input
            ref={searchRef}
            value={query}
            placeholder="Search notes or #tag"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(e.key === 'ArrowDown' ? 1 : -1);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                editorRef.current?.focus();
              }
            }}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        <div className="note-list">
          {visible.length === 0 && (
            <div className="list-empty">
              <p>{query ? 'No notes match your search.' : 'No notes here yet.'}</p>
              {!query && (
                <button className="button" onClick={() => void createNote()}>
                  <IconPlus size={14} /> New note
                </button>
              )}
            </div>
          )}
          {visible.map((n) => (
            <button key={n.key} className={`note-item${n.key === selectedKey ? ' selected' : ''}`} onClick={() => select(n.key)}>
              <div className="note-item-top">
                <span className={`note-item-title${n.title ? '' : ' untitled'}`}>{n.title || 'Untitled'}</span>
                {n.pinned && <span className="pin-mark"><IconPin size={12} /></span>}
              </div>
              <div className="note-item-snippet">{snippet(n.body) || 'No additional text'}</div>
              <div className="note-item-meta">
                <span className="note-item-date">{formatDate(n.updated)}</span>
                {n.tags.slice(0, 3).map((t) => (
                  <TagChip key={t} tag={t} colors={colors} small />
                ))}
                {n.tags.length > 3 && <span className="more-tags">+{n.tags.length - 3}</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <main className="editor-pane">
        <div className="editor-toolbar drag">
          <div className="crumbs">
            {selected && (
              <>
                <span>{filterLabel}</span>
                <span className="crumb-sep">/</span>
                <span className="crumb-current">{selected.title || 'Untitled'}</span>
              </>
            )}
          </div>
          {selected && (
            <div className="toolbar-actions no-drag">
              <button className={`icon-button${selected.pinned ? ' on' : ''}`} onClick={togglePin} title="Pin note (⇧⌘P)" aria-label="Pin note">
                <IconPin />
              </button>
              <button className={`icon-button${preview ? ' on' : ''}`} onClick={() => setPreview((p) => !p)} title="Toggle preview (⌘E)" aria-label="Toggle preview">
                {preview ? <IconPencil /> : <IconEye />}
              </button>
              <button className="icon-button danger" onClick={() => void trashSelected()} title="Move to trash (⌘⌫)" aria-label="Move to trash">
                <IconTrash />
              </button>
            </div>
          )}
        </div>

        {selected ? (
          <div className="document-scroll">
            <article className="document">
              <textarea
                ref={titleRef}
                className="title-input"
                rows={1}
                value={selected.title}
                placeholder="Untitled"
                spellCheck
                onChange={(e) => updateNote(selected.key, { title: e.target.value.replace(/\n/g, ' ') })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || (e.key === 'ArrowDown' && !preview)) {
                    e.preventDefault();
                    editorRef.current?.focus();
                  }
                }}
              />
              <div className="properties">
                <div className="property">
                  <span className="property-label">Tags</span>
                  <TagInput
                    tags={selected.tags}
                    allTags={allTags.map(([t]) => t)}
                    colors={colors}
                    onChange={(tags) => updateNote(selected.key, { tags })}
                    onSelectTag={(tag) => setFilter({ kind: 'tag', tag })}
                  />
                </div>
                <div className="property">
                  <span className="property-label">Edited</span>
                  <span className="property-value">{formatLong(selected.updated)}</span>
                </div>
              </div>
              <div className={preview ? 'hidden' : ''}>
                <Editor docKey={selected.key} value={selected.body} onChange={(body) => updateNote(selected.key, { body })} editorRef={editorRef} />
              </div>
              {preview && <Preview body={selected.body} onChange={(body) => updateNote(selected.key, { body })} />}
            </article>
          </div>
        ) : (
          <div className="no-selection">
            <IconNotes size={36} />
            <p>Select a note or create a new one.</p>
            <button className="button primary" onClick={() => void createNote()}>
              <IconPlus size={14} /> New note
            </button>
          </div>
        )}
        {selected && (
          <div className="status-bar">
            {words} {words === 1 ? 'word' : 'words'} · {selected.body.length} characters
          </div>
        )}
      </main>

      {tagMenu && (
        <div className="context-menu" style={{ left: tagMenu.x, top: tagMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="context-title">#{tagMenu.tag}</div>
          <div className="swatches">
            {TAG_COLORS.map((c) => (
              <button
                key={c.name}
                className={`swatch tag-${c.name}${tagColor(tagMenu.tag, colors) === c.name ? ' selected' : ''}`}
                title={c.label}
                aria-label={c.label}
                onClick={() => void setTagColorFor(tagMenu.tag, c.name)}
              />
            ))}
          </div>
          <div className="context-sep" />
          {renaming !== null ? (
            <form
              className="rename-form"
              onSubmit={(e) => {
                e.preventDefault();
                const to = renaming.trim();
                if (to && to !== tagMenu.tag) void renameTag(tagMenu.tag, to);
                setTagMenu(null);
                setRenaming(null);
              }}
            >
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="New tag name" />
            </form>
          ) : (
            <button className="context-item" onClick={() => setRenaming(tagMenu.tag)}>
              Rename tag…
            </button>
          )}
          <button
            className="context-item danger"
            onClick={() => {
              const tag = tagMenu.tag;
              setTagMenu(null);
              if (window.confirm(`Remove #${tag} from all notes? The notes themselves are kept.`)) void renameTag(tag, '');
            }}
          >
            Delete tag
          </button>
        </div>
      )}

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          isDesktop={isDesktop}
          onChange={(patch) => void changeSettings(patch)}
          onChooseFolder={() => void chooseFolder()}
          onRevealFolder={() => void api.revealFolder()}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
