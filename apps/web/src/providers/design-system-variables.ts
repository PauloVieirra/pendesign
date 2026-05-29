export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Mode {
  id: string;
  name: string;
  width?: number;
}

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, string | number | boolean>;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: Mode[];
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 2;
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

const enc = encodeURIComponent;

export const fetchVariables = (dsId: string) =>
  jsonFetch<{ variables: VariablesFile; migrated?: boolean }>(
    `/api/design-systems/${enc(dsId)}/variables`,
  );

export const updateVariable = (
  dsId: string,
  variableId: string,
  patch: Partial<Pick<Variable, 'name' | 'type'>> & {
    valuesByMode?: Record<string, string | number | boolean>;
    value?: string | number | boolean;
  },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/${enc(variableId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );

export const deleteVariable = (dsId: string, variableId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/${enc(variableId)}`,
    { method: 'DELETE' },
  );

export const createVariable = (
  dsId: string, collectionId: string, groupId: string,
  body: { name: string; type: VariableType; value?: string | number | boolean },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups/${enc(groupId)}/variables`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export const createCollection = (dsId: string, name: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );

export const deleteCollection = (dsId: string, collectionId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}`,
    { method: 'DELETE' },
  );

export const createGroup = (dsId: string, collectionId: string, name: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );

export const deleteGroup = (dsId: string, collectionId: string, groupId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups/${enc(groupId)}`,
    { method: 'DELETE' },
  );

export const createMode = (dsId: string, collectionId: string, body: { name: string; width?: number }) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export const updateMode = (
  dsId: string, collectionId: string, modeId: string,
  patch: { name?: string; width?: number | null },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes/${enc(modeId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );

export const deleteMode = (dsId: string, collectionId: string, modeId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes/${enc(modeId)}`,
    { method: 'DELETE' },
  );

export const createEmptyDesignSystemForProject = (
  projectId: string,
  body: { seed?: 'empty' | 'defaults' } = {},
) =>
  jsonFetch<{ designSystem: { id: string; title?: string; summary?: string }; designSystemId: string }>(
    `/api/projects/${enc(projectId)}/design-system/create-empty`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
