/**
 * Bridge between the legacy ManualEditPatch surface (apps/web/src/edit-mode)
 * and the new ODDocumentOp pipeline.
 *
 * Phase 1 strategy: the existing applyManualEditPatch in edit-mode/source-patches.ts
 * stays in place for compatibility, but new call sites should route through
 * `applyManualEditPatchViaStore`, which converts the legacy patch to ODDocumentOps
 * and applies them through a DocumentStore. This gives us a clean path to
 * deprecate the string-mutation helpers once all callers migrate.
 *
 * The function signature mirrors the legacy `applyManualEditPatch` so call sites
 * can swap implementations with zero shape change.
 */

import type { ODDocumentOp, ODStyleDeclaration } from '@open-design/contracts';

import type { ManualEditPatch, ManualEditStyles } from '../edit-mode/types';
import { createDocumentStore } from './store';

export interface ManualEditPatchResult {
  ok: boolean;
  source: string;
  error?: string;
}

export function applyManualEditPatchViaStore(
  source: string,
  patch: ManualEditPatch,
): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') {
    return { ok: true, source: patch.source };
  }
  const store = createDocumentStore(source);
  const ops = manualEditPatchToOps(patch, source);
  if (ops === null) {
    return { ok: false, source, error: `Unsupported patch kind: ${patch.kind}` };
  }
  const result = store.applyOps(ops);
  if (!result.ok) return { ok: false, source, error: result.error };
  return { ok: true, source: store.toSource() };
}

/**
 * Converts a single ManualEditPatch to one or more ODDocumentOps.
 *
 * Returns null for kinds that have no clean op mapping (currently only
 * `set-token`, which mutates `<style>` block contents — its proper home is
 * a later phase that parses `<style>` into AST style-rules).
 *
 * The `source` argument is retained for diagnostic context. Callers that
 * already have a DocumentStore should resolve `patch.id` against the store
 * directly rather than relying on the legacy id-resolution rules.
 */
export function manualEditPatchToOps(patch: ManualEditPatch, _source: string): ODDocumentOp[] | null {
  if (patch.kind === 'set-text') {
    return [{ kind: 'set-text', nodeId: patch.id, value: patch.value }];
  }
  if (patch.kind === 'set-link') {
    return [
      { kind: 'set-text', nodeId: patch.id, value: patch.text },
      { kind: 'set-attribute', nodeId: patch.id, name: 'href', value: patch.href },
    ];
  }
  if (patch.kind === 'set-image') {
    return [
      { kind: 'set-attribute', nodeId: patch.id, name: 'src', value: patch.src },
      { kind: 'set-attribute', nodeId: patch.id, name: 'alt', value: patch.alt },
    ];
  }
  if (patch.kind === 'set-attributes') {
    const ops: ODDocumentOp[] = [];
    for (const [name, value] of Object.entries(patch.attributes)) {
      if (name === 'data-od-id' || name === 'data-od-edit' || name === 'data-od-label') continue;
      if (value === '') {
        ops.push({ kind: 'set-attribute', nodeId: patch.id, name, value: null });
      } else {
        ops.push({ kind: 'set-attribute', nodeId: patch.id, name, value });
      }
    }
    return ops;
  }
  if (patch.kind === 'set-style') {
    const declarations: ODStyleDeclaration[] = [];
    for (const [key, raw] of Object.entries(patch.styles) as Array<[keyof ManualEditStyles, string | undefined]>) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) continue;
      declarations.push({
        property: camelToKebab(String(key)),
        value,
        important: false,
      });
    }
    return [{ kind: 'set-style', nodeId: patch.id, declarations }];
  }
  if (patch.kind === 'set-outer-html') {
    return [{ kind: 'replace-outer', nodeId: patch.id, html: patch.html }];
  }
  // set-token mutates raw <style> contents; out of scope for the inline-style
  // model in v1. Falls back to caller (legacy applyManualEditPatch handles it).
  return null;
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
