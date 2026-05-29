import { useMemo } from 'react';
import type { Variable, VariableCollection, VariableType } from '../../providers/design-system-variables';
import { VariableRow } from './VariableRow';
import { ModeColumnHeader } from './ModeColumnHeader';
import { AddModeButton } from './AddModeButton';
import { CreateVariableButton } from './CreateVariableButton';

interface Props {
  collection: VariableCollection;
  activeGroupId: string | 'all';
  query: string;
  typeFilter: Set<VariableType>;
  onUpdateVariableValueForMode: (variableId: string, modeId: string, value: string | number | boolean) => void;
  onRenameVariable: (variableId: string, name: string) => void;
  onDeleteVariable: (variableId: string) => void;
  onCreateVariable: (groupId: string, body: { name: string; type: VariableType }) => void;
  onCreateMode: (body: { name: string; width?: number }) => void;
  onRenameMode: (modeId: string, name: string) => void;
  onSetModeWidth: (modeId: string, width: number | null) => void;
  onDeleteMode: (modeId: string) => void;
}

export function VariablesTable({
  collection, activeGroupId, query, typeFilter,
  onUpdateVariableValueForMode, onRenameVariable, onDeleteVariable, onCreateVariable,
  onCreateMode, onRenameMode, onSetModeWidth, onDeleteMode,
}: Props) {
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return collection.groups
      .filter((g) => activeGroupId === 'all' || g.id === activeGroupId)
      .map((g) => ({
        ...g,
        variables: g.variables.filter((v) => {
          if (q && !v.name.toLowerCase().includes(q)) return false;
          if (typeFilter.size > 0 && !typeFilter.has(v.type)) return false;
          return true;
        }),
      }))
      .filter((g) => g.variables.length > 0 || (activeGroupId === 'all' && !q && typeFilter.size === 0));
  }, [collection.groups, activeGroupId, query, typeFilter]);

  const gridTemplate = `minmax(160px, 1.5fr) repeat(${collection.modes.length}, minmax(80px, 1fr)) 32px 32px`;
  const targetGroupForCreate = activeGroupId !== 'all'
    ? collection.groups.find((g) => g.id === activeGroupId) ?? collection.groups[0]
    : collection.groups[0];

  return (
    <section className="ds-table" style={{ ['--ds-grid' as any]: gridTemplate }}>
      <div className="ds-table__head">
        <div className="ds-table__th">Name</div>
        {collection.modes.map((mode) => (
          <ModeColumnHeader
            key={mode.id}
            mode={mode}
            canDelete={collection.modes.length > 1}
            onRename={(name) => onRenameMode(mode.id, name)}
            onSetWidth={(w) => onSetModeWidth(mode.id, w)}
            onDelete={() => onDeleteMode(mode.id)}
          />
        ))}
        <AddModeButton onCreate={onCreateMode} disabled={collection.modes.length >= 8} />
        <div /> {/* spacer for delete column */}
      </div>
      <div className="ds-table__body">
        {filteredGroups.length === 0 ? (
          <p className="ds-table__empty">No variables match the filter.</p>
        ) : null}
        {filteredGroups.map((g) => (
          <div key={g.id} className="ds-group">
            <header className="ds-group__head">{g.name}</header>
            {g.variables.map((v) => (
              <VariableRow
                key={v.id}
                variable={v}
                modes={collection.modes}
                onChangeValueForMode={(mid, value) => onUpdateVariableValueForMode(v.id, mid, value)}
                onRename={(name) => onRenameVariable(v.id, name)}
                onDelete={() => onDeleteVariable(v.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <CreateVariableButton
        disabled={!targetGroupForCreate}
        onCreate={(type) => {
          if (!targetGroupForCreate) return;
          onCreateVariable(targetGroupForCreate.id, { name: 'New variable', type });
        }}
      />
    </section>
  );
}
