import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createProjectFolder,
  deleteProjectFile,
  fetchProjectTree,
  renameProjectFile,
  writeProjectTextFile,
} from '../providers/registry';
import type { ProjectTreeNode } from '../types';
import { Icon } from './Icon';
import {
  ExplorerUploadModal,
  importFilesIntoProject,
  readDataTransferFiles,
} from './ExplorerUploadModal';

interface Props {
  projectId: string;
  /** Open the file in the right-hand FileWorkspace (creates or focuses a tab). */
  onOpenFile: (path: string) => void;
  /** Bumped whenever the host wants the tree to re-fetch (after CRUD,
   * after a save, after switching projects). */
  refreshKey?: number;
  /** Callback when the user explicitly closed a file via the tree (so the
   * host can drop its tab). Optional. */
  onAfterMutate?: () => void;
}

type ContextMenu = {
  x: number;
  y: number;
  node: ProjectTreeNode | null; // null = clicked on empty space (root context)
};

type InlineEdit = {
  // Where the input renders. For 'rename' it replaces an existing row.
  // For 'create' it appears inside `parentPath` (or root when empty).
  mode: 'rename' | 'create-file' | 'create-folder';
  parentPath: string; // empty string = project root
  initialValue: string;
  // Only set for rename — the path being renamed (full).
  target?: string;
};

export function FileExplorerPanel({ projectId, onOpenFile, refreshKey = 0, onAfterMutate }: Props) {
  const [nodes, setNodes] = useState<ProjectTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bump, setBump] = useState(0); // local refresh trigger
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchProjectTree(projectId, { showHidden: true, showBuildDirs: true });
    if (!result) {
      setError('Failed to load project tree.');
      setNodes([]);
    } else {
      setNodes(result.nodes ?? []);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, bump]);

  // Close the context menu on any unrelated click / Esc.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', closeKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeKey);
    };
  }, [contextMenu]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Every directory path in the current tree — used to compute whether the
  // tree is fully expanded and to drive the expand/collapse-all toggle.
  const allDirPaths = useMemo(() => {
    const acc: string[] = [];
    const walk = (list: ProjectTreeNode[]) => {
      for (const n of list) {
        if (n.kind === 'dir') {
          acc.push(n.path);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(nodes);
    return acc;
  }, [nodes]);

  const allExpanded = allDirPaths.length > 0 && allDirPaths.every((p) => expanded.has(p));

  const expandAll = useCallback(() => {
    setExpanded(new Set(allDirPaths));
  }, [allDirPaths]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // Single toggle behind the chevron icon: open every folder (chevron flips
  // up) or collapse back to the root (chevron returns to its down position).
  const toggleExpandCollapse = useCallback(() => {
    if (allExpanded) collapseAll();
    else expandAll();
  }, [allExpanded, collapseAll, expandAll]);

  const refresh = useCallback(() => {
    setBump((n) => n + 1);
    onAfterMutate?.();
  }, [onAfterMutate]);

  // Paste files copied from outside the app (Finder/Explorer, screenshots,
  // images from the web) straight into the project. Active only while the
  // Files panel is mounted; ignores paste when the focus is in an editable
  // field (so Cmd/Ctrl+V still works for normal text entry) and when the
  // clipboard carries no files.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt || !dt.files || dt.files.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const editable =
        !!active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable);
      if (editable) return;
      e.preventDefault();
      const picked = await readDataTransferFiles(dt);
      if (picked.length === 0) return;
      setActionError(null);
      const result = await importFilesIntoProject(projectId, picked);
      if (result.failed.length > 0) {
        setActionError(`Could not paste ${result.failed.length} file(s).`);
      }
      refresh();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [projectId, refresh]);

  // ── Context menu actions ────────────────────────────────────────────
  const startCreate = useCallback((kind: 'file' | 'folder', parentNode: ProjectTreeNode | null) => {
    const parentPath = parentNode && parentNode.kind === 'dir' ? parentNode.path : '';
    // Auto-expand the parent so the new-row is visible.
    if (parentPath) {
      setExpanded((prev) => {
        if (prev.has(parentPath)) return prev;
        const next = new Set(prev);
        next.add(parentPath);
        return next;
      });
    }
    setInlineEdit({
      mode: kind === 'file' ? 'create-file' : 'create-folder',
      parentPath,
      initialValue: '',
    });
    setContextMenu(null);
  }, []);

  const startRename = useCallback((node: ProjectTreeNode) => {
    setInlineEdit({ mode: 'rename', parentPath: parentPathOf(node.path), initialValue: node.name, target: node.path });
    setContextMenu(null);
  }, []);

  const handleDelete = useCallback(async (node: ProjectTreeNode) => {
    setContextMenu(null);
    const isDir = node.kind === 'dir';
    const confirmMsg = isDir
      ? `Delete the folder "${node.name}" and everything inside it?`
      : `Delete "${node.name}"?`;
    if (!window.confirm(confirmMsg)) return;
    const ok = await deleteProjectFile(projectId, node.path);
    if (!ok) {
      setActionError(`Could not delete ${node.path}`);
      return;
    }
    setActionError(null);
    refresh();
  }, [projectId, refresh]);

  // Submit the inline edit (create or rename).
  const commitInlineEdit = useCallback(async (value: string) => {
    if (!inlineEdit) return;
    const trimmed = value.trim();
    if (!trimmed) { setInlineEdit(null); return; }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '..' || trimmed === '.') {
      setActionError('Name must not contain slashes or dots-only.');
      return;
    }
    setActionError(null);
    const fullPath = inlineEdit.parentPath ? `${inlineEdit.parentPath}/${trimmed}` : trimmed;
    if (inlineEdit.mode === 'create-folder') {
      const ok = await createProjectFolder(projectId, fullPath);
      if (!ok) { setActionError(`Could not create folder ${fullPath}`); return; }
    } else if (inlineEdit.mode === 'create-file') {
      const result = await writeProjectTextFile(projectId, fullPath, '');
      if (!result) { setActionError(`Could not create file ${fullPath}`); return; }
      onOpenFile(fullPath);
    } else if (inlineEdit.mode === 'rename') {
      if (!inlineEdit.target) { setInlineEdit(null); return; }
      if (trimmed === inlineEdit.initialValue) { setInlineEdit(null); return; }
      const result = await renameProjectFile(projectId, inlineEdit.target, fullPath);
      if (!result) { setActionError(`Could not rename to ${fullPath}`); return; }
    }
    setInlineEdit(null);
    refresh();
  }, [inlineEdit, projectId, onOpenFile, refresh]);

  const cancelInlineEdit = useCallback(() => { setInlineEdit(null); setActionError(null); }, []);

  // Streams the full project (minus node_modules / build dirs — see
  // collectArchiveEntries on the daemon) and triggers a browser download.
  // Surfaces errors via the existing actionError placeholder rather than
  // falling back to a single-file zip — the explorer has no rendered
  // artifact to pack as a fallback.
  const downloadProject = useCallback(async () => {
    setActionError(null);
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive`);
      if (!resp.ok) throw new Error(`archive request failed (${resp.status})`);
      const blob = await resp.blob();
      const header = resp.headers.get('content-disposition') || '';
      let filename = 'project.zip';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
      if (star && star[1]) {
        try { filename = decodeURIComponent(star[1]); } catch { filename = star[1]; }
      } else {
        const plain = /filename="([^"]+)"/i.exec(header);
        if (plain && plain[1]) filename = plain[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setActionError(`Could not download project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [projectId]);

  // ── Render ──────────────────────────────────────────────────────────
  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  };

  return (
    <div className="explorer-panel" onContextMenu={handleRootContextMenu}>
      <header className="explorer-panel__head">
        <span className="explorer-panel__title">Explorer</span>
        <div className="explorer-panel__actions">
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={() => startCreate('file', null)}
            title="New file"
            aria-label="New file at project root"
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={() => startCreate('folder', null)}
            title="New folder"
            aria-label="New folder at project root"
          >
            <Icon name="folder" size={14} />
          </button>
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={() => void load()}
            title="Refresh"
            aria-label="Refresh tree"
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={toggleExpandCollapse}
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            aria-label={allExpanded ? 'Collapse all folders' : 'Expand all folders'}
            aria-pressed={allExpanded}
          >
            <span
              className="explorer-panel__chevron-toggle"
              style={{ transform: allExpanded ? 'rotate(180deg)' : 'none' }}
            >
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={() => setUploadOpen(true)}
            title="Import files"
            aria-label="Import files into project"
          >
            <Icon name="upload" size={14} />
          </button>
          <button
            type="button"
            className="explorer-panel__icon-btn"
            onClick={() => void downloadProject()}
            title="Download project as .zip"
            aria-label="Download project as .zip"
          >
            <Icon name="download" size={14} />
          </button>
        </div>
      </header>
      {actionError ? (
        <div className="explorer-panel__placeholder explorer-panel__placeholder--error">
          {actionError}
        </div>
      ) : null}
      <div className="explorer-panel__body" role="tree">
        {loading && nodes.length === 0 ? (
          <div className="explorer-panel__placeholder">Loading…</div>
        ) : error ? (
          <div className="explorer-panel__placeholder explorer-panel__placeholder--error">{error}</div>
        ) : nodes.length === 0 && !inlineEdit ? (
          <div className="explorer-panel__placeholder">No files yet.</div>
        ) : (
          <TreeList
            nodes={nodes}
            depth={0}
            expanded={expanded}
            onToggle={toggleExpanded}
            onOpenFile={onOpenFile}
            onContext={(node, x, y) => setContextMenu({ x, y, node })}
            inlineEdit={inlineEdit}
            onCommitInline={commitInlineEdit}
            onCancelInline={cancelInlineEdit}
          />
        )}
        {/* Root-level inline edit (when no node yet, or creating at root) */}
        {inlineEdit && inlineEdit.parentPath === '' && inlineEdit.mode !== 'rename' ? (
          <InlineRow
            depth={0}
            kind={inlineEdit.mode === 'create-folder' ? 'dir' : 'file'}
            initialValue={inlineEdit.initialValue}
            onCommit={commitInlineEdit}
            onCancel={cancelInlineEdit}
          />
        ) : null}
      </div>
      {uploadOpen ? (
        <ExplorerUploadModal
          projectId={projectId}
          onClose={() => setUploadOpen(false)}
          onImported={refresh}
        />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onNewFile={() => startCreate('file', contextMenu.node)}
          onNewFolder={() => startCreate('folder', contextMenu.node)}
          onRename={() => contextMenu.node && startRename(contextMenu.node)}
          onDelete={() => contextMenu.node && void handleDelete(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

function parentPathOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

interface TreeListProps {
  nodes: ProjectTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContext: (node: ProjectTreeNode, x: number, y: number) => void;
  inlineEdit: InlineEdit | null;
  onCommitInline: (value: string) => Promise<void> | void;
  onCancelInline: () => void;
}

function TreeList({ nodes, depth, expanded, onToggle, onOpenFile, onContext, inlineEdit, onCommitInline, onCancelInline }: TreeListProps) {
  return (
    <ul className="explorer-tree" role="group">
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={depth}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onContext={onContext}
          inlineEdit={inlineEdit}
          onCommitInline={onCommitInline}
          onCancelInline={onCancelInline}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: ProjectTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContext: (node: ProjectTreeNode, x: number, y: number) => void;
  inlineEdit: InlineEdit | null;
  onCommitInline: (value: string) => Promise<void> | void;
  onCancelInline: () => void;
}

function TreeRow({ node, depth, expanded, onToggle, onOpenFile, onContext, inlineEdit, onCommitInline, onCancelInline }: TreeRowProps) {
  const isDir = node.kind === 'dir';
  const isOpen = isDir && expanded.has(node.path);
  const isBeingRenamed = inlineEdit?.mode === 'rename' && inlineEdit.target === node.path;
  // Edit-in-children: when creating inside this directory
  const childCreate = isDir && inlineEdit && inlineEdit.parentPath === node.path && inlineEdit.mode !== 'rename';
  const handleActivate = () => {
    if (isDir) onToggle(node.path);
    else onOpenFile(node.path);
  };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
    if (isDir && e.key === 'ArrowRight' && !isOpen) { e.preventDefault(); onToggle(node.path); }
    if (isDir && e.key === 'ArrowLeft' && isOpen) { e.preventDefault(); onToggle(node.path); }
  };
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContext(node, e.clientX, e.clientY);
  };
  if (isBeingRenamed && inlineEdit) {
    return (
      <li className="explorer-row" role="treeitem">
        <InlineRow
          depth={depth}
          kind={node.kind}
          initialValue={inlineEdit.initialValue}
          onCommit={onCommitInline}
          onCancel={onCancelInline}
        />
      </li>
    );
  }
  return (
    <li className="explorer-row" role="treeitem" aria-expanded={isDir ? isOpen : undefined}>
      <button
        type="button"
        className={`explorer-row__hit explorer-row__hit--${node.kind}`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={handleActivate}
        onKeyDown={handleKey}
        onContextMenu={handleContextMenu}
        title={node.path}
      >
        <span className="explorer-row__chevron" aria-hidden="true">
          {isDir ? <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} /> : null}
        </span>
        <span className="explorer-row__icon" aria-hidden="true">
          <Icon name={iconForNode(node)} size={14} />
        </span>
        <span className="explorer-row__name">{node.name}</span>
        {isDir && node.children === undefined && node.childCount && node.childCount > 0 ? (
          <span className="explorer-row__hint">({node.childCount})</span>
        ) : null}
      </button>
      {isDir && isOpen && node.children && node.children.length > 0 ? (
        <TreeList
          nodes={node.children}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onContext={onContext}
          inlineEdit={inlineEdit}
          onCommitInline={onCommitInline}
          onCancelInline={onCancelInline}
        />
      ) : null}
      {childCreate && inlineEdit ? (
        <InlineRow
          depth={depth + 1}
          kind={inlineEdit.mode === 'create-folder' ? 'dir' : 'file'}
          initialValue={inlineEdit.initialValue}
          onCommit={onCommitInline}
          onCancel={onCancelInline}
        />
      ) : null}
    </li>
  );
}

interface InlineRowProps {
  depth: number;
  kind: 'file' | 'dir';
  initialValue: string;
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

function InlineRow({ depth, kind, initialValue, onCommit, onCancel }: InlineRowProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    // Select the name body but keep an existing extension intact, so
    // renaming `App.tsx` puts the caret over `App` and Enter rewrites that
    // part only.
    if (initialValue) {
      const dot = initialValue.lastIndexOf('.');
      const end = dot > 0 ? dot : initialValue.length;
      inputRef.current?.setSelectionRange(0, end);
    }
  }, [initialValue]);
  return (
    <div className="explorer-row explorer-row--inline" style={{ paddingLeft: `${depth * 12 + 6}px` }}>
      <span className="explorer-row__chevron" aria-hidden="true" />
      <span className="explorer-row__icon" aria-hidden="true">
        <Icon name={kind === 'dir' ? 'folder' : 'file'} size={14} />
      </span>
      <input
        ref={inputRef}
        className="explorer-row__input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void onCommit(value); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => void onCommit(value)}
        placeholder={kind === 'dir' ? 'folder-name' : 'file-name.ext'}
      />
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  node: ProjectTreeNode | null;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, node, onNewFile, onNewFolder, onRename, onDelete }: ContextMenuProps) {
  // Stop propagation so the menu's own click handlers fire before the
  // global outside-click handler in the parent closes the menu.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <ul
      className="explorer-context-menu"
      role="menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onMouseDown={stop}
      onClick={stop}
    >
      <li><button type="button" role="menuitem" onClick={onNewFile}>New file</button></li>
      <li><button type="button" role="menuitem" onClick={onNewFolder}>New folder</button></li>
      {node ? (
        <>
          <li className="explorer-context-menu__sep" aria-hidden="true" />
          <li><button type="button" role="menuitem" onClick={onRename}>Rename</button></li>
          <li><button type="button" role="menuitem" onClick={onDelete} className="explorer-context-menu__danger">Delete</button></li>
        </>
      ) : null}
    </ul>
  );
}

function iconForNode(node: ProjectTreeNode): 'folder' | 'file' | 'file-code' | 'image' {
  if (node.kind === 'dir') return 'folder';
  const name = node.name.toLowerCase();
  if (name.match(/\.(html?|css|tsx|jsx|ts|js|json|md|markdown|xml|yaml|yml|toml)$/)) return 'file-code';
  if (node.fileKind === 'image') return 'image';
  return 'file';
}
