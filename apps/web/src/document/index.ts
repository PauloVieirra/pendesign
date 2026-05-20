/**
 * apps/web/src/document — DocumentStore and supporting parser/serializer
 * for the hybrid visual editor. See specs/current/hybrid-visual-editor.md.
 *
 * Phase 1 surface:
 *  - parseDocument / parseInlineStyles
 *  - serialize / serializeInlineStyles
 *  - createDocumentStore
 *  - manualEditPatchToOps / applyManualEditPatchViaStore (legacy bridge)
 */

export { HTMLParseError, parseDocument, parseInlineStyles, type ParseResult } from './parse';
export { serialize, serializeNode, serializeInlineStyles, type SerializeOptions } from './serialize';
export {
  createDocumentStore,
  type ApplyResult,
  type DocumentStore,
  type DocumentStoreSnapshot,
} from './store';
export {
  applyManualEditPatchViaStore,
  manualEditPatchToOps,
  type ManualEditPatchResult,
} from './legacy-adapter';
