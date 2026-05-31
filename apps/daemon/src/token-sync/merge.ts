import {
  newCollectionId,
  newGroupId,
  newModeId,
  newVariableId,
  type Mode,
  type VariableCollection,
  type VariableGroup,
  type VariablesFile,
} from '../design-system-variables.js';
import type { ExtractedToken, ExtractedTokens } from './types.js';

function slugFont(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function colorVarName(hex: string): string {
  return 'color-' + hex.replace(/^#/, '');
}

function findCollection(file: VariablesFile, name: string): VariableCollection | undefined {
  return file.collections.find((c) => c.name === name);
}

function ensureCollection(file: VariablesFile, name: string, modeNames: string[]): VariableCollection {
  let c = findCollection(file, name);
  if (c) return c;
  const modes: Mode[] = modeNames.map((n) => ({ id: newModeId(), name: n }));
  c = { id: newCollectionId(), name, modes, groups: [] };
  file.collections.push(c);
  return c;
}

function ensureGroup(collection: VariableCollection, groupName: string): VariableGroup {
  let g = collection.groups.find((x) => x.name === groupName);
  if (g) return g;
  g = { id: newGroupId(), name: groupName, variables: [] };
  collection.groups.push(g);
  return g;
}

/**
 * Check whether a value already exists anywhere in the DS for a given variable type.
 * Colors and strings are deduped across the entire DS (type-scoped).
 * Numbers are deduped within the target collection only to avoid false collisions
 * between unrelated numeric contexts (e.g. grid column count vs spacing px).
 */
function valueExistsInCollection(
  collection: VariableCollection,
  value: number,
): boolean {
  for (const g of collection.groups) {
    for (const v of g.variables) {
      if (v.type !== 'number') continue;
      if (Object.values(v.valuesByMode).some((mv) => mv === value)) return true;
    }
  }
  return false;
}

function colorValueExistsAnywhere(file: VariablesFile, value: string): boolean {
  for (const c of file.collections) {
    for (const g of c.groups) {
      for (const v of g.variables) {
        if (v.type !== 'color') continue;
        if (Object.values(v.valuesByMode).some((mv) => mv === value)) return true;
      }
    }
  }
  return false;
}

function stringValueExistsAnywhere(file: VariablesFile, value: string): boolean {
  for (const c of file.collections) {
    for (const g of c.groups) {
      for (const v of g.variables) {
        if (v.type !== 'string') continue;
        if (Object.values(v.valuesByMode).some((mv) => mv === value)) return true;
      }
    }
  }
  return false;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function mergeNumericTokens(
  next: VariablesFile,
  tokens: ExtractedToken<number>[],
  collectionName: string,
  modeNames: string[],
  groupName: string,
  namePrefix: string,
): void {
  if (tokens.length === 0) return;
  const c = ensureCollection(next, collectionName, modeNames);
  const g = ensureGroup(c, groupName);
  for (const t of tokens) {
    if (valueExistsInCollection(c, t.value)) continue;
    const valuesByMode: Record<string, number> = {};
    for (const m of c.modes) valuesByMode[m.id] = t.value;
    g.variables.push({
      id: newVariableId(),
      name: namePrefix + t.value,
      type: 'number',
      valuesByMode,
      scope: t.scope,
    });
  }
}

export function mergeExtractedIntoDs(file: VariablesFile, tokens: ExtractedTokens): VariablesFile {
  const next = clone(file);

  // Colors → Cores/Extracted
  if (tokens.colors.length > 0) {
    const c = ensureCollection(next, 'Cores', ['Default']);
    const g = ensureGroup(c, 'Extracted');
    for (const t of tokens.colors) {
      if (colorValueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, string> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: colorVarName(t.value),
        type: 'color',
        valuesByMode,
        scope: t.scope,
      });
    }
  }

  // Fonts → Typography/Font Family
  if (tokens.fonts.length > 0) {
    const c = ensureCollection(next, 'Typography', ['Desktop', 'Tablet', 'Mobile']);
    const g = ensureGroup(c, 'Font Family');
    for (const t of tokens.fonts) {
      if (stringValueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, string> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: 'font-' + slugFont(t.value),
        type: 'string',
        valuesByMode,
        scope: t.scope,
      });
    }
  }

  // Sizes → Typography/Detected sizes
  mergeNumericTokens(next, tokens.sizes, 'Typography', ['Desktop', 'Tablet', 'Mobile'], 'Detected sizes', 'size-');

  // Spacing → Spacing/Detected spacing
  mergeNumericTokens(next, tokens.spacing, 'Spacing', ['Default'], 'Detected spacing', 'space-');

  // Border Radius → Border Radius/Detected
  mergeNumericTokens(next, tokens.borderRadii, 'Border Radius', ['Default'], 'Detected', 'radius-');

  // Border Width → Border Width/Detected
  mergeNumericTokens(next, tokens.borderWidths, 'Border Width', ['Default'], 'Detected', 'border-');

  return next;
}
