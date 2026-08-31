import { useState, useMemo, useCallback } from 'react';
import { FixedSizeTree } from 'react-vtree';
import { ChevronRight, Folder, File } from 'lucide-react';
import type { FixedSizeNodeData, TreeWalkerValue, TreeWalker } from 'react-vtree';
import type { TSandboxFile } from 'librechat-data-provider';
import { cn } from '~/utils';

/**
 * Virtualized, collapsible file tree for the sandbox file-tree side panel — adapted from
 * `client/src/components/Skills/lists/SkillListItem.tsx`'s `InlineFileTree`, which already
 * solved the same "flat list of relative paths -> collapsible tree" problem for skill
 * files. Folder nodes are inferred purely from path segments (the backend only lists
 * files, not directories), same as the skills version.
 */

interface TreeEntry {
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  children?: TreeEntry[];
}

interface FileNodeData extends FixedSizeNodeData {
  name: string;
  nodeType: 'file' | 'folder';
  path: string;
  size?: number;
  depth: number;
}

interface NodeMeta {
  entry: TreeEntry;
  depth: number;
}

interface TreeItemCallbacks {
  onFileClick: (path: string) => void;
  onToggle: (id: string, isOpen: boolean) => void;
}

const ITEM_SIZE = 28;
const MAX_HEIGHT = 480;

function buildFileTree(files: TSandboxFile[]): TreeEntry[] {
  const root: TreeEntry[] = [];
  const folderMap = new Map<string, TreeEntry>();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    if (segments.length === 1) {
      root.push({ name: segments[0], type: 'file', path: file.path, size: file.size });
    } else {
      let parentList = root;
      let parentPath = '';
      for (let i = 0; i < segments.length - 1; i++) {
        const folderName = segments[i];
        const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
        let folder = folderMap.get(folderPath);
        if (!folder) {
          folder = { name: folderName, type: 'folder', path: folderPath, children: [] };
          folderMap.set(folderPath, folder);
          parentList.push(folder);
        }
        parentList = folder.children!;
        parentPath = folderPath;
      }
      parentList.push({
        name: segments[segments.length - 1],
        type: 'file',
        path: file.path,
        size: file.size,
      });
    }
  }

  return root;
}

function countVisible(entries: TreeEntry[], openIds: Set<string>): number {
  let n = 0;
  for (const entry of entries) {
    n++;
    if (entry.type === 'folder' && openIds.has(entry.path) && entry.children) {
      n += countVisible(entry.children, openIds);
    }
  }
  return n;
}

function getNodeData(entry: TreeEntry, depth: number): TreeWalkerValue<FileNodeData, NodeMeta> {
  return {
    data: {
      id: entry.path,
      isOpenByDefault: false,
      name: entry.name,
      nodeType: entry.type,
      path: entry.path,
      size: entry.size,
      depth,
    },
    entry,
    depth,
  };
}

function formatSize(size?: number): string {
  if (size == null) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeNode({
  data,
  isOpen,
  setOpen,
  style,
  treeData,
}: {
  style?: React.CSSProperties;
  data: FileNodeData;
  isOpen: boolean;
  setOpen: (state: boolean) => Promise<void>;
  treeData?: TreeItemCallbacks;
}) {
  const isFolder = data.nodeType === 'folder';
  const indent = data.depth * 16 + (isFolder ? 8 : 24);

  return (
    <button
      type="button"
      style={{ ...style, paddingLeft: `${indent}px` }}
      onClick={(e) => {
        e.stopPropagation();
        if (isFolder) {
          const next = !isOpen;
          setOpen(next);
          treeData?.onToggle(data.id, next);
        } else {
          treeData?.onFileClick(data.path);
        }
      }}
      className={cn(
        'flex w-full select-none items-center gap-1.5 rounded-lg pr-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary',
      )}
      aria-expanded={isFolder ? isOpen : undefined}
    >
      {isFolder ? (
        <>
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              isOpen && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
        </>
      ) : (
        <File className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{data.name}</span>
      {!isFolder && (
        <span className="shrink-0 text-xs text-text-tertiary">{formatSize(data.size)}</span>
      )}
    </button>
  );
}

export default function FileTree({
  files,
  onFileClick,
}: {
  files: TSandboxFile[];
  onFileClick: (path: string) => void;
}) {
  const treeEntries = useMemo(() => buildFileTree(files), [files]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const visibleCount = useMemo(() => countVisible(treeEntries, openIds), [treeEntries, openIds]);
  const height = Math.min(visibleCount * ITEM_SIZE, MAX_HEIGHT);

  const handleToggle = useCallback((id: string, isOpen: boolean) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const callbacks = useMemo<TreeItemCallbacks>(
    () => ({ onFileClick, onToggle: handleToggle }),
    [onFileClick, handleToggle],
  );

  type WalkerReturn = ReturnType<TreeWalker<FileNodeData, NodeMeta>>;

  const treeWalker = useMemo<TreeWalker<FileNodeData, NodeMeta>>(() => {
    const walker: TreeWalker<FileNodeData, NodeMeta> = function* (): WalkerReturn {
      for (const entry of treeEntries) {
        yield getNodeData(entry, 0);
      }
      while (true) {
        const parent: TreeWalkerValue<FileNodeData, NodeMeta> = yield;
        for (const child of parent.entry.children ?? []) {
          yield getNodeData(child, parent.depth + 1);
        }
      }
    };
    return walker;
  }, [treeEntries]);

  if (treeEntries.length === 0) {
    return null;
  }

  return (
    <FixedSizeTree<FileNodeData>
      treeWalker={treeWalker}
      itemSize={ITEM_SIZE}
      height={height}
      width="100%"
      itemData={callbacks}
    >
      {FileTreeNode}
    </FixedSizeTree>
  );
}
