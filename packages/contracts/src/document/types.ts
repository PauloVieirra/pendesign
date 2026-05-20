/**
 * Document model for the hybrid visual editor.
 *
 * See specs/current/hybrid-visual-editor.md for the architectural rationale.
 *
 * These are pure TypeScript types — no Node, browser, or framework APIs.
 * The parser, serializer, and DocumentStore live in apps/web/src/document/.
 * The daemon's op-application endpoint lives in apps/daemon/src/document/.
 */

export interface ODSourceLocation {
  /** Byte offset in the current serialized form of the document (inclusive). */
  start: number;
  /** Byte offset in the current serialized form of the document (exclusive). */
  end: number;
  /** 1-based line number in the current serialized form. */
  line: number;
  /** 0-based column in the current serialized form. */
  column: number;
}

export interface ODStyleDeclaration {
  property: string;
  value: string;
  important: boolean;
  source?: ODSourceLocation;
}

export interface ODInlineStyles {
  /** Ordered to preserve shorthand precedence (`padding: 10px` before `padding-top: 0`). */
  declarations: ODStyleDeclaration[];
}

export type ODNode = ODElementNode | ODTextNode | ODCommentNode | ODDoctypeNode;

export interface ODElementNode {
  kind: 'element';
  /** Stable id; survives serialize/parse. Either from `data-od-id` or content-addressed hash. */
  id: string;
  /** Lowercase tag name. */
  tag: string;
  attributes: Record<string, string>;
  styles: ODInlineStyles;
  children: ODNode[];
  source?: ODSourceLocation;
  /** Resolved component definition id (`'button'`, `'hero'`, ...). Recomputed on parse. */
  componentRef?: string;
}

export interface ODTextNode {
  kind: 'text';
  id: string;
  value: string;
  source?: ODSourceLocation;
}

export interface ODCommentNode {
  kind: 'comment';
  id: string;
  value: string;
  source?: ODSourceLocation;
}

export interface ODDoctypeNode {
  kind: 'doctype';
  id: string;
  /** Raw doctype declaration content, e.g. `'html'`. */
  value: string;
  source?: ODSourceLocation;
}

export function isElementNode(node: ODNode): node is ODElementNode {
  return node.kind === 'element';
}

export function isTextNode(node: ODNode): node is ODTextNode {
  return node.kind === 'text';
}

/**
 * The single shared vocabulary across visual, code, and prompt modes.
 *
 * Visual interactions, typed code edits, and agent responses all emit ops.
 * The DocumentStore applies them; the daemon applies them on the persistence side.
 *
 * `replace-document` is the escape hatch / compatibility path for agents that
 * regenerate whole files instead of emitting structured ops.
 */
export type ODDocumentOp =
  | { kind: 'set-text'; nodeId: string; value: string }
  | { kind: 'set-attribute'; nodeId: string; name: string; value: string | null }
  | { kind: 'set-style'; nodeId: string; declarations: ODStyleDeclaration[] }
  | { kind: 'insert-node'; parentId: string; index: number; node: ODNode }
  | { kind: 'remove-node'; nodeId: string }
  | { kind: 'move-node'; nodeId: string; newParentId: string; newIndex: number }
  | { kind: 'replace-outer'; nodeId: string; html: string }
  | { kind: 'replace-document'; source: string };

/** Op coalescing batches one or more ops produced in the same frame. */
export interface ODDocumentOpBatch {
  /** Monotonic batch sequence number assigned by the DocumentStore. */
  seq: number;
  /** Frame timestamp (rAF time origin); persistence does not depend on it. */
  frameTime: number;
  ops: ODDocumentOp[];
}

/**
 * Declarative component matcher. Plugins and built-in defs use the same shape.
 * No executable functions — keeps inspector resolution serializable and removes
 * the need for a plugin sandbox.
 */
export interface ODComponentMatch {
  /** CSS selector evaluated against the element's tag/class/attributes. */
  selector: string;
  /** Structural requirements (e.g. has a child matching a selector). */
  requires?: ODChildPredicate[];
  /** Attribute predicates layered on top of the selector. */
  attributes?: Record<string, string>;
}

export interface ODChildPredicate {
  selector: string;
  /** Minimum number of children that must match. Defaults to 1. */
  min?: number;
}

/**
 * Template string used to label a matched node in the layer list and inspector header.
 *
 * Supported substitutions:
 *  - `{tag}`           — element tag name
 *  - `{text}`          — first 32 chars of element's text content
 *  - `{attr:NAME}`     — value of attribute NAME (empty string if missing)
 */
export type ODLabelExpression = string;

export type ODNodeBinding = { kind: 'text' } | { kind: 'attribute'; name: string };
export type ODAttributeBinding = { kind: 'attribute'; name: string };
export type ODStyleBinding = { kind: 'style'; property: string };

export interface ODInspectorGroup {
  title: string;
  fields: ODInspectorField[];
}

export type ODInspectorField =
  | { kind: 'text'; label: string; bind: ODNodeBinding }
  | { kind: 'color'; label: string; bind: ODStyleBinding }
  | { kind: 'select'; label: string; bind: ODAttributeBinding; options: string[] }
  | { kind: 'slider'; label: string; bind: ODStyleBinding; min: number; max: number; unit: string }
  | { kind: 'toggle'; label: string; bind: ODAttributeBinding; on: string; off: string }
  | { kind: 'number'; label: string; bind: ODStyleBinding; unit?: string };

export interface ODComponentInspector {
  groups: ODInspectorGroup[];
}

/**
 * Static node template used by `produce` for insert-from-palette flows.
 * Trees are constructed without executable factories; ids are assigned at
 * insertion time by the DocumentStore.
 */
export interface ODNodeTemplate {
  tag: string;
  attributes?: Record<string, string>;
  styles?: Record<string, string>;
  children?: Array<ODNodeTemplate | string>;
}

export interface ODComponentDef {
  /** Stable definition id (`'button'`, `'hero'`). Used as `ODElementNode.componentRef`. */
  id: string;
  /** Declarative matcher — no executable functions. */
  match: ODComponentMatch;
  /** Template-string label expression. See ODLabelExpression. */
  label: ODLabelExpression;
  inspector: ODComponentInspector;
  /** Optional static template for insert-from-palette flows. */
  produce?: ODNodeTemplate;
}
