export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  value: string | number | boolean;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 1;
  collections: VariableCollection[];
}

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string } | string;
}

interface ErrorResult { error: { code?: string; message: string } }

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T | ErrorResult> {
  try {
    const resp = await fetch(input, init);
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as ApiErrorEnvelope | null;
      const err = body?.error;
      if (typeof err === 'object' && err !== null) {
        return { error: { code: (err as any).code, message: (err as any).message ?? `${resp.status} ${resp.statusText}` } };
      }
      return { error: { message: typeof err === 'string' ? err : `${resp.status} ${resp.statusText}` } };
    }
    return (await resp.json()) as T;
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'request failed' } };
  }
}

export function fetchVariables(dsId: string) {
  return jsonFetch<{ variables: VariablesFile; migrated?: boolean }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables`,
  );
}

export function updateVariable(dsId: string, variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/${encodeURIComponent(variableId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );
}

export function deleteVariable(dsId: string, variableId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/${encodeURIComponent(variableId)}`,
    { method: 'DELETE' },
  );
}

export function createVariable(dsId: string, collectionId: string, groupId: string, body: { name: string; type: VariableType; value: Variable['value'] }) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups/${encodeURIComponent(groupId)}/variables`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function createCollection(dsId: string, name: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );
}

export function deleteCollection(dsId: string, collectionId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' },
  );
}

export function createGroup(dsId: string, collectionId: string, name: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );
}

export function deleteGroup(dsId: string, collectionId: string, groupId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' },
  );
}
