// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeanInception } from '../../src/components/lean-inception/useLeanInception';

const emptyState = (projectId: string) => ({
  inception_id: 'li_1',
  project_id: projectId,
  documents: [],
  columns: {
    vision:              { status: 'not_identified', cards: [] },
    objective:           { status: 'not_identified', cards: [] },
    problem:             { status: 'not_identified', cards: [] },
    personas:            { status: 'not_identified', cards: [] },
    features:            { status: 'not_identified', cards: [] },
    business_rules:      { status: 'not_identified', cards: [] },
    acceptance_criteria: { status: 'not_identified', cards: [] },
  },
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLeanInception', () => {
  it('loads state on mount', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: emptyState('prj_1') }),
    });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.state?.project_id).toBe('prj_1');
    expect(result.current.error).toBeNull();
  });

  it('sets error when initial fetch fails', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/network down/);
  });

  it('extract posts base64 documents and updates state', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          state: { ...emptyState('prj_1'), documents: [{ id: 'doc_1', filename: 'a.md', mime_type: 'text/markdown', byte_size: 5, content_hash: 'h', ingested_at: 't', last_extracted_at: 't', extraction_status: 'extracted', extraction_error: null, card_count: 0 }] },
          extractions: [],
        }),
      });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const file = new File(['hello'], 'a.md', { type: 'text/markdown' });
    await act(async () => { await result.current.extract([file]); });

    expect(result.current.state?.documents).toHaveLength(1);
    const lastCall = (fetch as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain('/api/projects/prj_1/lean-inception/documents');
    expect(lastCall[1].method).toBe('POST');
    const body = JSON.parse(lastCall[1].body);
    expect(body.documents[0].mime_type).toBe('text/markdown');
    expect(body.documents[0].content_base64).toBe(Buffer.from('hello').toString('base64'));
  });

  it('extract rejects unsupported formats locally without fetching', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await act(async () => { await result.current.extract([file]); });

    expect((fetch as any).mock.calls).toHaveLength(1); // only the initial GET
    expect(result.current.error).toMatch(/Only .md and .txt/);
  });

  it('removeDocument issues DELETE and updates state', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.removeDocument('doc_1'); });
    const lastCall = (fetch as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain('/api/projects/prj_1/lean-inception/documents/doc_1');
    expect(lastCall[1].method).toBe('DELETE');
  });

  it('reset issues DELETE on inception then refresh', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) }) // mount
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })                  // reset
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) }); // refresh
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.reset(); });
    expect((fetch as any).mock.calls).toHaveLength(3);
    expect((fetch as any).mock.calls[1][1].method).toBe('DELETE');
    expect((fetch as any).mock.calls[2][1]?.method ?? 'GET').toBe('GET');
  });
});
