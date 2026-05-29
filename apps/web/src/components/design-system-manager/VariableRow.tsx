import { useState } from 'react';
import { Icon } from '../Icon';
import type { Mode, Variable } from '../../providers/design-system-variables';

interface Props {
  variable: Variable;
  modes: Mode[];
  onChangeValueForMode: (modeId: string, value: string | number | boolean) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function VariableRow({ variable, modes, onChangeValueForMode, onRename, onDelete }: Props) {
  const [name, setName] = useState(variable.name);
  return (
    <div className="ds-row" data-testid={`ds-row-${variable.name}`}>
      <div className="ds-row__name">
        <Icon name={iconForType(variable.type)} size={12} />
        <input
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== variable.name) onRename(name.trim()); else setName(variable.name); }}
          onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
        />
      </div>
      {modes.map((mode) => (
        <ValueCell
          key={mode.id}
          type={variable.type}
          value={variable.valuesByMode[mode.id]}
          onCommit={(v) => onChangeValueForMode(mode.id, v)}
        />
      ))}
      <button type="button" className="ds-row__delete" onClick={onDelete} aria-label={`Delete ${variable.name}`}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

function ValueCell({ type, value, onCommit }: { type: Variable['type']; value: string | number | boolean | undefined; onCommit: (v: string | number | boolean) => void }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value));
  if (type === 'boolean') {
    const on = value === true;
    return (
      <button type="button" className="ds-cell ds-cell--bool" onClick={() => onCommit(!on)}>{on ? 'true' : 'false'}</button>
    );
  }
  return (
    <input
      className="ds-cell"
      value={raw}
      onChange={(ev) => setRaw(ev.target.value)}
      onBlur={() => commit(raw, type, onCommit)}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
    />
  );
}

function commit(raw: string, type: Variable['type'], onCommit: (v: string | number | boolean) => void) {
  if (type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onCommit(n);
    return;
  }
  if (type === 'color' || type === 'string') {
    onCommit(raw);
    return;
  }
}

function iconForType(type: Variable['type']): 'color' | 'hash' | 'text' | 'circle' {
  switch (type) {
    case 'color': return 'color';
    case 'number': return 'hash';
    case 'string': return 'text';
    case 'boolean': return 'circle';
  }
}
