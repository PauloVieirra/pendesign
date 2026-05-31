import {
  newCollectionId, newGroupId, newModeId, newVariableId,
  type VariablesFile, type VariableCollection, type Variable, type VariableScope,
} from './design-system-variables.js';

type SeedSpec = {
  collectionName: string;
  modes: Array<{ name: string; width?: number }>;
  groups: Array<{
    groupName: string;
    variables: Array<{ name: string; type: Variable['type']; values: Array<string | number | boolean>; scope: VariableScope }>;
  }>;
};

const DESKTOP_TABLET_MOBILE: SeedSpec['modes'] = [
  { name: 'Desktop', width: 1440 },
  { name: 'Tablet', width: 834 },
  { name: 'Mobile', width: 412 },
];

const SEED_SPEC: SeedSpec[] = [
  {
    collectionName: 'Container Size',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [{
      groupName: 'Resolução',
      variables: [{ name: 'Resolução', type: 'number', values: [1440, 834, 412], scope: 'width' }],
    }],
  },
  {
    collectionName: 'Grid',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [{
      groupName: 'Layout',
      variables: [
        { name: 'Columns', type: 'number', values: [12, 8, 5], scope: null },
        { name: 'Margin', type: 'number', values: [48, 24, 16], scope: 'margin' },
        { name: 'Gutter', type: 'number', values: [24, 16, 16], scope: 'gap' },
      ],
    }],
  },
  {
    collectionName: 'Typography',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [
      {
        groupName: 'Font Family',
        variables: [{ name: 'Font Family', type: 'string', values: ['Inter', 'Inter', 'Inter'], scope: 'font-family' }],
      },
      {
        groupName: 'Size',
        variables: [
          { name: 'Display 1', type: 'number', values: [68, 60, 52], scope: 'font-size' },
          { name: 'Display 2', type: 'number', values: [60, 52, 44], scope: 'font-size' },
          { name: 'H1', type: 'number', values: [48, 40, 32], scope: 'font-size' },
          { name: 'H2', type: 'number', values: [40, 32, 28], scope: 'font-size' },
          { name: 'H3', type: 'number', values: [32, 28, 24], scope: 'font-size' },
          { name: 'H4', type: 'number', values: [28, 24, 20], scope: 'font-size' },
          { name: 'H5', type: 'number', values: [24, 20, 20], scope: 'font-size' },
          { name: 'H6', type: 'number', values: [16, 16, 16], scope: 'font-size' },
        ],
      },
      {
        groupName: 'Weight',
        variables: [
          { name: 'Regular', type: 'number', values: [400, 400, 400], scope: 'font-weight' },
          { name: 'Medium', type: 'number', values: [500, 500, 500], scope: 'font-weight' },
          { name: 'Bold', type: 'number', values: [700, 700, 700], scope: 'font-weight' },
        ],
      },
    ],
  },
  { collectionName: 'Cores', modes: [{ name: 'Default' }], groups: [] },
  {
    collectionName: 'Spacing',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [
      {
        groupName: 'Padding',
        variables: [
          { name: 'xs', type: 'number', values: [8, 6, 4], scope: 'padding' },
          { name: 'sm', type: 'number', values: [12, 10, 8], scope: 'padding' },
          { name: 'md', type: 'number', values: [16, 14, 12], scope: 'padding' },
          { name: 'lg', type: 'number', values: [24, 20, 16], scope: 'padding' },
          { name: 'xl', type: 'number', values: [32, 28, 24], scope: 'padding' },
          { name: '2xl', type: 'number', values: [48, 40, 32], scope: 'padding' },
          { name: '3xl', type: 'number', values: [64, 56, 48], scope: 'padding' },
          { name: '4xl', type: 'number', values: [96, 80, 64], scope: 'padding' },
        ],
      },
      {
        groupName: 'Margin',
        variables: [
          { name: 'xs', type: 'number', values: [8, 6, 4], scope: 'margin' },
          { name: 'sm', type: 'number', values: [12, 10, 8], scope: 'margin' },
          { name: 'md', type: 'number', values: [16, 14, 12], scope: 'margin' },
          { name: 'lg', type: 'number', values: [24, 20, 16], scope: 'margin' },
          { name: 'xl', type: 'number', values: [32, 28, 24], scope: 'margin' },
          { name: '2xl', type: 'number', values: [48, 40, 32], scope: 'margin' },
          { name: '3xl', type: 'number', values: [64, 56, 48], scope: 'margin' },
          { name: '4xl', type: 'number', values: [96, 80, 64], scope: 'margin' },
        ],
      },
    ],
  },
];

export function buildSeededVariablesFile(): VariablesFile {
  const collections: VariableCollection[] = SEED_SPEC.map((spec) => {
    const modes = spec.modes.map((m) => ({ id: newModeId(), name: m.name, ...(m.width != null ? { width: m.width } : {}) }));
    return {
      id: newCollectionId(),
      name: spec.collectionName,
      modes,
      groups: spec.groups.map((g) => ({
        id: newGroupId(),
        name: g.groupName,
        variables: g.variables.map((v) => {
          const valuesByMode: Record<string, string | number | boolean> = {};
          modes.forEach((mode, i) => { valuesByMode[mode.id] = v.values[i] ?? v.values[v.values.length - 1] as string | number | boolean; });
          return { id: newVariableId(), name: v.name, type: v.type, valuesByMode, scope: v.scope };
        }),
      })),
    };
  });
  return { version: 3, collections };
}
