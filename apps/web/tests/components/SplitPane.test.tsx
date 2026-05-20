import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SplitPane } from '../../src/components/SplitPane';

describe('SplitPane', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  function pane(children: [React.ReactNode, React.ReactNode], props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
    act(() => {
      root.render(<SplitPane {...props}>{children}</SplitPane>);
    });
    // JSDOM returns zero-sized rects/clientWidths by default. Stub the actual
    // SplitPane container so width-dependent math (clamp + onMove) has signal.
    const container = host.querySelector('.split-pane') as HTMLElement | null;
    if (container) {
      Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1000 });
      container.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 1000, bottom: 100, width: 1000, height: 100, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    }
  }

  it('renders both children with default 50/50 ratio', () => {
    pane([<div key="L">left</div>, <div key="R">right</div>]);
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    const right = host.querySelector('[data-split-side="right"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('50%');
    expect(right.style.flexBasis).toBe('50%');
  });

  it('honours a custom defaultRatio', () => {
    pane([<div key="L" />, <div key="R" />], { defaultRatio: 0.3 });
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('30%');
  });

  it('moves the divider on mouse drag and calls onRatioChange', () => {
    let received: number | null = null;
    pane(
      [<div key="L" />, <div key="R" />],
      { onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    });
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 700 }));
    });
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { clientX: 700 }));
    });
    expect(received).not.toBeNull();
    expect(received!).toBeGreaterThan(0.65);
    expect(received!).toBeLessThan(0.75);
  });

  it('clamps ratio so each side respects minSize', () => {
    let received = 0.5;
    pane(
      [<div key="L" />, <div key="R" />],
      { minSize: 240, onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    });
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 50 }));
    });
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { clientX: 50 }));
    });
    expect(received).toBeCloseTo(0.24, 2);
  });

  it('double-click on divider resets to 50/50', () => {
    let received = 0.5;
    pane(
      [<div key="L" />, <div key="R" />],
      { defaultRatio: 0.3, onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    });
    expect(received).toBe(0.5);
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('50%');
  });

  it('sets body cursor during drag and clears on mouseup', () => {
    pane([<div key="L" />, <div key="R" />]);
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    });
    expect(document.body.style.cursor).toBe('col-resize');
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'));
    });
    expect(document.body.style.cursor).toBe('');
  });
});
