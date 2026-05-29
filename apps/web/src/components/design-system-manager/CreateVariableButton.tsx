import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { VariableType } from '../../providers/design-system-variables';

const ITEMS: Array<{ type: VariableType; label: string; icon: 'color' | 'hash' | 'text' | 'circle' }> = [
  { type: 'color', label: 'Color', icon: 'color' },
  { type: 'number', label: 'Number', icon: 'hash' },
  { type: 'string', label: 'String', icon: 'text' },
  { type: 'boolean', label: 'Boolean', icon: 'circle' },
];

interface Props {
  onCreate: (type: VariableType) => void;
  disabled?: boolean;
}

export function CreateVariableButton({ onCreate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ds-create-var" ref={wrap}>
      <button type="button" className="ds-create-var__btn" onClick={() => setOpen((v) => !v)} disabled={disabled} data-testid="ds-create-variable">
        <Icon name="plus" size={12} /> Create variable
      </button>
      {open ? (
        <div className="ds-create-var__popover" role="menu">
          {ITEMS.map((item) => (
            <button key={item.type} type="button" className="ds-create-var__item" onClick={() => { onCreate(item.type); setOpen(false); }}>
              <Icon name={item.icon} size={12} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
