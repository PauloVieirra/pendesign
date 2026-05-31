import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export type VariableScope =
  | 'color'
  | 'font-size'
  | 'font-family'
  | 'font-weight'
  | 'line-height'
  | 'padding'
  | 'margin'
  | 'gap'
  | 'border-radius'
  | 'border-width'
  | 'width'
  | 'height'
  | 'opacity'
  | null;

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
  scope?: VariableScope;
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
  version: 3;
  collections: VariableCollection[];
}

export const VARIABLES_FILE_NAME = 'variables.json';

export function newModeId(): string {
  return `m_${shortToken()}`;
}

// migrateV1ToV2 returns a v2-shaped object (intermediate step in chain).
// We return 'any' here so migrateV2ToV3 can accept it without version literal mismatch.
export function migrateV1ToV2(input: any): any {
  if (!input || typeof input !== 'object') {
    return { version: 2, collections: [] };
  }
  if (input.version === 2 || input.version === 3) return input;
  const collections = Array.isArray(input.collections) ? input.collections : [];
  const migratedCollections: VariableCollection[] = collections.map((c: any) => {
    const defaultMode: Mode = { id: newModeId(), name: 'Default' };
    const groups = Array.isArray(c.groups) ? c.groups : [];
    return {
      id: String(c.id),
      name: String(c.name),
      modes: [defaultMode],
      groups: groups.map((g: any) => ({
        id: String(g.id),
        name: String(g.name),
        variables: (Array.isArray(g.variables) ? g.variables : []).map((v: any) => ({
          id: String(v.id),
          name: String(v.name),
          type: v.type as VariableType,
          valuesByMode: { [defaultMode.id]: v.value },
        })),
      })),
    };
  });
  return { version: 2, collections: migratedCollections };
}

export function migrateV2ToV3(input: any): VariablesFile {
  if (!input || typeof input !== 'object') {
    return { version: 3, collections: [] };
  }
  if (input.version === 3) return input as VariablesFile;
  const collections = Array.isArray(input.collections) ? input.collections : [];
  const migratedCollections: VariableCollection[] = collections.map((c: any) => ({
    ...c,
    groups: (Array.isArray(c.groups) ? c.groups : []).map((g: any) => ({
      ...g,
      variables: (Array.isArray(g.variables) ? g.variables : []).map((v: any) => ({
        ...v,
        scope: 'scope' in v ? v.scope : null,
      })),
    })),
  }));
  return { version: 3, collections: migratedCollections };
}

export async function readVariables(dsDir: string): Promise<VariablesFile | null> {
  try {
    const raw = await readFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 3) return parsed as VariablesFile;
    const afterV2 = migrateV1ToV2(parsed);
    const upgraded = migrateV2ToV3(afterV2);
    // Best-effort write back; if it fails (e.g. read-only fixture), still return upgraded.
    try { await writeVariables(dsDir, upgraded); } catch { /* ignore */ }
    return upgraded;
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

function unitForScope(scope: VariableScope | undefined): string {
  switch (scope) {
    case 'line-height':
    case 'opacity':
    case 'font-weight':
      return '';
    case 'font-size':
    case 'padding':
    case 'margin':
    case 'gap':
    case 'border-radius':
    case 'border-width':
    case 'width':
    case 'height':
      return 'px';
    case 'color':
    case 'font-family':
      return ''; // unused for numeric path
    case null:
    case undefined:
      return 'px'; // fallback for unscoped numeric
  }
  return '';
}

function formatValueWithUnit(value: number | string | boolean, unit: string): string {
  if (typeof value === 'number') return unit ? `${value}${unit}` : String(value);
  if (typeof value === 'string') return value;
  return String(value);
}

interface ModeValue {
  mode: Mode;
  value: string | number | boolean;
}

interface VarRender {
  /** The baseline CSS declaration line (indent included), e.g. `  --foo: 32px;` */
  rootLine: string;
  /**
   * Zero or more self-contained @media block strings to emit after the root baseline.
   * Each entry is a complete `@media (...) {\n  :root {\n    ...\n  }\n}` string.
   */
  mediaBlocks: string[];
}

function renderVariableDecl(
  varName: string,
  variable: Variable,
  modes: Mode[],
): VarRender | null {
  // Collect mode values respecting collection mode order
  const modeValues: ModeValue[] = [];
  for (const mode of modes) {
    const val = variable.valuesByMode[mode.id];
    if (val !== undefined) {
      modeValues.push({ mode, value: val });
    }
  }

  if (modeValues.length === 0) return null;

  function serializeValue(val: string | number | boolean): string {
    if (variable.type === 'number') {
      const unit = unitForScope(variable.scope);
      return formatValueWithUnit(val, unit);
    }
    if (variable.type === 'boolean') {
      return val ? '1' : '0';
    }
    return String(val);
  }

  // Single mode → flat
  if (modeValues.length === 1) {
    return { rootLine: `  ${varName}: ${serializeValue(modeValues[0]!.value)};`, mediaBlocks: [] };
  }

  // Check if all values are identical → emit flat
  const firstVal = modeValues[0]!.value;
  const allEqual = modeValues.every((mv) => mv.value === firstVal);
  if (allEqual) {
    return { rootLine: `  ${varName}: ${serializeValue(firstVal)};`, mediaBlocks: [] };
  }

  if (variable.type === 'number') {
    // Check if ALL modes have width
    const withWidth = modeValues.filter((mv) => typeof mv.mode.width === 'number');
    if (withWidth.length !== modeValues.length) {
      // Some modes missing width → flat using first mode
      return { rootLine: `  ${varName}: ${serializeValue(modeValues[0]!.value)};`, mediaBlocks: [] };
    }

    // All have width → piecewise clamp
    const sorted = [...withWidth].sort((a, b) => (a.mode.width as number) - (b.mode.width as number));
    const unit = unitForScope(variable.scope);

    const rootLine = `  ${varName}: ${serializeValue(sorted[0]!.value)};`;
    const mediaBlocks: string[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i]!;
      const hi = sorted[i + 1]!;
      const loVal = Number(lo.value);
      const hiVal = Number(hi.value);
      const loWidth = lo.mode.width as number;
      const hiWidth = hi.mode.width as number;
      const widthDiff = hiWidth - loWidth;
      const loFmt = unit ? `${loVal}${unit}` : String(loVal);
      const hiFmt = unit ? `${hiVal}${unit}` : String(hiVal);
      mediaBlocks.push(
        `@media (min-width: ${loWidth}px) {\n` +
        `  :root {\n` +
        `    ${varName}: clamp(\n` +
        `      ${loFmt},\n` +
        `      calc(${loFmt} + (${hiVal} - ${loVal}) * ((100vw - ${loWidth}px) / (${widthDiff}))),\n` +
        `      ${hiFmt}\n` +
        `    );\n` +
        `  }\n` +
        `}`,
      );
    }
    return { rootLine, mediaBlocks };
  }

  // string / color / boolean — emit @media steps for modes that have widths
  const withWidth = modeValues.filter((mv) => typeof mv.mode.width === 'number');
  const rootLine = `  ${varName}: ${serializeValue(modeValues[0]!.value)};`;
  const mediaBlocks: string[] = [];

  if (withWidth.length > 0) {
    const sorted = [...withWidth].sort((a, b) => (a.mode.width as number) - (b.mode.width as number));
    for (const mv of sorted) {
      mediaBlocks.push(
        `@media (min-width: ${mv.mode.width}px) {\n` +
        `  :root {\n` +
        `    ${varName}: ${serializeValue(mv.value)};\n` +
        `  }\n` +
        `}`,
      );
    }
  }

  return { rootLine, mediaBlocks };
}

export function renderTokensCss(file: VariablesFile): string {
  const header = '/* Generated from variables.json. Edits made here will be overwritten on next save. */';
  const used = new Set<string>();

  const rootLines: string[] = [];
  const mediaBlocks: string[] = [];

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

        const rendered = renderVariableDecl(name, variable, collection.modes);
        if (!rendered) continue;
        rootLines.push(rendered.rootLine);
        mediaBlocks.push(...rendered.mediaBlocks);
      }
    }
  }

  const parts: string[] = [header, ':root {', ...rootLines, '}'];
  if (mediaBlocks.length > 0) {
    parts.push('');
    parts.push(...mediaBlocks);
  }
  parts.push('');
  return parts.join('\n');
}

function formatValue(variable: Variable): string {
  // Use the first mode's value as the canonical CSS token output.
  // This mirrors legacy single-value behavior and is stable across modes for CSS generation.
  const value = Object.values(variable.valuesByMode)[0];
  if (variable.type === 'color' || variable.type === 'string') {
    return String(value);
  }
  if (variable.type === 'number') {
    return `${Number(value)}px`;
  }
  // boolean → CSS uses 0/1
  return value ? '1' : '0';
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
    const defaultModeId = newModeId();
    return {
      version: 3,
      collections: [
        {
          id: newCollectionId(),
          name: 'Default',
          modes: [{ id: defaultModeId, name: 'Default' }],
          groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
        },
      ],
    };
  }
  // Build a map of collectionName -> (groupName -> { defaultModeId, variables })
  const buckets = new Map<string, { modeId: string; groups: Map<string, Variable[]> }>();
  VAR_RE.lastIndex = 0;
  let match;
  while ((match = VAR_RE.exec(css)) !== null) {
    const rawName = match[1];
    const rawValue = match[2];
    if (rawName === undefined || rawValue === undefined) continue;
    const cls = classifyVariable(rawName, rawValue);
    const coerced = coerceValue(cls.type, cls.rawValue);
    let bucket = buckets.get(cls.collectionName);
    if (!bucket) {
      bucket = { modeId: newModeId(), groups: new Map<string, Variable[]>() };
      buckets.set(cls.collectionName, bucket);
    }
    const variable: Variable = {
      id: newVariableId(),
      name: cls.varName,
      type: cls.type,
      valuesByMode: { [bucket.modeId]: coerced },
    };
    const group = bucket.groups.get(cls.group) ?? [];
    group.push(variable);
    bucket.groups.set(cls.group, group);
  }
  const collections: VariableCollection[] = [];
  for (const [collectionName, bucket] of buckets) {
    const groupArray: VariableGroup[] = [];
    for (const [groupName, variables] of bucket.groups) {
      groupArray.push({ id: newGroupId(), name: groupName, variables });
    }
    collections.push({
      id: newCollectionId(),
      name: collectionName,
      modes: [{ id: bucket.modeId, name: 'Default' }],
      groups: groupArray,
    });
  }
  if (collections.length === 0) {
    const defaultModeId = newModeId();
    collections.push({
      id: newCollectionId(),
      name: 'Default',
      modes: [{ id: defaultModeId, name: 'Default' }],
      groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
    });
  }
  return { version: 3, collections };
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

export class VariablesError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'VariablesError';
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function applyCreateCollection(file: VariablesFile, params: { name: string }): VariablesFile {
  const next = clone(file);
  next.collections.push({
    id: newCollectionId(),
    name: params.name.trim() || 'New collection',
    modes: [{ id: newModeId(), name: 'Default' }],
    groups: [],
  });
  return next;
}

export function applyDeleteCollection(file: VariablesFile, params: { collectionId: string }): VariablesFile {
  const next = clone(file);
  next.collections = next.collections.filter((c) => c.id !== params.collectionId);
  return next;
}

export function applyCreateGroup(file: VariablesFile, params: { collectionId: string; name: string }): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection ${params.collectionId} not found`);
  collection.groups.push({ id: newGroupId(), name: params.name.trim() || 'New group', variables: [] });
  return next;
}

export function applyDeleteGroup(file: VariablesFile, params: { collectionId: string; groupId: string }): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection ${params.collectionId} not found`);
  collection.groups = collection.groups.filter((g) => g.id !== params.groupId);
  return next;
}

export function applyCreateVariable(
  file: VariablesFile,
  params: { collectionId: string; groupId: string; name: string; type: VariableType; valueByDefault: string | number | boolean },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const group = collection.groups.find((g) => g.id === params.groupId);
  if (!group) throw new VariablesError('NOT_FOUND', `group not found: ${params.groupId}`);
  const valuesByMode: Record<string, string | number | boolean> = {};
  for (const mode of collection.modes) valuesByMode[mode.id] = params.valueByDefault;
  group.variables.push({
    id: newVariableId(),
    name: params.name,
    type: params.type,
    valuesByMode,
  });
  return next;
}

export function applyUpdateVariable(
  file: VariablesFile,
  params: { variableId: string; patch: Partial<Pick<Variable, 'name' | 'type'>> & { valuesByMode?: Record<string, string | number | boolean>; value?: string | number | boolean } },
): VariablesFile {
  const next = clone(file);
  for (const collection of next.collections) {
    for (const group of collection.groups) {
      const variable = group.variables.find((v) => v.id === params.variableId);
      if (!variable) continue;
      if (typeof params.patch.name === 'string') variable.name = params.patch.name;
      if (params.patch.type) variable.type = params.patch.type;
      if (params.patch.valuesByMode) {
        variable.valuesByMode = { ...variable.valuesByMode, ...params.patch.valuesByMode };
      }
      if (params.patch.value !== undefined && collection.modes[0]) {
        // Legacy single-value payload routes to the first mode.
        variable.valuesByMode = { ...variable.valuesByMode, [collection.modes[0].id]: params.patch.value };
      }
      return next;
    }
  }
  throw new VariablesError('NOT_FOUND', `variable not found: ${params.variableId}`);
}

export function applyDeleteVariable(file: VariablesFile, params: { variableId: string }): VariablesFile {
  const next = clone(file);
  for (const collection of next.collections) {
    for (const group of collection.groups) {
      group.variables = group.variables.filter((v) => v.id !== params.variableId);
    }
  }
  return next;
}

export function defaultForType(type: VariableType): string | number | boolean {
  switch (type) {
    case 'color': return '#000000';
    case 'number': return 0;
    case 'string': return '';
    case 'boolean': return false;
  }
}

export function applyCreateMode(
  file: VariablesFile,
  params: { collectionId: string; name: string; width?: number },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const trimmed = params.name.trim();
  if (!trimmed) throw new VariablesError('BAD_REQUEST', 'mode name required');
  if (collection.modes.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new VariablesError('CONFLICT', `mode name already exists: ${trimmed}`);
  }
  const previousLast = collection.modes[collection.modes.length - 1];
  const mode: Mode = { id: newModeId(), name: trimmed };
  if (typeof params.width === 'number' && Number.isFinite(params.width)) mode.width = params.width;
  collection.modes.push(mode);
  // Seed every variable with the previous-last-mode value as the starting point.
  for (const group of collection.groups) {
    for (const variable of group.variables) {
      const seed = (previousLast ? variable.valuesByMode[previousLast.id] : undefined) ?? defaultForType(variable.type);
      variable.valuesByMode = { ...variable.valuesByMode, [mode.id]: seed };
    }
  }
  return next;
}

export function applyUpdateMode(
  file: VariablesFile,
  params: { collectionId: string; modeId: string; patch: Partial<Pick<Mode, 'name' | 'width'>> },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const mode = collection.modes.find((m) => m.id === params.modeId);
  if (!mode) throw new VariablesError('NOT_FOUND', `mode not found: ${params.modeId}`);
  if (typeof params.patch.name === 'string') {
    const trimmed = params.patch.name.trim();
    if (!trimmed) throw new VariablesError('BAD_REQUEST', 'mode name required');
    if (collection.modes.some((m) => m.id !== mode.id && m.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new VariablesError('CONFLICT', `mode name already exists: ${trimmed}`);
    }
    mode.name = trimmed;
  }
  if (params.patch.width !== undefined) {
    if (params.patch.width === null) delete (mode as any).width;
    else mode.width = params.patch.width;
  }
  return next;
}

export function applyDeleteMode(
  file: VariablesFile,
  params: { collectionId: string; modeId: string },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  if (collection.modes.length <= 1) {
    throw new VariablesError('BAD_REQUEST', 'cannot delete the last mode');
  }
  const idx = collection.modes.findIndex((m) => m.id === params.modeId);
  if (idx === -1) throw new VariablesError('NOT_FOUND', `mode not found: ${params.modeId}`);
  collection.modes.splice(idx, 1);
  for (const group of collection.groups) {
    for (const variable of group.variables) {
      const { [params.modeId]: _drop, ...rest } = variable.valuesByMode;
      variable.valuesByMode = rest;
    }
  }
  return next;
}
