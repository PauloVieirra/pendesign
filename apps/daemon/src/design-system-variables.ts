import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

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

export const VARIABLES_FILE_NAME = 'variables.json';

export async function readVariables(dsDir: string): Promise<VariablesFile | null> {
  try {
    const raw = await readFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw) as VariablesFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.collections)) return parsed;
    return null;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeVariables(dsDir: string, data: VariablesFile): Promise<void> {
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function shortToken(): string {
  return randomBytes(6).toString('base64url');
}

export function newVariableId(): string {
  return `v_${shortToken()}`;
}
export function newCollectionId(): string {
  return `c_${shortToken()}`;
}
export function newGroupId(): string {
  return `g_${shortToken()}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function renderTokensCss(file: VariablesFile): string {
  const lines: string[] = [
    '/* Generated from variables.json. Edits made here will be overwritten on next save. */',
    ':root {',
  ];
  const used = new Set<string>();
  for (const collection of file.collections) {
    for (const group of collection.groups) {
      for (const variable of group.variables) {
        const baseName = `--${slug(collection.name)}-${slug(group.name)}-${slug(variable.name)}`;
        let name = baseName;
        let suffix = 2;
        while (used.has(name)) {
          name = `${baseName}-${suffix}`;
          suffix += 1;
        }
        used.add(name);
        lines.push(`  ${name}: ${formatValue(variable)};`);
      }
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

function formatValue(variable: Variable): string {
  if (variable.type === 'color' || variable.type === 'string') {
    return String(variable.value);
  }
  if (variable.type === 'number') {
    return `${Number(variable.value)}px`;
  }
  // boolean → CSS uses 0/1
  return variable.value ? '1' : '0';
}

const VAR_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

interface MigrationBucket {
  collectionName: string;
  type: VariableType;
  rawValue: string;
  group: string;
  varName: string;
}

function classifyVariable(name: string, rawValue: string): MigrationBucket {
  const value = rawValue.trim();
  if (name.startsWith('color-')) {
    const rest = name.slice('color-'.length);
    const parts = rest.split('-');
    const group = parts.length > 1 ? (parts[0] ?? 'Default') : 'Default';
    const varName = parts.length > 1 ? parts.slice(1).join('-') : (parts[0] ?? rest);
    return { collectionName: 'Colors', type: 'color', rawValue: value, group: titleCase(group), varName };
  }
  if (name.startsWith('font-')) {
    return { collectionName: 'Typography', type: inferTypoType(name, value), rawValue: value, group: 'Default', varName: name.slice('font-'.length) };
  }
  if (name.startsWith('space-')) {
    return { collectionName: 'Spacing', type: 'number', rawValue: stripPx(value), group: 'Default', varName: name.slice('space-'.length) };
  }
  if (name.startsWith('radius-')) {
    return { collectionName: 'Radii', type: 'number', rawValue: stripPx(value), group: 'Default', varName: name.slice('radius-'.length) };
  }
  if (name.startsWith('shadow-')) {
    return { collectionName: 'Effects', type: 'string', rawValue: value, group: 'Default', varName: name.slice('shadow-'.length) };
  }
  return { collectionName: 'Other', type: guessTypeFromValue(value), rawValue: value, group: 'Default', varName: name };
}

function inferTypoType(name: string, value: string): VariableType {
  if (/family/.test(name)) return 'string';
  return /^[0-9.]+/.test(value.trim()) ? 'number' : 'string';
}

function stripPx(value: string): string {
  const m = /^(-?\d+(?:\.\d+)?)\s*px$/.exec(value.trim());
  return m && m[1] !== undefined ? m[1] : value;
}

function guessTypeFromValue(value: string): VariableType {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'color';
  if (/^-?\d+(?:\.\d+)?(?:px|rem|em)?$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  return 'string';
}

function coerceValue(type: VariableType, raw: string): string | number | boolean {
  if (type === 'number') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'boolean') return /^true$/i.test(raw.trim());
  return raw;
}

function titleCase(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  return first === undefined ? value : first.toUpperCase() + value.slice(1);
}

export function migrateFromTokensCss(css: string): VariablesFile {
  if (!css || !css.trim()) {
    return {
      version: 1,
      collections: [
        {
          id: newCollectionId(),
          name: 'Default',
          groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
        },
      ],
    };
  }
  const buckets = new Map<string, Map<string, Variable[]>>();
  VAR_RE.lastIndex = 0;
  let match;
  while ((match = VAR_RE.exec(css)) !== null) {
    const rawName = match[1];
    const rawValue = match[2];
    if (rawName === undefined || rawValue === undefined) continue;
    const cls = classifyVariable(rawName, rawValue);
    const variable: Variable = {
      id: newVariableId(),
      name: cls.varName,
      type: cls.type,
      value: coerceValue(cls.type, cls.rawValue),
    };
    const collection = buckets.get(cls.collectionName) ?? new Map<string, Variable[]>();
    const group = collection.get(cls.group) ?? [];
    group.push(variable);
    collection.set(cls.group, group);
    buckets.set(cls.collectionName, collection);
  }
  const collections: VariableCollection[] = [];
  for (const [collectionName, groups] of buckets) {
    const groupArray: VariableGroup[] = [];
    for (const [groupName, variables] of groups) {
      groupArray.push({ id: newGroupId(), name: groupName, variables });
    }
    collections.push({ id: newCollectionId(), name: collectionName, groups: groupArray });
  }
  if (collections.length === 0) {
    collections.push({
      id: newCollectionId(),
      name: 'Default',
      groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
    });
  }
  return { version: 1, collections };
}

const TOKENS_CSS_FILE_NAME = 'tokens.css';

export async function saveVariables(dsDir: string, data: VariablesFile): Promise<void> {
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(data, null, 2) + '\n', 'utf8');
  await writeFile(path.join(dsDir, TOKENS_CSS_FILE_NAME), renderTokensCss(data), 'utf8');
}

const dsLocks = new Map<string, Promise<unknown>>();

export async function withDsLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = dsLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => fn());
  dsLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (dsLocks.get(key) === next) dsLocks.delete(key);
  }
}
