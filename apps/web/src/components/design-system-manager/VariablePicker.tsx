import { useEffect, useRef, useState } from 'react';
import type { Variable, VariableType, VariablesFile } from '../../providers/design-system-variables';
import { Icon } from '../Icon';

interface Props {
  variables: VariablesFile | null;
  filterType?: VariableType;
  onPick: (slug: string, variable: Variable) => void;
  /** Render the trigger as a small inline button. */
  ariaLabel?: string;
}

/**
 * Returns the CSS variable name (slug) for a variable, matching the
 * daemon's renderTokensCss naming: --<collection>-<group>-<name>.
 */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
function varSlugFor(variable: Variable, collectionName: string, groupName: string): string {
  return `--${slugify(collectionName)}-${slugify(groupName)}-${slugify(variable.name)}`;
}

export function VariablePicker({ variables, filterType, onPick, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const matches: Array<{ slug: string; variable: Variable; collectionName: string; groupName: string }> = [];
  if (variables) {
    const q = query.trim().toLowerCase();
    for (const collection of variables.collections) {
      for (const group of collection.groups) {
        for (const variable of group.variables) {
          if (filterType && variable.type !== filterType) continue;
          const slug = varSlugFor(variable, collection.name, group.name);
          if (q && !variable.name.toLowerCase().includes(q)
              && !slug.includes(q)) continue;
          matches.push({ slug, variable, collectionName: collection.name, groupName: group.name });
          if (matches.length >= 60) break;
        }
      }
    }
  }

  return (
    <span className="ds-var-picker" ref={wrapRef}>
      <button
        type="button"
        className="ds-var-picker__trigger"
        aria-label={ariaLabel ?? 'Pick design system variable'}
        title="Bind to design system variable"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="link" size={11} />
      </button>
      {open ? (
        <div className="ds-var-picker__popover" role="dialog">
          <input
            type="search"
            className="ds-var-picker__search"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Search variable…"
            autoFocus
          />
          <ul className="ds-var-picker__list">
            {!variables ? (
              <li className="ds-var-picker__empty">Loading…</li>
            ) : matches.length === 0 ? (
              <li className="ds-var-picker__empty">No variables found.</li>
            ) : matches.map((m) => (
              <li key={m.variable.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(m.slug, m.variable);
                    setOpen(false);
                  }}
                >
                  {m.variable.type === 'color' ? (
                    <span className="ds-var-picker__swatch" style={{ background: String(m.variable.value) }} />
                  ) : (
                    <span className="ds-var-picker__type">{m.variable.type}</span>
                  )}
                  <span className="ds-var-picker__label">
                    {m.collectionName}/{m.groupName}/<strong>{m.variable.name}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
