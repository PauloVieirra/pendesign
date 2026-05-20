/**
 * DocumentStore — authoritative AST for the active artifact.
 *
 * Owns:
 *  - The current ODNode tree
 *  - The original source (for byte-preserving serialization of untouched subtrees)
 *  - An id→{node, parent, index} index for O(1) lookups
 *  - A version counter and subscriber list
 *
 * Op application clears the `source` field on any mutated node, so the
 * serializer regenerates only those subtrees and slices the rest from the
 * original source.
 *
 * Frame coalescing (rAF) is added by the host that owns the store —
 * the store itself applies ops eagerly. Batching is exposed via `applyOps`.
 */

import type {
  ODDocumentOp,
  ODElementNode,
  ODNode,
  ODTextNode,
} from '@open-design/contracts';

import { parseDocument, parseInlineStyles } from './parse';
import { serialize } from './serialize';

export interface DocumentStoreSnapshot {
  readonly version: number;
  readonly nodes: readonly ODNode[];
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
}

export interface DocumentStore {
  /** Current global op version. Increments once per `applyOp`/`applyOps` call that mutated state. */
  getVersion(): number;
  /** Returns the root node list (read-only — do not mutate). */
  getNodes(): readonly ODNode[];
  /** Returns the node with the given id, or null. */
  getNode(id: string): ODNode | null;
  /** Returns the parent of the node with the given id, or null for roots. */
  getParent(id: string): ODElementNode | null;
  /** Returns the current serialized source (byte-preserving for untouched subtrees). */
  toSource(): string;
  /** Applies one op. Returns ok/error. */
  applyOp(op: ODDocumentOp): ApplyResult;
  /** Applies an ordered batch atomically — failures roll back the whole batch. */
  applyOps(ops: readonly ODDocumentOp[]): ApplyResult;
  /** Subscribes to any state change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

interface IndexEntry {
  node: ODNode;
  parent: ODElementNode | null;
  index: number;
}

export function createDocumentStore(source: string): DocumentStore {
  const parsed = parseDocument(source);
  let nodes: ODNode[] = [...parsed.nodes];
  let originalSource: string = source;
  let version = 0;
  const listeners = new Set<() => void>();
  let index = new Map<string, IndexEntry>();
  rebuildIndex();

  function rebuildIndex(): void {
    index = new Map<string, IndexEntry>();
    indexLevel(nodes, null);
  }

  function indexLevel(level: ODNode[], parent: ODElementNode | null): void {
    level.forEach((node, i) => {
      index.set(node.id, { node, parent, index: i });
      if (node.kind === 'element') indexLevel(node.children, node);
    });
  }

  function emit(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function apply(op: ODDocumentOp): ApplyResult {
    if (op.kind === 'replace-document') {
      const reparsed = parseDocument(op.source);
      nodes = [...reparsed.nodes];
      originalSource = op.source;
      rebuildIndex();
      return { ok: true };
    }
    if (op.kind === 'set-text') return applySetText(op.nodeId, op.value);
    if (op.kind === 'set-attribute') return applySetAttribute(op.nodeId, op.name, op.value);
    if (op.kind === 'set-style') return applySetStyle(op.nodeId, op.declarations);
    if (op.kind === 'insert-node') return applyInsertNode(op.parentId, op.index, op.node);
    if (op.kind === 'remove-node') return applyRemoveNode(op.nodeId);
    if (op.kind === 'move-node') return applyMoveNode(op.nodeId, op.newParentId, op.newIndex);
    if (op.kind === 'replace-outer') return applyReplaceOuter(op.nodeId, op.html);
    return { ok: false, error: `Unknown op kind` };
  }

  function applySetText(nodeId: string, value: string): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry) return { ok: false, error: `Node not found: ${nodeId}` };
    if (entry.node.kind === 'text') {
      const updated: ODTextNode = { ...entry.node, value, source: undefined };
      replaceInParent(entry, updated);
      return { ok: true };
    }
    if (entry.node.kind === 'element') {
      const target = entry.node;
      const firstChildIsText = target.children.length === 1 && target.children[0]?.kind === 'text';
      const newText: ODTextNode = firstChildIsText && target.children[0]
        ? { ...(target.children[0] as ODTextNode), value, source: undefined }
        : { kind: 'text', id: `${nodeId}::text`, value };
      if (target.children.length > 1) {
        return { ok: false, error: 'Element has nested markup; use replace-outer instead' };
      }
      const updated: ODElementNode = { ...target, source: undefined, children: [newText] };
      replaceInParent(entry, updated);
      return { ok: true };
    }
    return { ok: false, error: 'Unsupported node kind for set-text' };
  }

  function applySetAttribute(nodeId: string, name: string, value: string | null): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry || entry.node.kind !== 'element') {
      return { ok: false, error: `Element not found: ${nodeId}` };
    }
    const nextAttrs = { ...entry.node.attributes };
    if (value === null) delete nextAttrs[name];
    else nextAttrs[name] = value;
    const nextStyles = name === 'style'
      ? parseInlineStyles(value ?? '')
      : entry.node.styles;
    const updated: ODElementNode = {
      ...entry.node,
      source: undefined,
      attributes: nextAttrs,
      styles: nextStyles,
    };
    replaceInParent(entry, updated);
    return { ok: true };
  }

  function applySetStyle(
    nodeId: string,
    declarations: ODElementNode['styles']['declarations'],
  ): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry || entry.node.kind !== 'element') {
      return { ok: false, error: `Element not found: ${nodeId}` };
    }
    const updated: ODElementNode = {
      ...entry.node,
      source: undefined,
      styles: { declarations: [...declarations] },
    };
    replaceInParent(entry, updated);
    return { ok: true };
  }

  function applyInsertNode(parentId: string, at: number, child: ODNode): ApplyResult {
    const parentEntry = index.get(parentId);
    if (!parentEntry || parentEntry.node.kind !== 'element') {
      return { ok: false, error: `Parent not found: ${parentId}` };
    }
    const insertion = clearForeignSource(ensureUniqueId(child));
    const nextChildren = [...parentEntry.node.children];
    const clamped = Math.max(0, Math.min(at, nextChildren.length));
    nextChildren.splice(clamped, 0, insertion);
    const updated: ODElementNode = {
      ...parentEntry.node,
      source: undefined,
      children: nextChildren,
    };
    replaceInParent(parentEntry, updated);
    return { ok: true };
  }

  function applyRemoveNode(nodeId: string): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry) return { ok: false, error: `Node not found: ${nodeId}` };
    if (entry.parent === null) {
      nodes = nodes.filter((n) => n.id !== nodeId);
      return { ok: true };
    }
    const nextChildren = entry.parent.children.filter((c) => c.id !== nodeId);
    const updatedParent: ODElementNode = {
      ...entry.parent,
      source: undefined,
      children: nextChildren,
    };
    const parentEntry = index.get(entry.parent.id);
    if (parentEntry) replaceInParent(parentEntry, updatedParent);
    return { ok: true };
  }

  function applyMoveNode(nodeId: string, newParentId: string, newIndex: number): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry) return { ok: false, error: `Node not found: ${nodeId}` };
    const movedNode = entry.node;
    const removeResult = applyRemoveNode(nodeId);
    if (!removeResult.ok) return removeResult;
    return applyInsertNode(newParentId, newIndex, movedNode);
  }

  function applyReplaceOuter(nodeId: string, html: string): ApplyResult {
    const entry = index.get(nodeId);
    if (!entry) return { ok: false, error: `Node not found: ${nodeId}` };
    let parsed;
    try {
      parsed = parseDocument(html);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    if (parsed.nodes.length !== 1) {
      return { ok: false, error: 'Replacement HTML must produce exactly one root node' };
    }
    const replacement = clearForeignSource(parsed.nodes[0]!);
    const next = preserveProtectedAttrs(entry.node, replacement);
    if (entry.parent === null) {
      nodes = nodes.map((n) => (n.id === nodeId ? next : n));
    } else {
      const nextChildren = entry.parent.children.map((c) => (c.id === nodeId ? next : c));
      const updatedParent: ODElementNode = {
        ...entry.parent,
        source: undefined,
        children: nextChildren,
      };
      const parentEntry = index.get(entry.parent.id);
      if (parentEntry) replaceInParent(parentEntry, updatedParent);
    }
    return { ok: true };
  }

  function replaceInParent(entry: IndexEntry, next: ODNode): void {
    if (entry.parent === null) {
      nodes = nodes.map((n) => (n.id === entry.node.id ? next : n));
    } else {
      const nextChildren = entry.parent.children.map((c) => (c.id === entry.node.id ? next : c));
      const updatedParent: ODElementNode = {
        ...entry.parent,
        source: undefined,
        children: nextChildren,
      };
      const parentEntry = index.get(entry.parent.id);
      if (parentEntry) replaceInParent(parentEntry, updatedParent);
    }
  }

  function preserveProtectedAttrs(prev: ODNode, next: ODNode): ODNode {
    if (prev.kind !== 'element' || next.kind !== 'element') return next;
    const carryOver: Array<keyof ODElementNode['attributes'] | string> = [
      'data-od-id',
      'data-od-edit',
      'data-od-label',
    ];
    const attrs = { ...next.attributes };
    for (const key of carryOver) {
      if (!attrs[key] && prev.attributes[key]) attrs[key] = prev.attributes[key];
    }
    return { ...next, attributes: attrs };
  }

  function ensureUniqueId(node: ODNode): ODNode {
    if (!index.has(node.id)) return node;
    const newId = `${node.id}-${Math.random().toString(36).slice(2, 8)}`;
    if (node.kind === 'element') return { ...node, id: newId };
    return { ...node, id: newId };
  }

  /**
   * Strips `source` locations from a subtree. Required when inserting nodes
   * parsed from a different source string — their locations are invalid for
   * this document's `originalSource` and must be regenerated by the serializer.
   */
  function clearForeignSource(node: ODNode): ODNode {
    if (node.kind === 'element') {
      return {
        ...node,
        source: undefined,
        children: node.children.map((c) => clearForeignSource(c)),
      };
    }
    return { ...node, source: undefined };
  }

  return {
    getVersion: () => version,
    getNodes: () => nodes,
    getNode: (id) => index.get(id)?.node ?? null,
    getParent: (id) => index.get(id)?.parent ?? null,
    toSource: () => serialize(nodes, { source: originalSource }),
    applyOp(op) {
      const result = apply(op);
      if (result.ok) {
        rebuildIndex();
        emit();
      }
      return result;
    },
    applyOps(ops) {
      const beforeNodes = nodes;
      const beforeSource = originalSource;
      for (const op of ops) {
        const result = apply(op);
        if (!result.ok) {
          nodes = beforeNodes;
          originalSource = beforeSource;
          rebuildIndex();
          return result;
        }
        rebuildIndex();
      }
      if (ops.length > 0) emit();
      return { ok: true };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
