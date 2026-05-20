import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { BreakpointRuler, BREAKPOINT_PRESETS } from '../../src/components/BreakpointRuler';

const t = (k: string) => k;

describe('BreakpointRuler', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  function render(props: React.ComponentProps<typeof BreakpointRuler>) {
    act(() => {
      root.render(<BreakpointRuler {...props} />);
    });
  }

  it('exports both Tailwind and Bootstrap presets', () => {
    expect(BREAKPOINT_PRESETS.tailwind.map((b) => b.px)).toEqual([640, 768, 1024, 1280, 1536]);
    expect(BREAKPOINT_PRESETS.bootstrap.map((b) => b.px)).toEqual([576, 768, 992, 1200, 1400]);
  });

  it('marks the active breakpoint based on width (Tailwind, 900px)', () => {
    render({ width: 900, height: 720, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const active = host.querySelector('[data-active-breakpoint="true"]') as HTMLElement;
    expect(active.dataset.breakpointId).toBe('md');
  });

  it('marks the active breakpoint based on width (Bootstrap, 1100px → lg)', () => {
    render({ width: 1100, height: 720, preset: 'bootstrap', onPresetChange: () => {}, t: t as never });
    const active = host.querySelector('[data-active-breakpoint="true"]') as HTMLElement;
    expect(active.dataset.breakpointId).toBe('lg');
  });

  it('shows the "below smallest" indicator when width < smallest breakpoint', () => {
    render({ width: 480, height: 720, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const badge = host.querySelector('[data-ruler-badge]') as HTMLElement;
    expect(badge.textContent).toContain('< sm');
    expect(host.querySelector('[data-active-breakpoint="true"]')).toBeNull();
  });

  it('shows live width × height badge', () => {
    render({ width: 1024, height: 768, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const badge = host.querySelector('[data-ruler-badge]') as HTMLElement;
    expect(badge.textContent).toContain('1024');
    expect(badge.textContent).toContain('768');
  });

  it('calls onPresetChange when the selector is changed', () => {
    let received: 'tailwind' | 'bootstrap' | null = null;
    render({
      width: 1024,
      height: 768,
      preset: 'tailwind',
      onPresetChange: (p) => { received = p; },
      t: t as never,
    });
    const select = host.querySelector('[data-preset-select]') as HTMLSelectElement;
    act(() => {
      select.value = 'bootstrap';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(received).toBe('bootstrap');
  });
});
