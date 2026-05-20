/**
 * ODNode → HTML serializer.
 *
 * Strategy: hybrid byte-preserving + tree-regenerating.
 *  - Nodes that still carry their original `source` location AND were not
 *    mutated by an op are emitted by slicing the original source string —
 *    this gives byte-for-byte round-trip for untouched subtrees.
 *  - Nodes whose `source` field was cleared (the DocumentStore clears it
 *    when applying an op) are regenerated from the AST.
 *
 * Invariant: `serialize(parseDocument(s).nodes, s) === s` for any well-formed
 * input `s` the parser accepts.
 */

import type {
  ODElementNode,
  ODInlineStyles,
  ODNode,
  ODStyleDeclaration,
} from '@open-design/contracts';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea']);

export interface SerializeOptions {
  /** Original source string for byte-preserving slices of untouched nodes. */
  source?: string;
}

export function serialize(nodes: ODNode[], options: SerializeOptions = {}): string {
  return nodes.map((node) => serializeNode(node, options)).join('');
}

export function serializeNode(node: ODNode, options: SerializeOptions = {}): string {
  if (options.source !== undefined && node.source !== undefined) {
    return options.source.slice(node.source.start, node.source.end);
  }
  return rebuildNode(node);
}

function rebuildNode(node: ODNode): string {
  switch (node.kind) {
    case 'doctype':
      return `<!DOCTYPE ${node.value}>`;
    case 'comment':
      return `<!--${node.value}-->`;
    case 'text':
      return node.value;
    case 'element':
      return rebuildElement(node);
  }
}

function rebuildElement(node: ODElementNode): string {
  const attrs = rebuildAttributes(node);
  const open = `<${node.tag}${attrs}>`;
  if (VOID_ELEMENTS.has(node.tag)) return open;
  if (RAW_TEXT_ELEMENTS.has(node.tag)) {
    const raw = node.children
      .map((c) => (c.kind === 'text' ? c.value : ''))
      .join('');
    return `${open}${raw}</${node.tag}>`;
  }
  const inner = node.children.map((c) => rebuildNode(c)).join('');
  return `${open}${inner}</${node.tag}>`;
}

function rebuildAttributes(node: ODElementNode): string {
  const out: string[] = [];
  const styleSerialized = node.styles.declarations.length > 0
    ? serializeInlineStyles(node.styles)
    : null;
  let styleHandled = false;
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'style') {
      // The structured `node.styles` is the source of truth for inline styles.
      // The `attributes.style` string is kept for parity but only used when
      // the structured styles are empty.
      if (styleSerialized !== null) {
        out.push(`style="${escapeAttribute(styleSerialized)}"`);
        styleHandled = true;
        continue;
      }
      if (value.length > 0) {
        out.push(`style="${escapeAttribute(value)}"`);
        styleHandled = true;
      }
      continue;
    }
    if (value === '') {
      out.push(name);
      continue;
    }
    out.push(`${name}="${escapeAttribute(value)}"`);
  }
  if (!styleHandled && styleSerialized !== null) {
    out.push(`style="${escapeAttribute(styleSerialized)}"`);
  }
  return out.length === 0 ? '' : ` ${out.join(' ')}`;
}

export function serializeInlineStyles(styles: ODInlineStyles): string {
  return styles.declarations
    .map((d) => declarationToString(d))
    .filter((s) => s.length > 0)
    .join('; ');
}

function declarationToString(d: ODStyleDeclaration): string {
  if (!d.property || !d.value) return '';
  return `${d.property}: ${d.value}${d.important ? ' !important' : ''}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
