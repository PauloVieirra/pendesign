import { describe, expect, it } from 'vitest';
import { isElementNode, type ODElementNode } from '@open-design/contracts';

import { parseDocument, parseInlineStyles } from '../../src/document/parse';
import { serialize } from '../../src/document/serialize';

function roundTrip(source: string): string {
  const { nodes } = parseDocument(source);
  return serialize(nodes, { source });
}

describe('HTML parser + serializer round-trip', () => {
  it('round-trips a simple element', () => {
    const src = '<div>hello</div>';
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips a doctype', () => {
    const src = '<!doctype html><html><body></body></html>';
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips comments', () => {
    const src = '<div><!-- a comment --><span>x</span></div>';
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips void elements', () => {
    const src = '<p>line 1<br>line 2<img src="x.png" alt=""></p>';
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips raw text containers (script/style/textarea)', () => {
    const src = `<style>:root { --x: 1; }</style><script>const a = 1 < 2;</script>`;
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips attribute quoting and whitespace', () => {
    const src = `<div   class="a b"   data-x='y'  id=plain>content</div>`;
    expect(roundTrip(src)).toBe(src);
  });

  it('round-trips a multi-line document with mixed content', () => {
    const src = `<!doctype html>
<html>
  <head>
    <title>Sample</title>
    <style>.x { color: red; }</style>
  </head>
  <body>
    <main>
      <h1 data-od-id="t">Hello</h1>
      <p>World <strong>bold</strong>.</p>
      <img src="/a.png" alt="A">
    </main>
  </body>
</html>`;
    expect(roundTrip(src)).toBe(src);
  });

  it('survives whitespace-only text between elements', () => {
    const src = '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>';
    expect(roundTrip(src)).toBe(src);
  });
});

describe('HTML parser AST shape', () => {
  it('honors explicit data-od-id over derived ids', () => {
    const { nodes } = parseDocument('<div data-od-id="custom">x</div>');
    const root = nodes[0] as ODElementNode;
    expect(root.id).toBe('custom');
  });

  it('derives stable ids when data-od-id is absent', () => {
    const a = parseDocument('<div><span>x</span></div>');
    const b = parseDocument('<div><span>x</span></div>');
    const aRoot = a.nodes[0] as ODElementNode;
    const bRoot = b.nodes[0] as ODElementNode;
    expect(aRoot.id).toBe(bRoot.id);
    expect(aRoot.id).toMatch(/^od-/);
  });

  it('parses inline styles into structured declarations', () => {
    const { nodes } = parseDocument('<div style="color: red; padding: 8px; opacity: 0.5 !important">x</div>');
    const root = nodes[0] as ODElementNode;
    expect(root.styles.declarations).toEqual([
      { property: 'color', value: 'red', important: false },
      { property: 'padding', value: '8px', important: false },
      { property: 'opacity', value: '0.5', important: true },
    ]);
  });

  it('treats <style> content as a single opaque text node', () => {
    const { nodes } = parseDocument('<style>.x{color:red} .y{color:blue}</style>');
    const style = nodes[0] as ODElementNode;
    expect(style.tag).toBe('style');
    expect(style.children).toHaveLength(1);
    expect(style.children[0]).toMatchObject({ kind: 'text', value: '.x{color:red} .y{color:blue}' });
  });

  it('lowercases tag names but preserves attribute name case in source slice', () => {
    const src = '<DIV class="X">A</DIV>';
    const { nodes } = parseDocument(src);
    const root = nodes[0] as ODElementNode;
    expect(root.tag).toBe('div');
    expect(roundTrip(src)).toBe(src);
  });

  it('emits source locations for every node', () => {
    const { nodes } = parseDocument('<p>hi</p>');
    const p = nodes[0] as ODElementNode;
    expect(p.source).toEqual({ start: 0, end: 9, line: 1, column: 0 });
    const text = p.children[0];
    expect(text?.source).toEqual({ start: 3, end: 5, line: 1, column: 3 });
  });
});

describe('parseInlineStyles', () => {
  it('parses an empty string to no declarations', () => {
    expect(parseInlineStyles('')).toEqual({ declarations: [] });
  });

  it('skips entries without a value', () => {
    expect(parseInlineStyles('color: ; padding: 8px').declarations).toEqual([
      { property: 'color', value: '', important: false },
      { property: 'padding', value: '8px', important: false },
    ]);
  });

  it('handles trailing semicolons and whitespace', () => {
    expect(parseInlineStyles('  color:  red ;  ').declarations).toEqual([
      { property: 'color', value: 'red', important: false },
    ]);
  });
});

describe('serialize after mutation', () => {
  it('regenerates a node whose source location was cleared', () => {
    const src = '<div class="a">x</div>';
    const { nodes } = parseDocument(src);
    const root = nodes[0] as ODElementNode;
    const mutated: ODElementNode = {
      ...root,
      source: undefined,
      attributes: { ...root.attributes, class: 'b' },
    };
    expect(serialize([mutated], { source: src })).toBe('<div class="b">x</div>');
  });

  it('reserializes structured styles when set', () => {
    const src = '<p style="color: red">x</p>';
    const { nodes } = parseDocument(src);
    const root = nodes[0] as ODElementNode;
    const mutated: ODElementNode = {
      ...root,
      source: undefined,
      styles: {
        declarations: [
          { property: 'color', value: 'blue', important: false },
          { property: 'font-weight', value: 'bold', important: true },
        ],
      },
    };
    const out = serialize([mutated]);
    expect(out).toBe('<p style="color: blue; font-weight: bold !important">x</p>');
  });

  it('preserves untouched siblings while regenerating a mutated one', () => {
    const src = '<section><a href="/old">link</a><span>keep me</span></section>';
    const { nodes } = parseDocument(src);
    const section = nodes[0] as ODElementNode;
    expect(isElementNode(section)).toBe(true);
    const anchor = section.children[0] as ODElementNode;
    const span = section.children[1] as ODElementNode;
    const newAnchor: ODElementNode = {
      ...anchor,
      source: undefined,
      attributes: { ...anchor.attributes, href: '/new' },
    };
    const newSection: ODElementNode = {
      ...section,
      source: undefined,
      children: [newAnchor, span],
    };
    const out = serialize([newSection], { source: src });
    expect(out).toBe('<section><a href="/new">link</a><span>keep me</span></section>');
  });
});
