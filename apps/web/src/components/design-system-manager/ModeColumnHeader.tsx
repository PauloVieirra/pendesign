import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { Mode } from '../../providers/design-system-variables';

interface Props {
  mode: Mode;
  canDelete: boolean;
  onRename: (name: string) => Promise<void> | void;
  onSetWidth: (width: number | null) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function ModeColumnHeader({ mode, canDelete, onRename, onSetWidth, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(mode.name);
  const [width, setWidth] = useState<string>(mode.width != null ? String(mode.width) : '');
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setName(mode.name); setWidth(mode.width != null ? String(mode.width) : ''); }, [mode]);
  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) void commitAndClose(); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, width]);

  async function commitAndClose() {
    if (name.trim() && name.trim() !== mode.name) await onRename(name.trim());
    const next = width.trim() === '' ? null : Number(width);
    if (next !== (mode.width ?? null)) await onSetWidth(next);
    setOpen(false);
  }

  return (
    <div className="ds-col-header" ref={wrap}>
      <button type="button" className="ds-col-header__btn" onClick={() => setOpen((v) => !v)} data-testid={`ds-mode-header-${mode.name}`}>
        <span className="ds-col-header__name">{mode.name}</span>
        {mode.width != null ? <span className="ds-col-header__width">{mode.width}</span> : null}
      </button>
      {open ? (
        <div className="ds-col-header__popover" role="menu">
          <label className="ds-col-header__field">
            <span>Name</span>
            <input value={name} onChange={(ev) => setName(ev.target.value)} autoFocus />
          </label>
          <label className="ds-col-header__field">
            <span>Width (px)</span>
            <input value={width} onChange={(ev) => setWidth(ev.target.value)} inputMode="numeric" />
          </label>
          <div className="ds-col-header__actions">
            <button type="button" disabled={!canDelete} onClick={async () => { await onDelete(); setOpen(false); }} className="danger">
              <Icon name="trash" size={12} /> Delete column
            </button>
            <button type="button" onClick={() => void commitAndClose()}>Save</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
