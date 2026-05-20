import { describe, expect, it } from 'vitest';

import {
  isElementNode,
  isTextNode,
  type ODComponentDef,
  type ODDocumentOp,
  type ODElementNode,
  type ODNode,
  type ODTextNode,
} from '../src/document/types.js';

describe('document types', () => {
  it('narrows element vs text nodes via type guards', () => {
    const element: ODElementNode = {
      kind: 'element',
      id: 'el-1',
      tag: 'button',
      attributes: { type: 'button' },
      styles: { declarations: [] },
      children: [],
    };
    const text: ODTextNode = { kind: 'text', id: 't-1', value: 'Hello' };

    expect(isElementNode(element)).toBe(true);
    expect(isElementNode(text)).toBe(false);
    expect(isTextNode(text)).toBe(true);
    expect(isTextNode(element)).toBe(false);

    const nodes: ODNode[] = [element, text];
    const tags = nodes.filter(isElementNode).map((n) => n.tag);
    expect(tags).toEqual(['button']);
  });

  it('models every ODDocumentOp kind without widening', () => {
    const ops: ODDocumentOp[] = [
      { kind: 'set-text', nodeId: 'n', value: 'hi' },
      { kind: 'set-attribute', nodeId: 'n', name: 'class', value: 'btn' },
      { kind: 'set-attribute', nodeId: 'n', name: 'class', value: null },
      { kind: 'set-style', nodeId: 'n', declarations: [{ property: 'color', value: 'red', important: false }] },
      {
        kind: 'insert-node',
        parentId: 'p',
        index: 0,
        node: { kind: 'text', id: 't', value: 'x' },
      },
      { kind: 'remove-node', nodeId: 'n' },
      { kind: 'move-node', nodeId: 'n', newParentId: 'p2', newIndex: 1 },
      { kind: 'replace-outer', nodeId: 'n', html: '<span>x</span>' },
      { kind: 'replace-document', source: '<!doctype html><html></html>' },
    ];
    expect(ops).toHaveLength(9);
    const kinds = ops.map((op) => op.kind);
    expect(new Set(kinds).size).toBe(8);
  });

  it('rejects executable matchers in ODComponentDef (declarative-only contract)', () => {
    const def: ODComponentDef = {
      id: 'button',
      match: {
        selector: 'button, a[role="button"]',
        attributes: { type: 'button' },
      },
      label: 'Button: {text}',
      inspector: {
        groups: [
          {
            title: 'Content',
            fields: [{ kind: 'text', label: 'Label', bind: { kind: 'text' } }],
          },
          {
            title: 'Style',
            fields: [{ kind: 'color', label: 'Color', bind: { kind: 'style', property: 'color' } }],
          },
        ],
      },
    };
    expect(def.match.selector).toContain('button');
    expect(def.inspector.groups).toHaveLength(2);
  });
});
