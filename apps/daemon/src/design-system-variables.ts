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
