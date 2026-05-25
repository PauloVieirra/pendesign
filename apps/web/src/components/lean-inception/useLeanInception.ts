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
  error: string | null;
  refresh: () => Promise<void>;
  extract: (files: File[]) => Promise<void>;
  removeDocument: (documentId: string) => Promise<void>;
  reset: () => Promise<void>;
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

function fileMime(file: File): 'text/markdown' | 'text/plain' | null {
  const ext = fileExtension(file);
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
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
        setError('Only .md and .txt are supported.');
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

  return { state, isLoading, isMutating, error, refresh, extract, removeDocument, reset };
}
