import { describe, expect, it } from 'vitest';

import {
  applyManualEditPatchViaStore,
  manualEditPatchToOps,
} from '../../src/document/legacy-adapter';
import { emptyManualEditStyles } from '../../src/edit-mode/types';

describe('manualEditPatchToOps', () => {
  it('converts set-text to a single set-text op', () => {
    const ops = manualEditPatchToOps({ id: 'n', kind: 'set-text', value: 'hi' }, '');
    expect(ops).toEqual([{ kind: 'set-text', nodeId: 'n', value: 'hi' }]);
  });

  it('converts set-link to set-text + set-attribute(href)', () => {
    const ops = manualEditPatchToOps({ id: 'n', kind: 'set-link', text: 'Go', href: '/x' }, '');
    expect(ops).toEqual([
      { kind: 'set-text', nodeId: 'n', value: 'Go' },
      { kind: 'set-attribute', nodeId: 'n', name: 'href', value: '/x' },
    ]);
  });

  it('converts set-image to two set-attribute ops', () => {
    const ops = manualEditPatchToOps(
      { id: 'n', kind: 'set-image', src: '/a.png', alt: 'A' },
      '',
    );
    expect(ops).toEqual([
      { kind: 'set-attribute', nodeId: 'n', name: 'src', value: '/a.png' },
      { kind: 'set-attribute', nodeId: 'n', name: 'alt', value: 'A' },
    ]);
  });

  it('drops protected attributes from set-attributes patches', () => {
    const ops = manualEditPatchToOps(
      {
        id: 'n',
        kind: 'set-attributes',
        attributes: { 'data-od-id': 'x', 'data-keep': 'yes', class: '' },
      },
      '',
    );
    expect(ops).toEqual([
      { kind: 'set-attribute', nodeId: 'n', name: 'data-keep', value: 'yes' },
      { kind: 'set-attribute', nodeId: 'n', name: 'class', value: null },
    ]);
  });

  it('converts set-style to a single set-style op with kebab-case properties', () => {
    // ManualEditStyles iteration order follows MANUAL_EDIT_STYLE_PROPS:
    // fontFamily, fontSize, fontWeight, color, ..., backgroundColor, ...
    const styles = { ...emptyManualEditStyles(), color: 'red', fontSize: '14px', backgroundColor: '#fff' };
    const ops = manualEditPatchToOps({ id: 'n', kind: 'set-style', styles }, '');
    expect(ops).toEqual([
      {
        kind: 'set-style',
        nodeId: 'n',
        declarations: [
          { property: 'font-size', value: '14px', important: false },
          { property: 'color', value: 'red', important: false },
          { property: 'background-color', value: '#fff', important: false },
        ],
      },
    ]);
  });

  it('returns null for set-token (unsupported in v1)', () => {
    const ops = manualEditPatchToOps({ kind: 'set-token', token: '--x', value: '1' }, '');
    expect(ops).toBeNull();
  });
});

describe('applyManualEditPatchViaStore', () => {
  it('applies set-text against an explicit data-od-id', () => {
    const src = '<h1 data-od-id="t">Old</h1>';
    const result = applyManualEditPatchViaStore(src, { id: 't', kind: 'set-text', value: 'New' });
    expect(result.ok).toBe(true);
    expect(result.source).toContain('<h1 data-od-id="t">New</h1>');
  });

  it('applies set-link and writes href', () => {
    const src = '<a data-od-id="cta" href="/old">go</a>';
    const result = applyManualEditPatchViaStore(src, {
      id: 'cta',
      kind: 'set-link',
      text: 'Click',
      href: '/new',
    });
    expect(result.ok).toBe(true);
    expect(result.source).toContain('href="/new"');
    expect(result.source).toContain('>Click</a>');
  });

  it('applies set-style as inline declarations', () => {
    const src = '<p data-od-id="p">x</p>';
    const styles = { ...emptyManualEditStyles(), color: 'red', padding: '8px' };
    const result = applyManualEditPatchViaStore(src, { id: 'p', kind: 'set-style', styles });
    expect(result.ok).toBe(true);
    expect(result.source).toContain('style="color: red; padding: 8px"');
  });

  it('passes set-full-source through verbatim', () => {
    const result = applyManualEditPatchViaStore('<p>old</p>', {
      kind: 'set-full-source',
      source: '<h1>new</h1>',
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('<h1>new</h1>');
  });

  it('fails with an error when the target id is missing', () => {
    const result = applyManualEditPatchViaStore('<p data-od-id="p">x</p>', {
      id: 'missing',
      kind: 'set-text',
      value: 'y',
    });
    expect(result.ok).toBe(false);
    expect(result.source).toBe('<p data-od-id="p">x</p>');
  });
});
