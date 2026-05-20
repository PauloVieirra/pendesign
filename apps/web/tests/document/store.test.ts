import { describe, expect, it } from 'vitest';
import { isElementNode, type ODElementNode } from '@open-design/contracts';

import { createDocumentStore } from '../../src/document/store';

describe('DocumentStore', () => {
  it('round-trips an unmodified document', () => {
    const src = '<!doctype html><html><body><h1 data-od-id="t">Hi</h1></body></html>';
    const store = createDocumentStore(src);
    expect(store.toSource()).toBe(src);
    expect(store.getVersion()).toBe(0);
  });

  it('applies set-text and re-serializes only the mutated subtree', () => {
    const src = '<section><h1 data-od-id="t">Hi</h1><p>keep</p></section>';
    const store = createDocumentStore(src);
    const result = store.applyOp({ kind: 'set-text', nodeId: 't', value: 'Hello' });
    expect(result.ok).toBe(true);
    expect(store.toSource()).toContain('<h1 data-od-id="t">Hello</h1>');
    expect(store.toSource()).toContain('<p>keep</p>');
    expect(store.getVersion()).toBe(1);
  });

  it('applies set-attribute and reflects in serialized source', () => {
    const src = '<a data-od-id="cta" href="/old">go</a>';
    const store = createDocumentStore(src);
    const result = store.applyOp({ kind: 'set-attribute', nodeId: 'cta', name: 'href', value: '/new' });
    expect(result.ok).toBe(true);
    expect(store.toSource()).toContain('href="/new"');
  });

  it('removes an attribute when value is null', () => {
    const src = '<a data-od-id="cta" href="/x" rel="noopener">go</a>';
    const store = createDocumentStore(src);
    store.applyOp({ kind: 'set-attribute', nodeId: 'cta', name: 'rel', value: null });
    expect(store.toSource()).not.toContain('rel=');
    expect(store.toSource()).toContain('href="/x"');
  });

  it('parses inline styles when set-attribute writes style="..."', () => {
    const src = '<p data-od-id="p">x</p>';
    const store = createDocumentStore(src);
    store.applyOp({
      kind: 'set-attribute',
      nodeId: 'p',
      name: 'style',
      value: 'color: red; padding: 8px',
    });
    const node = store.getNode('p') as ODElementNode;
    expect(node.styles.declarations).toEqual([
      { property: 'color', value: 'red', important: false },
      { property: 'padding', value: '8px', important: false },
    ]);
  });

  it('applies set-style replacing the entire declarations list', () => {
    const src = '<p data-od-id="p" style="color: red">x</p>';
    const store = createDocumentStore(src);
    store.applyOp({
      kind: 'set-style',
      nodeId: 'p',
      declarations: [
        { property: 'color', value: 'blue', important: false },
        { property: 'font-weight', value: 'bold', important: false },
      ],
    });
    expect(store.toSource()).toContain('color: blue; font-weight: bold');
  });

  it('applies insert-node into a parent', () => {
    const src = '<ul data-od-id="list"><li>a</li></ul>';
    const store = createDocumentStore(src);
    store.applyOp({
      kind: 'insert-node',
      parentId: 'list',
      index: 1,
      node: {
        kind: 'element',
        id: 'new-li',
        tag: 'li',
        attributes: {},
        styles: { declarations: [] },
        children: [{ kind: 'text', id: 'new-text', value: 'b' }],
      },
    });
    expect(store.toSource()).toContain('<li>a</li><li>b</li>');
    expect(store.getNode('new-li')).not.toBeNull();
  });

  it('applies remove-node and updates the index', () => {
    const src = '<ul><li data-od-id="a">a</li><li data-od-id="b">b</li></ul>';
    const store = createDocumentStore(src);
    store.applyOp({ kind: 'remove-node', nodeId: 'a' });
    expect(store.toSource()).not.toContain('>a<');
    expect(store.toSource()).toContain('>b<');
    expect(store.getNode('a')).toBeNull();
  });

  it('applies replace-outer and preserves data-od-id', () => {
    const src = '<button data-od-id="cta">old</button>';
    const store = createDocumentStore(src);
    const result = store.applyOp({
      kind: 'replace-outer',
      nodeId: 'cta',
      html: '<a href="/x">new</a>',
    });
    expect(result.ok).toBe(true);
    expect(store.toSource()).toContain('data-od-id="cta"');
    expect(store.toSource()).toContain('<a');
    expect(store.toSource()).toContain('href="/x"');
  });

  it('rejects replace-outer when html produces multiple roots', () => {
    const src = '<button data-od-id="cta">old</button>';
    const store = createDocumentStore(src);
    const result = store.applyOp({
      kind: 'replace-outer',
      nodeId: 'cta',
      html: '<a>a</a><a>b</a>',
    });
    expect(result.ok).toBe(false);
    expect(store.toSource()).toContain('>old<');
  });

  it('applies replace-document by reparsing source', () => {
    const store = createDocumentStore('<p>old</p>');
    const result = store.applyOp({
      kind: 'replace-document',
      source: '<section><h1>new</h1></section>',
    });
    expect(result.ok).toBe(true);
    expect(store.toSource()).toBe('<section><h1>new</h1></section>');
  });

  it('rolls back a batch when one op fails', () => {
    const src = '<a data-od-id="cta" href="/old">go</a>';
    const store = createDocumentStore(src);
    const result = store.applyOps([
      { kind: 'set-attribute', nodeId: 'cta', name: 'href', value: '/new' },
      { kind: 'set-text', nodeId: 'missing', value: 'x' },
    ]);
    expect(result.ok).toBe(false);
    expect(store.toSource()).toContain('href="/old"');
    expect(store.getVersion()).toBe(0);
  });

  it('notifies subscribers on op application', () => {
    const store = createDocumentStore('<p data-od-id="p">a</p>');
    let count = 0;
    const unsubscribe = store.subscribe(() => {
      count += 1;
    });
    store.applyOp({ kind: 'set-text', nodeId: 'p', value: 'b' });
    store.applyOp({ kind: 'set-text', nodeId: 'p', value: 'c' });
    expect(count).toBe(2);
    unsubscribe();
    store.applyOp({ kind: 'set-text', nodeId: 'p', value: 'd' });
    expect(count).toBe(2);
  });

  it('preserves untouched siblings byte-for-byte after a mutation', () => {
    const src = `<section>
  <h1 data-od-id="t">Old</h1>
  <p>Bullet 1</p>
  <p>Bullet 2</p>
</section>`;
    const store = createDocumentStore(src);
    store.applyOp({ kind: 'set-text', nodeId: 't', value: 'New' });
    const out = store.toSource();
    expect(out).toContain('<p>Bullet 1</p>');
    expect(out).toContain('<p>Bullet 2</p>');
    expect(out).toContain('<h1 data-od-id="t">New</h1>');
  });

  it('locates parent via getParent', () => {
    const src = '<section data-od-id="s"><h1 data-od-id="t">Hi</h1></section>';
    const store = createDocumentStore(src);
    const parent = store.getParent('t');
    expect(parent).not.toBeNull();
    expect(parent?.id).toBe('s');
    expect(isElementNode(parent!)).toBe(true);
  });
});
