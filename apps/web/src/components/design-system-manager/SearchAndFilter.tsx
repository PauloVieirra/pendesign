import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import type { VariableType } from '../../providers/design-system-variables';

const ALL_TYPES: VariableType[] = ['color', 'number', 'string', 'boolean'];

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  typeFilter: Set<VariableType>;
  onTypeFilterChange: (next: Set<VariableType>) => void;
}

export function SearchAndFilter({ query, onQueryChange, typeFilter, onTypeFilterChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggleType(t: VariableType) {
    const next = new Set(typeFilter);
    if (next.has(t)) next.delete(t); else next.add(t);
    onTypeFilterChange(next);
  }

  return (
    <div className="ds-search-filter" ref={wrap}>
      <label className="ds-search">
        <Icon name="search" size={12} />
        <input
          type="search"
          value={query}
          onChange={(ev) => onQueryChange(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Escape' && query) { ev.stopPropagation(); onQueryChange(''); } }}
          placeholder={t('ds.modal.search')}
          data-testid="ds-search-input"
        />
      </label>
      <button
        type="button"
        className={`ds-filter-btn${typeFilter.size > 0 ? ' has-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('ds.modal.filter')}
      >
        <Icon name="filter" size={12} />
        {typeFilter.size > 0 ? <span className="ds-filter-btn__badge">{typeFilter.size}</span> : null}
      </button>
      {open ? (
        <div className="ds-filter-popover" role="menu">
          {ALL_TYPES.map((t) => (
            <label key={t} className={`ds-filter-chip${typeFilter.has(t) ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={typeFilter.has(t)}
                onChange={() => toggleType(t)}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
