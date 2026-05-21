import { useEffect, useRef, useState } from 'react';
import type { ManualEditColorTarget, ManualEditRect } from '../edit-mode/types';

const SWATCH_COLORS = [
  '#000000', '#ffffff', '#374151', '#6b7280',
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
] as const;

export interface EditModeColorPopoverState {
  open: boolean;
  targetId: string;
  rect: ManualEditRect;
  colorTarget: ManualEditColorTarget;
  currentColor: string;
}

export function emptyEditModeColorPopoverState(): EditModeColorPopoverState {
  return { open: false, targetId: '', rect: { x: 0, y: 0, width: 0, height: 0 }, colorTarget: 'text', currentColor: '#000000' };
}

const TARGET_LABEL: Record<ManualEditColorTarget, string> = {
  text: 'Replace color value',
  background: 'Background color',
  color: 'Text color',
};

export function EditModeColorPopover({
  state,
  iframeRect,
  onClose,
  onApply,
}: {
  state: EditModeColorPopoverState;
  iframeRect: DOMRect | null;
  onClose: () => void;
  onApply: (hex: string) => void;
}) {
  const [color, setColor] = useState(state.currentColor);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state.open) return;
    setColor(normalizeHex(state.currentColor) || '#000000');
  }, [state.open, state.targetId, state.currentColor]);

  useEffect(() => {
    if (!state.open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [state.open, onClose]);

  if (!state.open) return null;

  const anchor = iframeRect ?? new DOMRect();
  const left = Math.round(anchor.left + state.rect.x);
  const top = Math.round(anchor.top + state.rect.y + state.rect.height + 6);
  const positionStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(left, window.innerWidth - 280),
    top: Math.min(top, window.innerHeight - 260),
    zIndex: 1000,
  };

  return (
    <div ref={ref} className="cc-panel od-edit-color-popover" style={positionStyle} role="dialog" aria-label={TARGET_LABEL[state.colorTarget]}>
      <header className="od-edit-media-head">{TARGET_LABEL[state.colorTarget]}</header>
      <div className="od-edit-color-grid">
        {SWATCH_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            className="od-edit-color-tile"
            style={{ background: hex }}
            onClick={() => setColor(hex)}
            aria-label={hex}
          />
        ))}
      </div>
      <label className="od-edit-media-label">
        <span>Hex</span>
        <span className="od-edit-color-input">
          <input
            type="color"
            value={normalizeHex(color) || '#000000'}
            onChange={(e) => setColor(e.currentTarget.value)}
            aria-label="Pick color"
          />
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.currentTarget.value)}
            placeholder="#000000"
          />
        </span>
      </label>
      <footer className="od-edit-media-foot">
        <button type="button" className="cc-inspector-page" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="od-edit-media-apply"
          disabled={!normalizeHex(color)}
          onClick={() => {
            const next = normalizeHex(color);
            if (next) onApply(next);
          }}
        >
          Apply
        </button>
      </footer>
    </div>
  );
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}
