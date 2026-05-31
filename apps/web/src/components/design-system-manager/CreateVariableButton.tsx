import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import type { VariableType } from '../../providers/design-system-variables';

interface Props {
  onCreate: (type: VariableType) => void;
  disabled?: boolean;
}

export function CreateVariableButton({ onCreate, disabled }: Props) {
  const t = useT();
  const ITEMS: Array<{ type: VariableType; icon: 'color' | 'hash' | 'text' | 'circle' }> = [
    { type: 'color', icon: 'color' },
    { type: 'number', icon: 'hash' },
    { type: 'string', icon: 'text' },
    { type: 'boolean', icon: 'circle' },
  ];
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
        <Icon name="plus" size={12} /> {t('ds.modal.createVariable')}
      </button>
      {open ? (
        <div className="ds-create-var__popover" role="menu">
          {ITEMS.map((item) => (
            <button key={item.type} type="button" className="ds-create-var__item" onClick={() => { onCreate(item.type); setOpen(false); }}>
              <Icon name={item.icon} size={12} />
              <span>{t(`ds.types.${item.type}` as 'ds.types.color' | 'ds.types.number' | 'ds.types.string' | 'ds.types.boolean')}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
