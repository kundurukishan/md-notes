import type { Note } from './api';
import { IconChevron, IconFile, IconFolder, IconFolderOpen } from './Icons';

// The folder tree shown in the sidebar: folders (collapsible) and the
// Markdown files in them, in natural name order with folders first.

export type LocalNote = Note & { key: string };

export type TreeNode =
  | { kind: 'dir'; id: string; name: string; children: TreeNode[] }
  | { kind: 'file'; id: string; name: string; note: LocalNote };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function buildTree(notes: LocalNote[], dirs: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, TreeNode[]>([['', root]]);
  const ensureDir = (id: string): TreeNode[] => {
    const existing = byPath.get(id);
    if (existing) return existing;
    const slash = id.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : id.slice(0, slash));
    const node: TreeNode = { kind: 'dir', id, name: id.slice(slash + 1), children: [] };
    parent.push(node);
    byPath.set(id, node.children);
    return node.children;
  };
  for (const dir of dirs) ensureDir(dir);
  for (const note of notes) ensureDir(note.dir).push({ kind: 'file', id: note.id, name: note.name, note });
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : collator.compare(a.name, b.name)));
    for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

// Keeps only the files in `keep` (and the folders leading to them).
export function pruneTree(nodes: TreeNode[], keep: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'file') {
      if (keep.has(n.note.key)) out.push(n);
    } else {
      const children = pruneTree(n.children, keep);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}

// The files in the order they appear on screen (expanded folders only).
export function visibleFiles(nodes: TreeNode[], isOpen: (id: string) => boolean): LocalNote[] {
  const out: LocalNote[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'file') out.push(n.note);
      else if (isOpen(n.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === 'file' ? 1 : countFiles(node.children)), 0);
}

interface FileTreeProps {
  nodes: TreeNode[];
  selectedKey: string | null;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  onSelect: (key: string) => void;
  onContextMenu: (target: { kind: 'dir' | 'file'; id: string; key?: string }, e: React.MouseEvent) => void;
  // An inline "new folder" input shown inside this folder ('' for the top level).
  newFolderIn: string | null;
  newFolderName: string;
  onNewFolderName: (name: string) => void;
  onNewFolderSubmit: () => void;
  onNewFolderCancel: () => void;
  depth?: number;
}

export function FileTree(props: FileTreeProps) {
  const { nodes, selectedKey, isOpen, onToggle, onSelect, onContextMenu, depth = 0 } = props;
  const indent = { paddingLeft: `${10 + depth * 18}px` };
  const newFolderForm = (parent: string) =>
    props.newFolderIn === parent && (
      <form
        className="tree-item dir new-folder-form"
        style={{ paddingLeft: `${10 + (depth + (parent ? 1 : 0)) * 18}px` }}
        onSubmit={(e) => {
          e.preventDefault();
          props.onNewFolderSubmit();
        }}
      >
        <span className="tree-chevron" />
        <IconFolder />
        <input
          autoFocus
          value={props.newFolderName}
          placeholder="Folder name"
          aria-label="New folder name"
          onChange={(e) => props.onNewFolderName(e.target.value)}
          onBlur={() => (props.newFolderName.trim() ? props.onNewFolderSubmit() : props.onNewFolderCancel())}
          onKeyDown={(e) => e.key === 'Escape' && props.onNewFolderCancel()}
        />
      </form>
    );

  return (
    <>
      {depth === 0 && newFolderForm('')}
      {nodes.map((node) =>
        node.kind === 'dir' ? (
          <div key={`d:${node.id}`} className="tree-dir">
            <button
              className={`tree-item dir${isOpen(node.id) ? ' open' : ''}`}
              style={indent}
              onClick={() => onToggle(node.id)}
              onContextMenu={(e) => onContextMenu({ kind: 'dir', id: node.id }, e)}
              aria-expanded={isOpen(node.id)}
              title={node.id}
            >
              <span className="tree-chevron">
                <IconChevron size={14} />
              </span>
              {isOpen(node.id) ? <IconFolderOpen /> : <IconFolder />}
              <span className="tree-text">{node.name}</span>
              <span className="count">{countFiles(node.children) || ''}</span>
            </button>
            {isOpen(node.id) && (
              <div className="tree-children" role="group">
                {newFolderForm(node.id)}
                <FileTree {...props} nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        ) : (
          <button
            key={`f:${node.note.key}`}
            className={`tree-item file${node.note.key === selectedKey ? ' active' : ''}`}
            style={indent}
            onClick={() => onSelect(node.note.key)}
            onContextMenu={(e) => onContextMenu({ kind: 'file', id: node.id, key: node.note.key }, e)}
            title={node.id}
            data-key={node.note.key}
          >
            <span className="tree-chevron" />
            <IconFile />
            <span className="tree-text">{node.note.title || node.name}</span>
          </button>
        ),
      )}
    </>
  );
}
