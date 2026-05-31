import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickPrimaryValue, type Variable, type VariableScope, type VariableType, type VariablesFile } from '../../providers/design-system-variables';
import { Icon } from '../Icon';

interface Props {
  variables: VariablesFile | null;
  filterType?: VariableType;
  /** When set, only variables whose scope matches OR whose scope is null are shown. */
  requiredScope?: VariableScope;
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

/**
 * Exported helper: returns the full CSS variable name for a variable.
 * Used by ManualEditPanel for reverse lookups (chip display).
 */
export function varNameForVariable(collectionName: string, groupName: string, variable: Variable): string {
  return varSlugFor(variable, collectionName, groupName);
}

export function VariablePicker({ variables, filterType, requiredScope, onPick, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Reposition the popover relative to the trigger. We render it via a
  // portal into <body>, so the property panel's clipping ancestors
  // (overflow: hidden / scroll) no longer chop it off — but that
  // means we have to do the positioning math ourselves. Re-measure on
  // open + on viewport scroll/resize so the popover tracks the trigger
  // if the user scrolls the side panel.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = wrapRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = 280;
      // Prefer right-aligned to the trigger; clamp to viewport.
      let left = rect.right - popoverWidth;
      if (left < 8) left = 8;
      const maxLeft = window.innerWidth - popoverWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      const top = rect.bottom + 4;
      setPopoverPos({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture to catch nested scrollers
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      const target = ev.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
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
          // scope filter: if requiredScope is set, keep only variables whose
          // scope matches OR whose scope is null (unscoped = fallback anywhere).
          if (requiredScope !== undefined && variable.scope !== requiredScope && variable.scope !== null) continue;
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
      {open && popoverPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="ds-var-picker__popover"
              role="dialog"
              style={{ top: popoverPos.top, left: popoverPos.left }}
            >
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
                        <span className="ds-var-picker__swatch" style={{ background: String(pickPrimaryValue(m.variable) ?? '') }} />
                      ) : (
                        <span className="ds-var-picker__type">{m.variable.type}</span>
                      )}
                      <span className="ds-var-picker__label">
                        <strong>{m.variable.name}</strong>
                        <small className="ds-var-picker__path">{m.collectionName} › {m.groupName}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
