import {
  newCollectionId, newGroupId, newModeId, newVariableId,
  type VariablesFile, type VariableCollection, type Variable,
} from './design-system-variables.js';

type SeedSpec = {
  collectionName: string;
  modes: Array<{ name: string; width?: number }>;
  groups: Array<{
    groupName: string;
    variables: Array<{ name: string; type: Variable['type']; values: Array<string | number | boolean> }>;
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
      variables: [{ name: 'Resolução', type: 'number', values: [1440, 834, 412] }],
    }],
  },
  {
    collectionName: 'Grid',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [{
      groupName: 'Layout',
      variables: [
        { name: 'Columns', type: 'number', values: [12, 8, 5] },
        { name: 'Margin', type: 'number', values: [48, 24, 16] },
        { name: 'Gutter', type: 'number', values: [24, 16, 16] },
      ],
    }],
  },
  {
    collectionName: 'Typography',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [
      {
        groupName: 'Font Family',
        variables: [{ name: 'Font Family', type: 'string', values: ['Inter', 'Inter', 'Inter'] }],
      },
      {
        groupName: 'Size',
        variables: [
          { name: 'Display 1', type: 'number', values: [68, 60, 52] },
          { name: 'Display 2', type: 'number', values: [60, 52, 44] },
          { name: 'H1', type: 'number', values: [48, 40, 32] },
          { name: 'H2', type: 'number', values: [40, 32, 28] },
          { name: 'H3', type: 'number', values: [32, 28, 24] },
          { name: 'H4', type: 'number', values: [28, 24, 20] },
          { name: 'H5', type: 'number', values: [24, 20, 20] },
          { name: 'H6', type: 'number', values: [16, 16, 16] },
        ],
      },
      {
        groupName: 'Weight',
        variables: [
          { name: 'Regular', type: 'number', values: [400, 400, 400] },
          { name: 'Medium', type: 'number', values: [500, 500, 500] },
          { name: 'Bold', type: 'number', values: [700, 700, 700] },
        ],
      },
    ],
  },
  { collectionName: 'Cores', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Spacing', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Style', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Controle', modes: [{ name: 'Default' }], groups: [] },
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
          return { id: newVariableId(), name: v.name, type: v.type, valuesByMode };
        }),
      })),
    };
  });
  return { version: 2, collections };
}
