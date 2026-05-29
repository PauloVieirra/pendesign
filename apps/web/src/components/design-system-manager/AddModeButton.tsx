import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

interface Props {
  onCreate: (body: { name: string; width?: number }) => Promise<void> | void;
  disabled?: boolean;
}

export function AddModeButton({ onCreate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function commit() {
    if (!name.trim()) return;
    const body: { name: string; width?: number } = { name: name.trim() };
    if (width.trim()) body.width = Number(width);
    await onCreate(body);
    setName(''); setWidth(''); setOpen(false);
  }

  return (
    <div className="ds-add-mode" ref={wrap}>
      <button type="button" className="ds-add-mode__btn" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-label="Add column" data-testid="ds-add-mode">
        <Icon name="plus" size={12} />
      </button>
      {open ? (
        <div className="ds-add-mode__popover" role="menu">
          <label><span>Name</span><input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} /></label>
          <label><span>Width (px)</span><input value={width} onChange={(ev) => setWidth(ev.target.value)} inputMode="numeric" /></label>
          <div className="ds-add-mode__actions"><button type="button" onClick={() => void commit()}>Add</button></div>
        </div>
      ) : null}
    </div>
  );
}
