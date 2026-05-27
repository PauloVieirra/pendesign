// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ProjectFile } from '../../src/types';

// jsdom doesn't ship matchMedia; ThemeToggle (mounted inside FileViewer) calls
// it during initial render. Provide a minimal stub before each test.
beforeEach(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
});

// Shadow the panel so the test doesn't have to mount the full property editor.
// The harness mirrors FileViewer.manual-edit-history.test.tsx.
const panelState = vi.hoisted(() => ({
  props: null as ComponentProps<typeof import('../../src/components/ManualEditPanel').ManualEditPanel> | null,
}));

vi.mock('../../src/components/ManualEditPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditPanel')>();
  return {
    ...actual,
    ManualEditPanel: (props: ComponentProps<typeof actual.ManualEditPanel>) => {
      panelState.props = props;
      return <div data-testid="mock-manual-edit-panel" />;
    },
  };
});

import { FileViewer } from '../../src/components/FileViewer';

afterEach(() => {
  cleanup();
  panelState.props = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface SaveHarness {
  savedSources: string[];
  fetchMock: ReturnType<typeof vi.fn>;
}

function setupSaveHarness(initialSource: string): SaveHarness {
  const savedSources: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.includes('/api/projects/project-1/deployments')) {
      return new Response(JSON.stringify({ deployments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { content: string };
      savedSources.push(payload.content);
      return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/projects/project-1/raw/preview.html')) {
      return new Response(initialSource, { status: 200 });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { savedSources, fetchMock };
}

describe('FileViewer od-edit-insert-commit handler', () => {
  it('applies insert-html-as-child when there is no insertBefore', async () => {
    const initialSource = '<!doctype html><html><body><main data-od-id="card-a"><p data-od-id="lede">Lede</p></main></body></html>';
    const { savedSources } = setupSaveHarness(initialSource);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(panelState.props).not.toBeNull());

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'od-edit-insert-commit', tool: 'shape', containerId: 'card-a', insertBefore: null },
      }));
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    // Shape inserts a <div> with the gray background; it must land as a child
    // of card-a (after the existing lede paragraph).
    expect(savedSources[0]).toContain('background-color: #e5e7eb');
    expect(savedSources[0]).toMatch(/<p data-od-id="lede">Lede<\/p>\s*<div data-od-id="od-ins-/);
  });

  it('applies insert-html-before-ref when insertBefore is set', async () => {
    const initialSource = '<!doctype html><html><body><main data-od-id="root"><p data-od-id="card-b">B</p></main></body></html>';
    const { savedSources } = setupSaveHarness(initialSource);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(panelState.props).not.toBeNull());

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'od-edit-insert-commit', tool: 'text', containerId: 'root', insertBefore: 'card-b' },
      }));
    });

    await waitFor(() => expect(savedSources).toHaveLength(1));
    // Text inserts a <p>; insert-html-before-ref puts it immediately before
    // card-b inside the same parent.
    expect(savedSources[0]).toMatch(/<p data-od-id="od-ins-[^"]+" style="font-size: 16px; color: #111;">Text<\/p><p data-od-id="card-b">B<\/p>/);
  });

  it('clears armedTool after a commit so the toolbar deactivates', async () => {
    const initialSource = '<!doctype html><html><body><main data-od-id="card-a">x</main></body></html>';
    setupSaveHarness(initialSource);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(panelState.props).not.toBeNull());

    // Arm the shape tool via the InsertToolbar button.
    const shapeBtn = screen.getByRole('button', { name: 'Shape' });
    fireEvent.click(shapeBtn);
    expect(shapeBtn.getAttribute('aria-pressed')).toBe('true');

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'od-edit-insert-commit', tool: 'shape', containerId: 'card-a', insertBefore: null },
      }));
    });

    await waitFor(() => expect(shapeBtn.getAttribute('aria-pressed')).toBe('false'));
  });

  it('clears armedTool when the bridge emits od-edit-insert-disarmed', async () => {
    const initialSource = '<!doctype html><html><body><main data-od-id="card-a">x</main></body></html>';
    setupSaveHarness(initialSource);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(panelState.props).not.toBeNull());

    const textBtn = screen.getByRole('button', { name: 'Text' });
    fireEvent.click(textBtn);
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'od-edit-insert-disarmed', reason: 'escape' },
      }));
    });

    await waitFor(() => expect(textBtn.getAttribute('aria-pressed')).toBe('false'));
  });
});

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
