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

    expect(host.textContent).toContain('Typography');
    expect(host.textContent).not.toContain('Advanced');
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

    const fontSelect = Array.from(host.querySelectorAll('.cc-row select'))
      .find((el) => el.closest('.cc-row')?.querySelector('.cc-label')?.textContent === 'Font') as HTMLSelectElement | null;
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

  it('renders Flex sub-section with a hint when target is not a layout container', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: false },
      styles: emptyManualEditStyles(),
    });

    const flexSub = Array.from(host.querySelectorAll('.cc-section-sub'))
      .find((el) => el.textContent?.trim() === 'Flex') as HTMLElement | undefined;
    if (!flexSub) throw new Error('Flex sub-section not found');

    // The hint about needing a container should be inside the Flex sub block.
    const hint = flexSub.parentElement?.querySelector('.cc-section-hint');
    expect(hint?.textContent).toContain('Select a container');
  });

  it('enables Flex controls when target is a layout container', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: emptyManualEditStyles(),
    });

    const flexSub = Array.from(host.querySelectorAll('.cc-section-sub'))
      .find((el) => el.textContent?.trim() === 'Flex') as HTMLElement | undefined;
    if (!flexSub) throw new Error('Flex sub-section not found');

    // No hint when layout is enabled
    expect(flexSub.parentElement?.querySelector('.cc-section-hint')).toBeNull();
    // Gap input should not be disabled
    const inputs = Array.from(flexSub.parentElement?.querySelectorAll('input') ?? []) as HTMLInputElement[];
    const enabledGap = inputs.find((i) => !i.disabled);
    expect(enabledGap).toBeDefined();
  });

  it('renders Width and Height as always-visible inputs + mode buttons', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!widthGroup || !heightGroup) throw new Error('Width/Height groups not found');

    const widthInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    const heightInput = heightGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(widthInput?.value).toBe('120');
    expect(heightInput?.value).toBe('80');

    const widthModeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    const heightModeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    expect(widthModeBtn?.getAttribute('data-mode')).toBe('fixed');
    expect(heightModeBtn?.getAttribute('data-mode')).toBe('fixed');
  });

  it('cycling the Width mode from Fixed lands on Fill (100%)', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    if (!modeBtn) throw new Error('Width mode button not found');

    act(() => {
      modeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '100%' }),
      'Style: Hero Title',
    );
  });

  it('cycling the Height mode twice from Fixed lands on Hug (fit-content)', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!heightGroup) throw new Error('Height group not found');
    const modeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    if (!modeBtn) throw new Error('Height mode button not found');

    // First click: Fixed → Fill
    act(() => {
      modeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    // Re-render with updated height to reflect fill state
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '100%' },
    });
    const heightGroup2 = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!heightGroup2) throw new Error('Height group not found after re-render');
    const modeBtn2 = heightGroup2.querySelector('button[data-mode]') as HTMLButtonElement | null;
    if (!modeBtn2) throw new Error('Height mode button not found after re-render');

    // Second click: Fill → Hug
    act(() => {
      modeBtn2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const calls = onStyleChange.mock.calls.map((c) => c[1]);
    expect(calls).toEqual([
      expect.objectContaining({ height: '100%' }),
      expect.objectContaining({ height: 'fit-content' }),
    ]);
  });

  it('Fixed mode reveals a px input that emits onStyleChange on blur', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    // Fixed is the default for "120px"; the decimal input should be present.
    const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    if (!numberInput) throw new Error('Width fixed px input not found');
    expect(numberInput.value).toBe('120');

    act(() => {
      numberInput.value = '240';
      Simulate.change(numberInput);
    });
    act(() => {
      Simulate.blur(numberInput);
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '240px' }),
      'Style: Hero Title',
    );
  });

  it('renders a clear-token chip when width is a var() token (no data loss)', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: 'var(--container-max)' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');

    const tokenChip = widthGroup.querySelector('.manual-edit-size-token') as HTMLElement | null;
    if (!tokenChip) throw new Error('Width token chip not found');
    expect(tokenChip.textContent).toBe('var(--container-max)');
    // Mode button must NOT be rendered when the value is a token — that's the data-loss
    // surface this fix closes.
    expect(widthGroup.querySelector('button[data-mode]')).toBeNull();
    expect(widthGroup.querySelector('input[inputmode="decimal"]')).toBeNull();

    const clearButton = widthGroup.querySelector('button[aria-label="Clear token"]') as HTMLButtonElement | null;
    if (!clearButton) throw new Error('Clear token button not found');

    act(() => {
      clearButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '' }),
      'Style: Hero Title',
    );
  });

  it('shows empty input and Fixed mode button when width is unset', () => {
    renderPanel({
      styles: { ...emptyManualEditStyles(), width: '' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');

    const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(input?.value).toBe('');
    const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    expect(modeBtn?.getAttribute('data-mode')).toBe('fixed');
  });

  it('shows 100% read-only in the input when width is Fill', () => {
    renderPanel({
      styles: { ...emptyManualEditStyles(), width: '100%' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(input?.value).toBe('100%');
    expect(input?.readOnly).toBe(true);
    const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    expect(modeBtn?.getAttribute('data-mode')).toBe('fill');
  });

  it('shows auto read-only in the input when height is Hug', () => {
    renderPanel({
      styles: { ...emptyManualEditStyles(), height: 'fit-content' },
    });

    const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
    if (!heightGroup) throw new Error('Height group not found');
    const input = heightGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(input?.value).toBe('auto');
    expect(input?.readOnly).toBe(true);
    const modeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
    expect(modeBtn?.getAttribute('data-mode')).toBe('hug');
  });

  it('Fixed mode emits once on blur, not on every keystroke', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    if (!numberInput) throw new Error('Width fixed px input not found');

    // Simulate the three keystrokes of typing "240" — each change event should
    // only update the local draft, NOT call onStyleChange.
    act(() => {
      numberInput.value = '2';
      Simulate.change(numberInput);
    });
    act(() => {
      numberInput.value = '24';
      Simulate.change(numberInput);
    });
    act(() => {
      numberInput.value = '240';
      Simulate.change(numberInput);
    });

    const widthCalls = onStyleChange.mock.calls.filter((call) =>
      Object.prototype.hasOwnProperty.call(call[1] ?? {}, 'width'),
    );
    expect(widthCalls.length).toBe(0);

    act(() => {
      Simulate.blur(numberInput);
    });

    const widthCallsAfterBlur = onStyleChange.mock.calls.filter((call) =>
      Object.prototype.hasOwnProperty.call(call[1] ?? {}, 'width'),
    );
    expect(widthCallsAfterBlur.length).toBe(1);
    expect(widthCallsAfterBlur[0]).toEqual([
      'hero-title',
      expect.objectContaining({ width: '240px' }),
      'Style: Hero Title',
    ]);
  });

  it('Fixed mode preserves up to 4 decimal places on blur', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    if (!numberInput) throw new Error('Width decimal input not found');

    act(() => {
      numberInput.value = '120.5050';
      Simulate.change(numberInput);
    });
    act(() => {
      Simulate.blur(numberInput);
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ width: '120.5050px' }),
      'Style: Hero Title',
    );
  });

  it('Width round-trip preserves trailing zeros (typed 120.5050 stays 120.5050 after re-render)', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    if (!input) throw new Error('Width decimal input not found');

    act(() => {
      input.value = '120.5050';
      Simulate.change(input);
    });
    act(() => {
      Simulate.blur(input);
    });

    // Simulate the parent re-rendering with the new width value
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120.5050px' },
    });

    const widthGroup2 = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    const input2 = widthGroup2?.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(input2?.value).toBe('120.5050');
  });

  it('Width Fixed mode rejects negative px values on commit', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: { ...emptyManualEditStyles(), width: '120px' },
    });

    const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
    if (!widthGroup) throw new Error('Width group not found');
    const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    if (!input) throw new Error('Width decimal input not found');

    // Negative shouldn't even enter the draft via the change guard, but
    // pre-populate the value and blur to confirm it gets reset.
    act(() => {
      input.value = '-5';
      Simulate.change(input);
    });
    // The acceptDraft regex should have refused, so the input value should
    // still be '120' (unchanged).
    expect(input.value).toBe('120');
  });

  it('summarizes full-source history entries without rendering the full file', () => {
    const source = '<html><body>' + 'x'.repeat(10_000) + '</body></html>';

    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).toBe(
      JSON.stringify({ kind: 'set-full-source', bytes: source.length }),
    );
    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).not.toContain('x'.repeat(100));
  });

  it('does not render Delete button when no element is selected', () => {
    renderPanel({ selectedTarget: null });
    const deleteButton = host.querySelector('.manual-edit-delete');
    expect(deleteButton).toBeNull();
  });

  it('renders Delete button when an element is selected and click opens modal', () => {
    const onDeleteConfirmOpenChange = vi.fn<(open: boolean) => void>();
    renderPanel({ onDeleteConfirmOpenChange });
    const deleteButton = host.querySelector('.manual-edit-delete') as HTMLButtonElement | null;
    if (!deleteButton) throw new Error('Delete button not found');

    act(() => {
      deleteButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onDeleteConfirmOpenChange).toHaveBeenCalledWith(true);
  });

  it('confirming delete emits delete-element patch and clears selection', () => {
    const onApplyPatch = vi.fn<OnApplyPatch>();
    const onDeleteConfirmOpenChange = vi.fn<(open: boolean) => void>();
    const onClearSelection = vi.fn<OnClearSelection>();
    renderPanel({
      onApplyPatch,
      onDeleteConfirmOpenChange,
      onClearSelection,
      deleteConfirmOpen: true,
    });

    const confirmButton = dom.window.document.querySelector('.delete-confirm-confirm') as HTMLButtonElement | null;
    if (!confirmButton) throw new Error('Confirm button not found');

    act(() => {
      confirmButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onApplyPatch).toHaveBeenCalledWith({ kind: 'delete-element', id: 'hero-title' }, 'Delete element');
    expect(onDeleteConfirmOpenChange).toHaveBeenCalledWith(false);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('renders sections in Layout → Typography → Appearance → Fill → Stroke order', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: emptyManualEditStyles(),
    });

    const inspector = host.querySelector('.cc-inspector') as HTMLElement | null;
    if (!inspector) throw new Error('.cc-inspector not found');
    const headers = Array.from(inspector.querySelectorAll('.cc-section > .cc-section-head'))
      .map((el) => el.textContent?.trim());
    expect(headers).toEqual(['Layout', 'Typography', 'Appearance', 'Fill', 'Stroke']);
  });

  it('renders Size / Flex / Spacing mini-sub-sections inside Layout', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: emptyManualEditStyles(),
    });

    const inspector = host.querySelector('.cc-inspector') as HTMLElement | null;
    if (!inspector) throw new Error('.cc-inspector not found');
    const layoutSection = Array.from(inspector.querySelectorAll('.cc-section'))
      .find((s) => s.querySelector('.cc-section-head')?.textContent?.trim() === 'Layout') as HTMLElement | undefined;
    if (!layoutSection) throw new Error('Layout section not found');

    const subs = Array.from(layoutSection.querySelectorAll('.cc-section-sub'))
      .map((el) => el.textContent?.trim());
    expect(subs).toEqual(['Size', 'Flex', 'Spacing']);
  });

  it('renders Stroke section with color, style, width quad cells, and radius', () => {
    renderPanel({
      selectedTarget: { ...target, isLayoutContainer: true },
      styles: emptyManualEditStyles(),
    });

    const inspector = host.querySelector('.cc-inspector') as HTMLElement | null;
    if (!inspector) throw new Error('.cc-inspector not found');
    const sections = Array.from(inspector.querySelectorAll('.cc-section')) as HTMLElement[];
    const stroke = sections.find((s) => s.querySelector('.cc-section-head')?.textContent?.trim() === 'Stroke');
    if (!stroke) throw new Error('Stroke section not found');

    expect(stroke.querySelectorAll('select').length).toBeGreaterThanOrEqual(1); // Style dropdown
    expect(stroke.querySelectorAll('.cc-quad-cell').length).toBeGreaterThanOrEqual(4); // T/R/B/L
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
    onDeleteConfirmOpenChange = vi.fn<(open: boolean) => void>(),
    attributesText = '{}',
    selectedTarget = target,
    styles = emptyManualEditStyles(),
    pageStylesEnabled = true,
    deleteConfirmOpen = false,
  }: {
    onDraftChange?: OnDraftChange;
    onApplyPatch?: OnApplyPatch;
    onError?: OnError;
    onStyleChange?: OnStyleChange;
    onInvalidStyle?: OnInvalidStyle;
    onClearSelection?: OnClearSelection;
    onDeleteConfirmOpenChange?: (open: boolean) => void;
    attributesText?: string;
    selectedTarget?: ManualEditTarget | null;
    styles?: ReturnType<typeof emptyManualEditStyles>;
    pageStylesEnabled?: boolean;
    deleteConfirmOpen?: boolean;
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
          deleteConfirmOpen={deleteConfirmOpen}
          onDeleteConfirmOpenChange={onDeleteConfirmOpenChange}
        />,
      );
    });
  }

});
