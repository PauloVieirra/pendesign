import { useState } from 'react';
import type { Variable, VariableType } from '../../providers/design-system-variables';
import { Icon } from '../Icon';
import {
  BooleanEditor,
  ColorEditor,
  NumberEditor,
  StringEditor,
} from './VariableEditors';

interface Props {
  variable: Variable;
  onChangeValue: (next: Variable['value']) => void;
  onRename: (nextName: string) => void;
  onChangeType: (nextType: VariableType) => void;
  onDelete: () => void;
}

export function VariableRow({
  variable,
  onChangeValue,
  onRename,
  onChangeType,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(variable.name);

  function commitRename() {
    setRenaming(false);
    if (draftName.trim() && draftName !== variable.name) onRename(draftName.trim());
    else setDraftName(variable.name);
  }

  return (
    <tr className="ds-mgr-row" data-testid={`ds-mgr-var-${variable.id}`}>
      <td className="ds-mgr-row__name">
        {renaming ? (
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(ev) => setDraftName(ev.target.value)}
            onBlur={commitRename}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') commitRename();
              if (ev.key === 'Escape') { setRenaming(false); setDraftName(variable.name); }
            }}
          />
        ) : (
          <button type="button" className="ds-mgr-row__name-btn" onClick={() => setRenaming(true)}>
            {variable.name}
          </button>
        )}
      </td>
      <td className="ds-mgr-row__value">
        {variable.type === 'color' ? (
          <ColorEditor value={String(variable.value)} onChange={onChangeValue} />
        ) : variable.type === 'number' ? (
          <NumberEditor value={Number(variable.value)} onChange={onChangeValue} />
        ) : variable.type === 'string' ? (
          <StringEditor value={String(variable.value)} onChange={onChangeValue} />
        ) : (
          <BooleanEditor value={Boolean(variable.value)} onChange={onChangeValue} />
        )}
      </td>
      <td className="ds-mgr-row__type">
        <select value={variable.type} onChange={(ev) => onChangeType(ev.target.value as VariableType)}>
          <option value="color">color</option>
          <option value="number">number</option>
          <option value="string">string</option>
          <option value="boolean">boolean</option>
        </select>
      </td>
      <td className="ds-mgr-row__actions">
        <button type="button" className="ghost" onClick={onDelete} aria-label={`Delete ${variable.name}`}>
          <Icon name="trash" size={13} />
        </button>
      </td>
    </tr>
  );
}
