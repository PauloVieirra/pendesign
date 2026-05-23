import { useId } from 'react';

interface BaseProps<T> {
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function ColorEditor({ value, onChange, disabled }: BaseProps<string>) {
  const id = useId();
  return (
    <div className="ds-mgr-editor ds-mgr-editor-color">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(ev) => onChange(ev.target.value)}
        disabled={disabled}
        aria-labelledby={id}
      />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder="#000000"
        spellCheck={false}
        disabled={disabled}
      />
    </div>
  );
}

export function NumberEditor({ value, onChange, disabled }: BaseProps<number>) {
  return (
    <input
      className="ds-mgr-editor ds-mgr-editor-number"
      type="number"
      step="0.5"
      value={Number.isFinite(value) ? value : 0}
      onChange={(ev) => onChange(Number(ev.target.value))}
      disabled={disabled}
    />
  );
}

export function StringEditor({ value, onChange, disabled }: BaseProps<string>) {
  return (
    <input
      className="ds-mgr-editor ds-mgr-editor-string"
      type="text"
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      disabled={disabled}
    />
  );
}

export function BooleanEditor({ value, onChange, disabled }: BaseProps<boolean>) {
  return (
    <label className="ds-mgr-editor ds-mgr-editor-boolean">
      <input
        type="checkbox"
        checked={value}
        onChange={(ev) => onChange(ev.target.checked)}
        disabled={disabled}
      />
      <span>{value ? 'true' : 'false'}</span>
    </label>
  );
}

function normalizeHex(value: string): string {
  // <input type="color"> rejects #fff and #ffaabb-style inputs without padding.
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const r = value.charAt(1);
    const g = value.charAt(2);
    const b = value.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return '#000000';
}
