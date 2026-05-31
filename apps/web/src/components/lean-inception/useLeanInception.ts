import { useCallback, useEffect, useState } from 'react';
import type {
  LeanInceptionState,
  LeanInceptionError,
  ExtractDocumentsResponse,
  ExtractDocumentInput,
} from '@open-design/contracts';
import { SUPPORTED_EXTENSIONS } from './constants';

export interface UseLeanInception {
  state: LeanInceptionState | null;
  isLoading: boolean;
  isMutating: boolean;
  /** True when at least one document is still being extracted in the background. */
  hasExtractingDocs: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  extract: (files: File[]) => Promise<void>;
  removeDocument: (documentId: string) => Promise<void>;
  removeCard: (cardId: string) => Promise<void>;
  reset: () => Promise<void>;
  syncToRag: () => Promise<{ chunkCount: number; embedded: boolean } | null>;
}

const baseFor = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/lean-inception`;

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fileExtension(file: File): string {
  const idx = file.name.lastIndexOf('.');
  return idx >= 0 ? file.name.slice(idx).toLowerCase() : '';
}

function fileMime(file: File): 'text/markdown' | 'text/plain' | 'image/png' | 'image/jpeg' | null {
  const ext = fileExtension(file);
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function useLeanInception(projectId: string): UseLeanInception {
  const [state, setState] = useState<LeanInceptionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    setError(null);
    const res = await fetch(baseFor(projectId), { method: 'GET' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { state: LeanInceptionState };
    setState(data.state);
  }, [projectId]);

  const refresh = useCallback(async (): Promise<void> => {
    setIsMutating(true);
    try { await fetchState(); }
    catch (e) { setError(errorToString(e)); }
    finally { setIsMutating(false); }
  }, [fetchState]);

  const extract = useCallback(async (files: File[]): Promise<void> => {
    setError(null);
    const docs: ExtractDocumentInput[] = [];
    for (const file of files) {
      const mime = fileMime(file);
      if (!mime || !SUPPORTED_EXTENSIONS.has(fileExtension(file))) {
        setError('Only .md, .txt, .png, .jpg files are supported.');
        return;
      }
      const content_base64 = await readFileAsBase64(file);
      docs.push({ filename: file.name, mime_type: mime, content_base64 });
    }
    setIsMutating(true);
    try {
      const res = await fetch(`${baseFor(projectId)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documents: docs }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ExtractDocumentsResponse;
      setState(data.state);
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId]);

  const removeDocument = useCallback(async (documentId: string): Promise<void> => {
    setError(null);
    setIsMutating(true);
    try {
      const res = await fetch(
        `${baseFor(projectId)}/documents/${encodeURIComponent(documentId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { state: LeanInceptionState };
      setState(data.state);
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId]);

  const removeCard = useCallback(async (cardId: string): Promise<void> => {
    setError(null);
    setIsMutating(true);
    try {
      const res = await fetch(
        `${baseFor(projectId)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { state: LeanInceptionState };
      setState(data.state);
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId]);

  const syncToRag = useCallback(async (): Promise<{ chunkCount: number; embedded: boolean } | null> => {
    setError(null);
    try {
      const res = await fetch(`${baseFor(projectId)}/sync-to-rag`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok: boolean; result: { chunkCount: number; embedded: boolean } };
      return { chunkCount: data.result.chunkCount, embedded: data.result.embedded };
    } catch (e) {
      setError(errorToString(e));
      return null;
    }
  }, [projectId]);

  const reset = useCallback(async (): Promise<void> => {
    setError(null);
    setIsMutating(true);
    try {
      const res = await fetch(baseFor(projectId), { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      await fetchState();
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId, fetchState]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchState()
      .catch((e) => { if (!cancelled) setError(errorToString(e)); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [fetchState]);

  const hasExtractingDocs = state?.documents.some(d => d.extraction_status === 'extracting') ?? false;

  // Poll while any document is still being extracted in the background.
  useEffect(() => {
    if (!hasExtractingDocs) return;

    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        if (cancelled) return;
        try {
          await fetchState();
        } catch {
          // swallow; user will see toast on visible failure
        }
      })();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasExtractingDocs, fetchState]);

  return { state, isLoading, isMutating, hasExtractingDocs, error, refresh, extract, removeDocument, removeCard, reset, syncToRag };
}
