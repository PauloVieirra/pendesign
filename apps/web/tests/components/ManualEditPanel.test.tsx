import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { ManualEditPanel, emptyManualEditDraft, manualEditPatchSummary, normalizeManualEditStyles, type ManualEditDraft } from '../../src/components/ManualEditPanel';
import { emptyManualEditStyles, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '@open-design/edit-bridge';

const target: ManualEditTarget = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: { 'data-od-id': 'hero-title' },
  styles: emptyManualEditStyles(),
  isLayoutContainer: false,
  outerHtml: '<h1 data-od-id="hero-title">Original</h1>',
};

type OnDraftChange = (draft: ManualEditDraft) => void;
type OnStyleChange = (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
type OnInvalidStyle = (id: string, keys: Array<keyof ManualEditStyles>) => void;
type OnApplyPatch = (patch: ManualEditPatch, label: string) => void;
type OnError = (message: string) => void;
type OnClearSelection = () => void;

describe('ManualEditPanel', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = dom.window.document.querySelector('#root') as HTMLDivElement;
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    dom.window.close();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'HTMLElement');
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  it('renders the style inspector without the advanced editor entry', () => {
    renderPanel();

    expect(host.textContent).toContain('TYPOGRAPHY');
    expect(host.textContent).not.toContain('Advanced');
    expect(host.textContent).not.toContain('Content');
  });

  it('allows returning from an element inspector to the page inspector', () => {
    const onClearSelection = vi.fn();
    renderPanel({ onClearSelection });

    const pageButton = host.querySelector('button[aria-label="Show page inspector"]') as HTMLButtonElement | null;
    if (!pageButton) throw new Error('Page inspector button not found');

    act(() => {
      pageButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('normalizes font stacks and writes a usable font-family value', () => {
    const onDraftChange = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onDraftChange,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontFamily: '"Roboto", sans-serif',
        fontSize: '32px',
        color: '#111111',
        paddingTop: '8px',
      },
    });

    const fontSelect = host.querySelector('select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');
    expect(fontSelect.value).toBe('Roboto, Arial, sans-serif');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      styles: expect.objectContaining({ fontFamily: 'Georgia, serif' }),
    }));
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontFamily: 'Georgia, serif' }, 'Style: Hero Title');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ fontSize: '32px', color: '#111111', paddingTop: '8px' }),
      'Style: Hero Title',
    );
  });

  it('shows px-backed values without px in numeric inputs', () => {
    renderPanel({
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
      },
    });

    const sizeRow = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Size'));
    const sizeInput = sizeRow?.querySelector('input') as HTMLInputElement | null;
    if (!sizeInput) throw new Error('Size input not found');

    expect(sizeInput.value).toBe('32');
  });

  it('increments normal rows and quad cells with normalized values', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
        opacity: '0.5',
        paddingTop: '8px',
      },
    });

    const sizeIncrease = host.querySelector('button[aria-label="Size increase"]') as HTMLButtonElement | null;
    const opacityIncrease = host.querySelector('button[aria-label="Opacity increase"]') as HTMLButtonElement | null;
    const paddingTopDecrease = host.querySelector('.cc-quad button[aria-label="T decrease"]') as HTMLButtonElement | null;
    if (!sizeIncrease || !opacityIncrease || !paddingTopDecrease) throw new Error('Stepper button not found');

    act(() => {
      sizeIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      opacityIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      paddingTopDecrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontSize: '33px' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { opacity: '0.6' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { paddingTop: '7px' }, 'Style: Hero Title');
  });

  it('does not persist an unchanged target style when the inspector opens', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes valid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({
      fontSize: '48',
      color: '#f00',
      opacity: '2',
      lineHeight: '1.4',
    }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: {
        fontSize: '48px',
        color: '#ff0000',
        opacity: '1',
        lineHeight: '1.4',
      },
    });
    expect(normalizeManualEditStyles({ lineHeight: '49px' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { lineHeight: '49px' },
    });
  });

  it('rejects invalid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({ color: 'tomato' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'color must be a hex color, rgba(), or var(--token).',
    });
    expect(normalizeManualEditStyles({ lineHeight: '-1px' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'Line height must be a positive number, px value, or var(--token).',
    });
  });

  it('treats empty values as inline style clears', () => {
    expect(normalizeManualEditStyles({ fontSize: '', color: '' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { fontSize: '', color: '' },
    });
  });

  it('does not validate unchanged computed line-height values on blur', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Line'))
      ?.querySelector('input') as HTMLInputElement | null;
    if (!lineInput) throw new Error('Line input not found');

    act(() => {
      lineInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('accepts edited computed pixel line-height values', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = Array.from(host.querySelectorAll('.cc-row'))
      .find((row) => row.textContent?.includes('Line'))
      ?.querySelector('input') as HTMLInputElement | null;
    if (!lineInput) throw new Error('Line input not found');

    act(() => {
      lineInput.value = '49px';
      Simulate.change(lineInput);
    });

    expect(onError).toHaveBeenCalledWith('');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { lineHeight: '49px' }, 'Style: Hero Title');
  });

  it('does not persist unchanged page styles when no target is selected', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch, selectedTarget: null });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits only the changed page style field', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const bgSwatch = host.querySelector('button[aria-label="Pick Background"]') as HTMLButtonElement | null;
    if (!bgSwatch) throw new Error('Background swatch not found');

    act(() => {
      bgSwatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    // Popover is now portal'd into document.body, not inside the render host.
    const colorTile = dom.window.document.querySelector('button.cpx-swatch[title="#3b82f6"]') as HTMLButtonElement | null;
    if (!colorTile) throw new Error('Background color tile not found');
    act(() => {
      colorTile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { backgroundColor: '#3b82f6' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontFamily: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('does not emit untouched page fields when changing the page font', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: 'Georgia, serif' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('shows an inactive Page inspector for fragment HTML sources', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null, pageStylesEnabled: false });

    expect(host.textContent).toContain('Page styles are available only for full HTML documents.');
    expect(host.textContent).not.toContain('Background');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('select')).toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('keeps explicit empty page values as field-specific clears', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = '';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: '' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String), fontFamily: expect.any(String) }),
      'Page styles',
    );
  });

  it('renders layout as inactive for non-layout single targets', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        gap: 'normal',
        flexDirection: 'row',
      },
    });

    const layoutSection = sectionByTitle('LAYOUT');
    expect(layoutSection.classList.contains('cc-section-inactive')).toBe(true);
    expect(layoutSection.textContent).toContain('Select a container or group to edit layout.');
    const gapInput = layoutSection.querySelector('input') as HTMLInputElement | null;
    const directionSelect = layoutSection.querySelector('select') as HTMLSelectElement | null;
    if (!gapInput || !directionSelect) throw new Error('Layout controls not found');

    expect(gapInput.disabled).toBe(true);
    expect(directionSelect.disabled).toBe(true);
    expect(normalizeManualEditStyles({ gap: '12', flexDirection: 'column' }, { layoutEnabled: false })).toEqual({
      ok: true,
      styles: {},
    });
  });

  it('enables layout controls for flex or grid containers', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: {
        ...emptyManualEditStyles(),
        gap: '8px',
        flexDirection: 'row',
      },
    });

    const layoutSection = sectionByTitle('LAYOUT');
    expect(layoutSection.classList.contains('cc-section-inactive')).toBe(false);
    expect(layoutSection.textContent).not.toContain('Select a container or group to edit layout.');
    const gapInput = layoutSection.querySelector('input') as HTMLInputElement | null;
    const directionSelect = layoutSection.querySelector('select') as HTMLSelectElement | null;
    const gapIncrease = layoutSection.querySelector('button[aria-label="Gap increase"]') as HTMLButtonElement | null;
    if (!gapInput || !directionSelect) throw new Error('Layout controls not found');
    expect(gapInput.disabled).toBe(false);
    expect(directionSelect.disabled).toBe(false);
    if (!gapIncrease) throw new Error('Gap increase control not found');

    act(() => {
      gapIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      directionSelect.value = 'column';
      directionSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { gap: '9px' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { flexDirection: 'column' }, 'Style: Hero Title');
  });

  it('renders Width and Height 3-way toggles in the SIZE section', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!widthGroup || !heightGroup) throw new Error('Width/Height groups not found');

    const widthRadios = Array.from(widthGroup.querySelectorAll('input[type="radio"]'));
    const widthModes = widthRadios.map((r) => (r as HTMLInputElement).getAttribute('aria-label'));
    expect(widthModes).toEqual(['fixed', 'fill', 'hug']);
    const heightModes = Array.from(heightGroup.querySelectorAll('input[type="radio"]'))
      .map((r) => (r as HTMLInputElement).getAttribute('aria-label'));
    expect(heightModes).toEqual(['fixed', 'fill', 'hug']);
  });

  it('switching Width to Fill emits onStyleChange with width: 100%', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const fillRadio = widthGroup.querySelector('input[aria-label="fill"]') as HTMLInputElement | null;
    if (!fillRadio) throw new Error('Width fill radio not found');

    act(() => {
      fillRadio.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '100%' }),
      'Style: Hero Title',
    );
  });

  it('switching Height to Hug emits onStyleChange with height: fit-content', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!heightGroup) throw new Error('Height group not found');
    const hugRadio = heightGroup.querySelector('input[aria-label="hug"]') as HTMLInputElement | null;
    if (!hugRadio) throw new Error('Height hug radio not found');

    act(() => {
      hugRadio.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ height: 'fit-content' }),
      'Style: Hero Title',
    );
  });

  it('Fixed mode reveals a px input that emits onStyleChange on change', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    // Fixed is the default for "120px"; the number input should be present.
    const numberInput = widthGroup.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (!numberInput) throw new Error('Width fixed px input not found');
    expect(numberInput.value).toBe('120');

    act(() => {
      numberInput.value = '240';
      Simulate.change(numberInput);
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '240px' }),
      'Style: Hero Title',
    );
  });

  it('summarizes full-source history entries without rendering the full file', () => {
    const source = '<html><body>' + 'x'.repeat(10_000) + '</body></html>';

    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).toBe(
      JSON.stringify({ kind: 'set-full-source', bytes: source.length }),
    );
    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).not.toContain('x'.repeat(100));
  });

  function sectionByTitle(title: string): HTMLElement {
    const section = Array.from(host.querySelectorAll('.cc-section'))
      .find((candidate) => candidate.querySelector('.cc-section-head')?.textContent === title) as HTMLElement | undefined;
    if (!section) throw new Error(`${title} section not found`);
    return section;
  }

  function renderPanel({
    onDraftChange = vi.fn<OnDraftChange>(),
    onApplyPatch = vi.fn<OnApplyPatch>(),
    onError = vi.fn<OnError>(),
    onStyleChange = vi.fn<OnStyleChange>(),
    onInvalidStyle = vi.fn<OnInvalidStyle>(),
    onClearSelection = vi.fn<OnClearSelection>(),
    attributesText = '{}',
    selectedTarget = target,
    styles = emptyManualEditStyles(),
    pageStylesEnabled = true,
  }: {
    onDraftChange?: OnDraftChange;
    onApplyPatch?: OnApplyPatch;
    onError?: OnError;
    onStyleChange?: OnStyleChange;
    onInvalidStyle?: OnInvalidStyle;
    onClearSelection?: OnClearSelection;
    attributesText?: string;
    selectedTarget?: ManualEditTarget | null;
    styles?: ReturnType<typeof emptyManualEditStyles>;
    pageStylesEnabled?: boolean;
  } = {}) {
    const draft = {
      ...emptyManualEditDraft('<html></html>'),
      text: 'Updated copy',
      attributesText,
      styles,
      outerHtml: target.outerHtml,
    };
    act(() => {
      root.render(
        <ManualEditPanel
          targets={[target]}
          selectedTarget={selectedTarget}
          draft={draft}
          history={[]}
          error={null}
          canUndo={false}
          canRedo={false}
          pageStylesEnabled={pageStylesEnabled}
          onSelectTarget={vi.fn<(target: ManualEditTarget) => void>()}
          onDraftChange={onDraftChange}
          onStyleChange={onStyleChange}
          onInvalidStyle={onInvalidStyle}
          onApplyPatch={onApplyPatch}
          onError={onError}
          onClearSelection={onClearSelection}
          onCancelDraft={vi.fn<() => void>()}
          onUndo={vi.fn<() => void>()}
          onRedo={vi.fn<() => void>()}
        />,
      );
    });
  }

});
