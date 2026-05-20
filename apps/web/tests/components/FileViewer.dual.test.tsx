// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Minimal HTML file that routes to HtmlViewer (the component with modeMenuOpen). */
function htmlFile(overrides?: Partial<ProjectFile>): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Test',
      entry: 'index.html',
      renderer: 'html',
      exports: ['html'],
    },
    ...overrides,
  };
}

function htmlSource() {
  return '<!doctype html><html><body><h1>Hi</h1></body></html>';
}

/** Mock HTMLElement.prototype.clientWidth to return a fixed value for this test. */
function mockClientWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
}

describe('FileViewer — dual view', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Default: stub fetch so the component doesn't fire real network requests.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
  });

  it('renders three items in the mode dropdown', () => {
    // clientWidth=0 by default in JSDOM — dual will be disabled but still present in the menu
    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml={htmlSource()}
      />,
    );

    const trigger = container.querySelector('.viewer-mode-trigger') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    const items = container.querySelectorAll('.viewer-mode-menu-item');
    expect(items.length).toBe(3);

    const labels = Array.from(items).map((i) => i.textContent ?? '');
    expect(labels.some((l) => l.includes('Preview'))).toBe(true);
    // The English translation for fileViewer.source is "Code"
    expect(labels.some((l) => l.includes('Code'))).toBe(true);
    expect(labels.some((l) => l.includes('Dual'))).toBe(true);
  });

  it('Dual + renderable source renders SplitPane (.split-pane element)', () => {
    // Need clientWidth >= 720 for dualFitsWindow to be true
    mockClientWidth(1200);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'od.fileViewer.viewMode') {
          return JSON.stringify({ viewMode: 'dual' });
        }
        return null;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: () => null,
    });

    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml={htmlSource()}
      />,
    );

    expect(container.querySelector('.split-pane')).not.toBeNull();
  });

  it('Dual + empty source falls back (no .split-pane rendered)', () => {
    mockClientWidth(1200);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'od.fileViewer.viewMode') {
          return JSON.stringify({ viewMode: 'dual' });
        }
        return null;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: () => null,
    });

    // liveHtml is empty string — isPreviewableFile returns false — dual falls back to source
    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml=""
      />,
    );

    expect(container.querySelector('.split-pane')).toBeNull();
  });

  it('small window disables the Dual menu item with a tooltip about window size', () => {
    // clientWidth=0 → dualFitsWindow=false, but dualSupportsFile=true (renderable HTML)
    // so the tooltip should mention the window, not file type
    mockClientWidth(0);

    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml={htmlSource()}
      />,
    );

    const trigger = container.querySelector('.viewer-mode-trigger') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    const dualItem = container.querySelector('.viewer-mode-menu-item[disabled]') as HTMLButtonElement | null;
    expect(dualItem).not.toBeNull();
    expect(dualItem!.disabled).toBe(true);
    // Tooltip should mention window width, not file type
    const title = dualItem!.getAttribute('title') ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).not.toContain('file');
  });
});
