import { useState } from 'react';
import type { Variable, VariableCollection, VariableType } from '../../providers/design-system-variables';
import { Icon } from '../Icon';
import { VariableRow } from './VariableRow';

interface Props {
  collection: VariableCollection;
  onUpdateVariable: (variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) => void;
  onDeleteVariable: (variableId: string) => void;
  onCreateVariable: (groupId: string, body: { name: string; type: VariableType; value: Variable['value'] }) => void;
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (groupId: string) => void;
}

export function VariablesTable({
  collection,
  onUpdateVariable,
  onDeleteVariable,
  onCreateVariable,
  onCreateGroup,
  onDeleteGroup,
}: Props) {
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');

  function commitGroup() {
    setCreatingGroup(false);
    if (groupDraft.trim()) onCreateGroup(groupDraft.trim());
    setGroupDraft('');
  }

  return (
    <section className="ds-mgr-table">
      <header className="ds-mgr-table__head">
        <h2>{collection.name}</h2>
        <button type="button" onClick={() => setCreatingGroup(true)}>
          <Icon name="plus" size={13} /> New group
        </button>
      </header>
      {creatingGroup ? (
        <div className="ds-mgr-table__group-input">
          <input
            autoFocus
            type="text"
            value={groupDraft}
            onChange={(ev) => setGroupDraft(ev.target.value)}
            onBlur={commitGroup}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') commitGroup();
              if (ev.key === 'Escape') { setCreatingGroup(false); setGroupDraft(''); }
            }}
            placeholder="Group name"
          />
        </div>
      ) : null}
      {collection.groups.map((group) => (
        <GroupBlock
          key={group.id}
          collectionId={collection.id}
          groupId={group.id}
          groupName={group.name}
          variables={group.variables}
          onUpdateVariable={onUpdateVariable}
          onDeleteVariable={onDeleteVariable}
          onCreateVariable={(body) => onCreateVariable(group.id, body)}
          onDeleteGroup={() => onDeleteGroup(group.id)}
        />
      ))}
    </section>
  );
}

interface GroupBlockProps {
  collectionId: string;
  groupId: string;
  groupName: string;
  variables: Variable[];
  onUpdateVariable: Props['onUpdateVariable'];
  onDeleteVariable: Props['onDeleteVariable'];
  onCreateVariable: (body: { name: string; type: VariableType; value: Variable['value'] }) => void;
  onDeleteGroup: () => void;
}

function GroupBlock({
  groupName,
  variables,
  onUpdateVariable,
  onDeleteVariable,
  onCreateVariable,
  onDeleteGroup,
}: GroupBlockProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'color' as VariableType });

  function commit() {
    setAdding(false);
    if (!draft.name.trim()) return;
    const defaultValue: Variable['value'] =
      draft.type === 'color' ? '#000000'
      : draft.type === 'number' ? 0
      : draft.type === 'boolean' ? false
      : '';
    onCreateVariable({ name: draft.name.trim(), type: draft.type, value: defaultValue });
    setDraft({ name: '', type: 'color' });
  }

  return (
    <div className="ds-mgr-group">
      <header>
        <h3>{groupName}</h3>
        <button type="button" className="ghost" onClick={onDeleteGroup} aria-label={`Delete ${groupName}`}>
          <Icon name="trash" size={12} />
        </button>
      </header>
      <table>
        <thead>
          <tr><th>Name</th><th>Value</th><th>Type</th><th></th></tr>
        </thead>
        <tbody>
          {variables.map((variable) => (
            <VariableRow
              key={variable.id}
              variable={variable}
              onChangeValue={(value) => onUpdateVariable(variable.id, { value })}
              onRename={(name) => onUpdateVariable(variable.id, { name })}
              onChangeType={(type) => onUpdateVariable(variable.id, { type })}
              onDelete={() => onDeleteVariable(variable.id)}
            />
          ))}
          {adding ? (
            <tr>
              <td>
                <input
                  autoFocus
                  type="text"
                  value={draft.name}
                  onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') commit();
                    if (ev.key === 'Escape') { setAdding(false); setDraft({ name: '', type: 'color' }); }
                  }}
                  placeholder="Variable name"
                />
              </td>
              <td></td>
              <td>
                <select
                  value={draft.type}
                  onChange={(ev) => setDraft((d) => ({ ...d, type: ev.target.value as VariableType }))}
                >
                  <option value="color">color</option>
                  <option value="number">number</option>
                  <option value="string">string</option>
                  <option value="boolean">boolean</option>
                </select>
              </td>
              <td>
                <button type="button" onClick={commit}>Add</button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {!adding ? (
        <button type="button" className="ghost ds-mgr-group__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Create variable
        </button>
      ) : null}
    </div>
  );
}
