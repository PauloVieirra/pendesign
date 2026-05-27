import { useEffect, useRef, useState } from 'react';
import { emptyManualEditStyles, type ManualEditHistoryEntry, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '@open-design/edit-bridge';
import type { VariablesFile } from '../providers/design-system-variables';
import { VariablePicker } from './design-system-manager/VariablePicker';
import { ColorPickerPopover } from './ColorPickerPopover';
import { DeleteConfirmModal, type DeleteConfirmModalLabels } from './DeleteConfirmModal';

export interface ManualEditDraft {
  text: string;
  href: string;
  src: string;
  alt: string;
  styles: ManualEditStyles;
  attributesText: string;
  outerHtml: string;
  fullSource: string;
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '', href: '', src: '', alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}', outerHtml: '', fullSource: source,
  };
}

type SizeMode = 'fixed' | 'fill' | 'hug';

const NEXT_MODE: Record<SizeMode, SizeMode> = { fixed: 'fill', fill: 'hug', hug: 'fixed' };
const MODE_LABEL: Record<SizeMode, string> = { fixed: 'Fixed', fill: 'Fill', hug: 'Hug' };

function isCssVarToken(value: string): boolean {
  return /^var\(\s*--/.test((value || '').trim());
}

/** Matches a valid-but-incomplete decimal draft (e.g. "", "1", "1.", "1.23"). Rejects negatives. */
const FIXED_PX_DRAFT = /^\d*(\.\d{0,4})?$/;
/** Matches a complete positive decimal suitable for committing (e.g. "1", "1.23"). Rejects negatives. */
const FIXED_PX_COMMIT = /^\d+(\.\d{0,4})?$/;

// Anything not matching the Fill (`100%`) or Hug (`fit-content` / `auto`)
// sentinels falls through to Fixed. Non-standard inline values (e.g. `50vh`)
// also map to Fixed; the Fixed input then renders empty because the px regex
// in SizeRow does not match — the user can overwrite without seeing the old
// literal value. Track this in a future task if it becomes a problem.
function modeFromValue(value: string): SizeMode {
  const trimmed = (value || '').trim();
  if (trimmed === '100%') return 'fill';
  if (trimmed === 'fit-content' || trimmed === 'auto') return 'hug';
  return 'fixed';
}

function valueForMode(mode: SizeMode, fixedPx: string): string {
  if (mode === 'fill') return '100%';
  if (mode === 'hug') return 'fit-content';
  return `${fixedPx || '0'}px`;
}

function readOnlyDisplay(mode: Exclude<SizeMode, 'fixed'>): string {
  return mode === 'fill' ? '100%' : 'auto';
}

/**
 * Inline mode glyph. Three shapes:
 *  - fixed: bordered square (locked size)
 *  - fill:  arrows pointing outward (expand to fill)
 *  - hug:   arrows pointing inward (shrink to content)
 */
function SizeModeIcon({ mode }: { mode: SizeMode }) {
  if (mode === 'fixed') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (mode === 'fill') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 5h6M2 5l1.5-1.5M2 5l1.5 1.5M8 5L6.5 3.5M8 5L6.5 6.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0.5 5h3M9.5 5h-3M3.5 5L2 3.5M3.5 5L2 6.5M6.5 5L8 3.5M6.5 5L8 6.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Width or Height row. The numeric value is always visible:
 *   - Fixed: editable text input via FixedPxInput (decimal-aware).
 *   - Fill:  read-only "100%".
 *   - Hug:   read-only "auto".
 * One icon button to the right cycles the mode (Fixed → Fill → Hug → Fixed).
 * When the value is `var(--token)`, renders the existing token chip + clear
 * button so token data isn't silently overwritten.
 */
function SizeRow({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
}) {
  if (isCssVarToken(value)) {
    return (
      <div role="group" aria-label={ariaLabel} className="manual-edit-size-row">
        <span className="manual-edit-size-label">{label}</span>
        <span className="manual-edit-size-token" title={value}>{value}</span>
        <button
          type="button"
          className="manual-edit-size-clear"
          onClick={() => onChange('')}
          aria-label="Clear token"
        >×</button>
      </div>
    );
  }
  const mode = value.trim() === '' ? 'fixed' : modeFromValue(value);
  const fixedPx = (() => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec((value || '').trim());
    return match ? match[1]! : '';
  })();
  const next = NEXT_MODE[mode];
  return (
    <div role="group" aria-label={ariaLabel} className="manual-edit-size-row">
      <span className="manual-edit-size-label">{label}</span>
      {mode === 'fixed' ? (
        <FixedPxInput
          value={fixedPx}
          onChange={(raw) => onChange(`${raw}px`)}
          ariaLabel={ariaLabel}
        />
      ) : (
        <input
          type="text"
          inputMode="decimal"
          className="manual-edit-size-input"
          value={readOnlyDisplay(mode)}
          readOnly
          aria-label={`${ariaLabel} value, ${MODE_LABEL[mode]} mode (read-only)`}
        />
      )}
      <button
        type="button"
        className="manual-edit-size-mode-btn"
        data-mode={mode}
        aria-label={`${label} mode: ${MODE_LABEL[mode]}`}
        title={`Switch to ${MODE_LABEL[next]}`}
        onClick={() => onChange(valueForMode(next, fixedPx || '120'))}
      >
        <SizeModeIcon mode={mode} />
      </button>
    </div>
  );
}

/**
 * Numeric input for Fixed-mode Width/Height. Uses `type="text"
 * inputMode="decimal"` so the browser does not coerce values through
 * Number() (which would strip trailing zeros), round to integers, or
 * silently clamp to an HTML max. The value flows as a string end-to-end
 * so `120.5050` survives the round trip through the parent, instead of
 * collapsing to `120.505` the moment the prop refreshes.
 *
 * Negative values are rejected at the draft level (Width/Height don't
 * accept negatives) and again on commit, matching the original guard.
 */
function FixedPxInput({ value, onChange, ariaLabel }: {
  value: string;
  onChange: (raw: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label={`${ariaLabel} size in pixels`}
      onChange={(e) => {
        const next = e.target.value;
        if (FIXED_PX_DRAFT.test(next)) setDraft(next);
      }}
      onBlur={() => {
        if (FIXED_PX_COMMIT.test(draft)) onChange(draft);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="manual-edit-size-input"
    />
  );
}

export function ManualEditPanel({
  selectedTarget,
  draft,
  error,
  onDraftChange,
  onStyleChange,
  onInvalidStyle,
  onApplyPatch,
  onContentChange,
  onError,
  onClearSelection,
  pageStylesEnabled = true,
  dsVariables = null,
  deleteConfirmOpen = false,
  onDeleteConfirmOpenChange,
  deleteConfirmLabels,
  deleteButtonLabel,
}: {
  targets: ManualEditTarget[];
  selectedTarget: ManualEditTarget | null;
  draft: ManualEditDraft;
  history: ManualEditHistoryEntry[];
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  pageStylesEnabled?: boolean;
  /** Design-system variables sourced via fetchVariables. Enables the color
   * variable picker in ColorRow. Null = no DS attached, picker is hidden. */
  dsVariables?: VariablesFile | null;
  onSelectTarget: (target: ManualEditTarget) => void;
  onDraftChange: (draft: ManualEditDraft) => void;
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
  onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  /** Per-keystroke live preview: fired by content fields (text/href/src/alt)
   * so the iframe updates in real time. The host handles both the live
   * postMessage and the debounced disk save. */
  onContentChange?: (patch: ManualEditPatch, label: string) => void;
  onError: (message: string) => void;
  onClearSelection: () => void;
  onCancelDraft: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Delete-confirm modal state lifted to the host (FileViewer) so the
   * Delete/Backspace keyboard shortcut can open it. Optional so existing
   * tests and any non-FileViewer mounts keep working with a no-op default. */
  deleteConfirmOpen?: boolean;
  onDeleteConfirmOpenChange?: (open: boolean) => void;
  deleteConfirmLabels?: Partial<DeleteConfirmModalLabels>;
  deleteButtonLabel?: string;
}) {
  const targetForInspector = selectedTarget;
  const changeTargetStyle = (key: keyof ManualEditStyles, value: string) => {
    const nextStyles = { ...draft.styles, [key]: value };
    onDraftChange({ ...draft, styles: nextStyles });
    if (!targetForInspector) return;
    const normalized = normalizeManualEditStyles({ [key]: value }, {
      layoutEnabled: targetForInspector.isLayoutContainer,
    });
    if (!normalized.ok) {
      onError(normalized.error);
      onInvalidStyle?.(targetForInspector.id, [key]);
      return;
    }
    onError('');
    onStyleChange?.(targetForInspector.id, normalized.styles, `Style: ${targetForInspector.label}`);
  };

  return (
    <aside className="manual-edit-right">
      <section className="manual-edit-modal cc-panel">
        {targetForInspector ? (
          <>
            <ContentInspector
              target={targetForInspector}
              draft={draft}
              onDraftChange={onDraftChange}
              onApplyPatch={onApplyPatch}
              onContentChange={onContentChange}
            />
            <StyleInspector
              styles={draft.styles}
              layoutEnabled={targetForInspector.isLayoutContainer}
              onClearSelection={onClearSelection}
              onChange={changeTargetStyle}
              dsVariables={dsVariables}
            />
          </>
        ) : !targetForInspector ? (
          <PageInspector
            enabled={pageStylesEnabled}
            dsVariables={dsVariables}
            onStyleChange={(styles) => {
              const normalized = normalizeManualEditStyles(styles, { layoutEnabled: true });
              if (!normalized.ok) {
                onError(normalized.error);
                onInvalidStyle?.('__body__', Object.keys(styles) as Array<keyof ManualEditStyles>);
                return;
              }
              onError('');
              onStyleChange?.('__body__', normalized.styles, 'Page styles');
            }}
          />
        ) : null}

        {error ? <div className="manual-edit-error">{error}</div> : null}
        {selectedTarget ? (
          <div className="manual-edit-panel-footer">
            <button
              type="button"
              className="manual-edit-delete"
              onClick={() => onDeleteConfirmOpenChange?.(true)}
            >
              {deleteButtonLabel ?? 'Delete'}
            </button>
          </div>
        ) : null}
      </section>
      <DeleteConfirmModal
        open={deleteConfirmOpen}
        onCancel={() => onDeleteConfirmOpenChange?.(false)}
        onConfirm={() => {
          if (selectedTarget) {
            onApplyPatch({ kind: 'delete-element', id: selectedTarget.id }, 'Delete element');
          }
          onDeleteConfirmOpenChange?.(false);
          onClearSelection();
        }}
        labels={deleteConfirmLabels}
      />
    </aside>
  );
}

/**
 * Content editor for the currently selected element. The kinds map 1:1 to the
 * patch kinds: text/heading/etc → set-text, links → set-link, images → set-image.
 * Apply is explicit (button or Enter) so the user can fiddle without writing
 * to disk on every keystroke — the host already serializes patches through
 * applyManualEdit + writeProjectTextFile.
 */
function ContentInspector({
  target,
  draft,
  onDraftChange,
  onApplyPatch,
  onContentChange,
}: {
  target: ManualEditTarget;
  draft: ManualEditDraft;
  onDraftChange: (draft: ManualEditDraft) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  onContentChange?: (patch: ManualEditPatch, label: string) => void;
}) {
  const labelFor = target.label || target.tagName;
  // Fire the live preview (and schedule the debounced save) on every keystroke
  // so the iframe DOM reflects the typed value immediately, without waiting
  // for the user to click Apply. The Apply button stays as an immediate flush
  // for users who'd rather not wait for the 1-second debounce.
  const live = (patch: ManualEditPatch, label: string) => {
    if (onContentChange) onContentChange(patch, label);
    else onApplyPatch(patch, label);
  };
  if (target.kind === 'image') {
    return (
      <Section title="CONTENT">
        <label className="cc-row cc-row-stacked">
          <span className="cc-label">Image URL</span>
          <input
            type="url"
            value={draft.src}
            onChange={(e) => {
              const nextSrc = e.currentTarget.value;
              onDraftChange({ ...draft, src: nextSrc });
              live({ id: target.id, kind: 'set-image', src: nextSrc, alt: draft.alt }, `Image: ${labelFor}`);
            }}
            placeholder="https://…"
          />
        </label>
        <label className="cc-row cc-row-stacked">
          <span className="cc-label">Alt text</span>
          <input
            type="text"
            value={draft.alt}
            onChange={(e) => {
              const nextAlt = e.currentTarget.value;
              onDraftChange({ ...draft, alt: nextAlt });
              live({ id: target.id, kind: 'set-image', src: draft.src, alt: nextAlt }, `Image: ${labelFor}`);
            }}
            placeholder="Describe the image"
          />
        </label>
        <button
          type="button"
          className="cc-content-apply"
          onClick={() => onApplyPatch({ id: target.id, kind: 'set-image', src: draft.src, alt: draft.alt }, `Image: ${labelFor}`)}
        >
          Apply image
        </button>
      </Section>
    );
  }
  if (target.kind === 'link') {
    return (
      <Section title="CONTENT">
        <label className="cc-row cc-row-stacked">
          <span className="cc-label">Text</span>
          <textarea
            rows={2}
            value={draft.text}
            onChange={(e) => {
              const nextText = e.currentTarget.value;
              onDraftChange({ ...draft, text: nextText });
              live({ id: target.id, kind: 'set-link', text: nextText, href: draft.href }, `Link: ${labelFor}`);
            }}
            placeholder="Link label"
          />
        </label>
        <label className="cc-row cc-row-stacked">
          <span className="cc-label">href</span>
          <input
            type="url"
            value={draft.href}
            onChange={(e) => {
              const nextHref = e.currentTarget.value;
              onDraftChange({ ...draft, href: nextHref });
              live({ id: target.id, kind: 'set-link', text: draft.text, href: nextHref }, `Link: ${labelFor}`);
            }}
            placeholder="https://…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onApplyPatch({ id: target.id, kind: 'set-link', text: draft.text, href: draft.href }, `Link: ${labelFor}`);
              }
            }}
          />
        </label>
        <button
          type="button"
          className="cc-content-apply"
          onClick={() => onApplyPatch({ id: target.id, kind: 'set-link', text: draft.text, href: draft.href }, `Link: ${labelFor}`)}
        >
          Apply link
        </button>
      </Section>
    );
  }
  // text / container / token — show a textarea bound to set-text when the
  // element is a text-leaf, otherwise just show the read-only label (containers
  // don't have a single textContent worth editing safely).
  const isTextLeaf = !target.text.trim() || target.kind === 'text' || target.kind === 'token';
  return (
    <Section title="CONTENT">
      {isTextLeaf ? (
        <>
          <label className="cc-row cc-row-stacked">
            <span className="cc-label">Text</span>
            <textarea
              rows={3}
              value={draft.text}
              onChange={(e) => {
                const nextText = e.currentTarget.value;
                onDraftChange({ ...draft, text: nextText });
                live({ id: target.id, kind: 'set-text', value: nextText }, `Text: ${labelFor}`);
              }}
              placeholder="Element text"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onApplyPatch({ id: target.id, kind: 'set-text', value: draft.text }, `Text: ${labelFor}`);
                }
              }}
            />
          </label>
          <button
            type="button"
            className="cc-content-apply"
            onClick={() => onApplyPatch({ id: target.id, kind: 'set-text', value: draft.text }, `Text: ${labelFor}`)}
          >
            Apply text
          </button>
        </>
      ) : (
        <p className="cc-section-hint">
          This element contains nested markup. Edit individual children, or use the code editor for whole-element changes.
        </p>
      )}
    </Section>
  );
}

function PageInspector({
  enabled,
  onStyleChange,
  dsVariables = null,
}: {
  enabled: boolean;
  onStyleChange: (styles: Partial<ManualEditStyles>) => void;
  dsVariables?: VariablesFile | null;
}) {
  const [bg, setBg] = useState('');
  const [font, setFont] = useState('');
  const [size, setSize] = useState('');
  const update = (next: { bg?: string; font?: string; size?: string }) => {
    if ('bg' in next) {
      const value = next.bg ?? '';
      setBg(value);
      onStyleChange({ backgroundColor: value });
    }
    if ('font' in next) {
      const value = next.font ?? '';
      setFont(value);
      onStyleChange({ fontFamily: value });
    }
    if ('size' in next) {
      const value = next.size ?? '';
      setSize(value);
      onStyleChange({ fontSize: value });
    }
  };

  return (
    <div className="cc-inspector">
      <Section title="PAGE">
        {enabled ? (
          <>
            <ColorRow label="Background" value={bg} onChange={(value) => update({ bg: value })} variables={dsVariables} />
            <FontRow value={font} onChange={(value) => update({ font: value })} />
            <UnitRow label="Base size" value={size} onChange={(value) => update({ size: value })} unit="px" autoUnit />
          </>
        ) : (
          <p className="cc-section-hint">Page styles are available only for full HTML documents.</p>
        )}
      </Section>
    </div>
  );
}

const FONT_OPTS = [
  { label: 'inherit', value: '' },
  { label: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'monospace', value: 'SFMono-Regular, Consolas, "Liberation Mono", monospace' },
] as const;
const WEIGHT_OPTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const ALIGN_OPTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
const DIRECTION_OPTS = ['', 'row', 'column', 'row-reverse', 'column-reverse'];
const JUSTIFY_OPTS = ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'];
const ITEMS_OPTS = ['', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const BORDER_STYLE_OPTS = ['', 'solid', 'dashed', 'dotted', 'double', 'none'];
const EDITOR_SWATCH_COLORS = [
  '#000000',
  '#ffffff',
  '#374151',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

type NormalizeResult =
  | { ok: true; styles: Partial<ManualEditStyles> }
  | { ok: false; error: string };

const PX_STYLE_PROPS = new Set<keyof ManualEditStyles>([
  'fontSize', 'letterSpacing', 'width', 'height', 'minHeight', 'gap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius',
]);
const COLOR_STYLE_PROPS = new Set<keyof ManualEditStyles>(['color', 'backgroundColor', 'borderColor']);
const SELECT_STYLE_OPTIONS: Partial<Record<keyof ManualEditStyles, ReadonlyArray<string>>> = {
  fontFamily: FONT_OPTS.map((option) => option.value),
  fontWeight: WEIGHT_OPTS,
  textAlign: ALIGN_OPTS,
  flexDirection: DIRECTION_OPTS,
  justifyContent: JUSTIFY_OPTS,
  alignItems: ITEMS_OPTS,
  borderStyle: BORDER_STYLE_OPTS,
};
const LAYOUT_STYLE_PROPS = new Set<keyof ManualEditStyles>(['gap', 'flexDirection', 'justifyContent', 'alignItems']);

export function normalizeManualEditStyles(
  styles: Partial<ManualEditStyles>,
  { layoutEnabled }: { layoutEnabled: boolean },
): NormalizeResult {
  const normalized: Partial<ManualEditStyles> = {};
  for (const [rawKey, rawValue] of Object.entries(styles) as Array<[keyof ManualEditStyles, string]>) {
    if (LAYOUT_STYLE_PROPS.has(rawKey) && !layoutEnabled) continue;
    const value = rawValue.trim();
    if (value === '') {
      normalized[rawKey] = '';
      continue;
    }
    // Any property can be bound to a DS variable via `var(--token)`. The
    // browser handles the resolution; we just pass it through. This lets
    // sizes, typography options, opacity, etc. all reference tokens.
    if (looksLikeVarToken(value)) {
      normalized[rawKey] = value;
      continue;
    }
    // Width / Height also accept the Fill (`100%`) and Hug (`fit-content` /
    // `auto`) sentinels emitted by the SizeRow 3-way toggle. Other px props
    // stay numeric-only.
    if ((rawKey === 'width' || rawKey === 'height') && (value === '100%' || value === 'fit-content' || value === 'auto')) {
      normalized[rawKey] = value;
      continue;
    }
    if (PX_STYLE_PROPS.has(rawKey)) {
      const px = normalizePxValue(value);
      if (!px) return { ok: false, error: `${styleLabel(rawKey)} must be a number, px value, or var(--token).` };
      normalized[rawKey] = px;
      continue;
    }
    if (COLOR_STYLE_PROPS.has(rawKey)) {
      // Accept `rgba(...)` (from the alpha slider in the modern picker)
      // and pass through unchanged. Hex stays normalized for stability.
      if (/^rgba?\(/i.test(value)) {
        normalized[rawKey] = value;
        continue;
      }
      const color = normalizeHexColor(value);
      if (!color) return { ok: false, error: `${styleLabel(rawKey)} must be a hex color, rgba(), or var(--token).` };
      normalized[rawKey] = color;
      continue;
    }
    if (rawKey === 'backgroundImage') {
      // Accept linear-gradient (only kind the picker emits) and the empty
      // `none` keyword as a clear. Anything else passes through.
      normalized.backgroundImage = value === 'none' ? '' : value;
      continue;
    }
    if (rawKey === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Opacity must be a number or var(--token).' };
      normalized.opacity = String(Math.max(0, Math.min(1, n)));
      continue;
    }
    if (rawKey === 'lineHeight') {
      const lineHeight = normalizeLineHeightValue(value);
      if (!lineHeight) return { ok: false, error: 'Line height must be a positive number, px value, or var(--token).' };
      normalized.lineHeight = lineHeight;
      continue;
    }
    const options = SELECT_STYLE_OPTIONS[rawKey];
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${styleLabel(rawKey)} has an unsupported value.` };
      normalized[rawKey] = value;
      continue;
    }
    normalized[rawKey] = value;
  }
  return { ok: true, styles: normalized };
}

function looksLikeVarToken(value: string): boolean {
  return /^var\(--[a-z0-9-]+\)$/i.test(value.trim());
}

function isGradientValue(value: string): boolean {
  return /^\s*linear-gradient\(/i.test(value);
}

function normalizePxValue(value: string): string | null {
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${value}px`;
  if (/^-?\d+(\.\d+)?px$/i.test(value)) return value.toLowerCase();
  return null;
}

function normalizeLineHeightValue(value: string): string | null {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? String(n) : null;
  }
  if (/^\d+(\.\d+)?px$/i.test(value)) {
    const n = Number(value.slice(0, -2));
    return n > 0 ? value.toLowerCase() : null;
  }
  return null;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function slugifyToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// When the inline value is `var(--token)`, the property panel lives outside
// the iframe and has no access to the project's :root variables, so the
// swatch resolves to transparent. Look the token up against the DS
// variables file and return the literal hex so the swatch paints correctly.
function resolveVarColor(value: string, variables: VariablesFile | null): string | null {
  if (!variables) return null;
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const target = match[1]!;
  for (const collection of variables.collections) {
    for (const group of collection.groups) {
      for (const variable of group.variables) {
        if (variable.type !== 'color') continue;
        const slug = `--${slugifyToken(collection.name)}-${slugifyToken(group.name)}-${slugifyToken(variable.name)}`;
        if (slug === target) return String(variable.value);
      }
    }
  }
  return null;
}

function styleLabel(key: keyof ManualEditStyles): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

function StyleInspector({
  styles, layoutEnabled, onClearSelection, onChange, dsVariables = null,
}: {
  styles: ManualEditStyles;
  layoutEnabled: boolean;
  onClearSelection: () => void;
  onChange: (key: keyof ManualEditStyles, value: string) => void;
  dsVariables?: VariablesFile | null;
}) {
  const u = (key: keyof ManualEditStyles, value: string) => onChange(key, value);

  return (
    <div className="cc-inspector">
      <div className="cc-inspector-nav">
        <button type="button" className="cc-inspector-page" onClick={onClearSelection} aria-label="Show page inspector">
          Page
        </button>
      </div>
      <Section title="TYPOGRAPHY">
        <FontRow value={styles.fontFamily} onChange={(v) => u('fontFamily', v)} variables={dsVariables} />
        <PairRow>
          <UnitRow label="Size" value={styles.fontSize} onChange={(v) => u('fontSize', v)} unit="px" autoUnit variables={dsVariables} />
          <DropdownRow label="Weight" value={styles.fontWeight} onChange={(v) => u('fontWeight', v)} options={WEIGHT_OPTS} />
        </PairRow>
        <PairRow>
          <ColorRow label="Color" value={styles.color} onChange={(v) => u('color', v)} variables={dsVariables} />
          <DropdownRow label="Align" value={styles.textAlign} onChange={(v) => u('textAlign', v)} options={ALIGN_OPTS} />
        </PairRow>
        <PairRow>
          <UnitRow label="Line" value={styles.lineHeight} onChange={(v) => u('lineHeight', v)} unit="" variables={dsVariables} />
          <UnitRow label="Tracking" value={styles.letterSpacing} onChange={(v) => u('letterSpacing', v)} unit="px" autoUnit />
        </PairRow>
      </Section>

      <Section title="SIZE">
        <SizeRow label="Width" ariaLabel="width" value={styles.width} onChange={(v) => u('width', v)} />
        <SizeRow label="Height" ariaLabel="height" value={styles.height} onChange={(v) => u('height', v)} />
      </Section>

      <Section title="LAYOUT" inactive={!layoutEnabled}>
        {!layoutEnabled ? (
          <p className="cc-section-hint">Select a container or group to edit layout.</p>
        ) : null}
        <PairRow>
          <UnitRow label="Gap" value={styles.gap} onChange={(v) => u('gap', v)} unit="px" autoUnit disabled={!layoutEnabled} variables={dsVariables} />
          <DropdownRow label="Direction" value={styles.flexDirection} onChange={(v) => u('flexDirection', v)} options={DIRECTION_OPTS} disabled={!layoutEnabled} />
        </PairRow>
        <PairRow>
          <DropdownRow label="Justify" value={styles.justifyContent} onChange={(v) => u('justifyContent', v)} options={JUSTIFY_OPTS} disabled={!layoutEnabled} />
          <DropdownRow label="Align" value={styles.alignItems} onChange={(v) => u('alignItems', v)} options={ITEMS_OPTS} disabled={!layoutEnabled} />
        </PairRow>
      </Section>

      <Section title="BOX">
        <PairRow>
          <ColorRow
            label="Fill"
            // When backgroundImage holds a gradient, the Fill row is showing
            // it; switching back to a solid color must clear backgroundImage
            // and write to backgroundColor instead. The reverse holds too.
            value={isGradientValue(styles.backgroundImage) ? styles.backgroundImage : styles.backgroundColor}
            onChange={(v) => {
              if (isGradientValue(v)) {
                u('backgroundImage', v);
                u('backgroundColor', '');
              } else {
                u('backgroundColor', v);
                u('backgroundImage', '');
              }
            }}
            variables={dsVariables}
            allowGradient
          />
          <UnitRow label="Opacity" value={styles.opacity} onChange={(v) => u('opacity', v)} unit="" variables={dsVariables} />
        </PairRow>

        <QuadRow label="Padding" values={{
          t: styles.paddingTop, r: styles.paddingRight, b: styles.paddingBottom, l: styles.paddingLeft,
        }} onChange={(side, value) => u(sideToProp('padding', side), value)} variables={dsVariables} />

        <QuadRow label="Margin" values={{
          t: styles.marginTop, r: styles.marginRight, b: styles.marginBottom, l: styles.marginLeft,
        }} onChange={(side, value) => u(sideToProp('margin', side), value)} variables={dsVariables} />

        <QuadRow label="Border" values={{
          t: styles.borderTopWidth, r: styles.borderRightWidth, b: styles.borderBottomWidth, l: styles.borderLeftWidth,
        }} onChange={(side, value) => u(`border${sideUpper(side)}Width` as keyof ManualEditStyles, value)} variables={dsVariables} />

        <PairRow>
          <DropdownRow label="Style" value={styles.borderStyle} onChange={(v) => u('borderStyle', v)} options={BORDER_STYLE_OPTS} />
          <ColorRow label="Border" value={styles.borderColor} onChange={(v) => u('borderColor', v)} compact variables={dsVariables} />
        </PairRow>
        <UnitRow label="Radius" value={styles.borderRadius} onChange={(v) => u('borderRadius', v)} unit="px" autoUnit variables={dsVariables} />
      </Section>
    </div>
  );
}

function Section({ title, children, inactive }: { title: string; children: React.ReactNode; inactive?: boolean }) {
  return (
    <section className={`cc-section${inactive ? ' cc-section-inactive' : ''}`}>
      <header className="cc-section-head">{title}</header>
      <div className="cc-section-body">{children}</div>
    </section>
  );
}

function PairRow({ children }: { children: React.ReactNode }) {
  return <div className="cc-pair">{children}</div>;
}

// Extract the bare token name from `var(--name)` so number/string fields
// can show a compact "—name" label instead of the verbose `var(--name)`
// when the cell is narrow. The full `var(--name)` is still what we write
// back to source.
function varTokenName(value: string): string | null {
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  return match ? match[1]! : null;
}

function UnitRow({ label, value, onChange, unit, autoUnit, disabled, variables = null }: {
  label: string; value: string; onChange: (v: string) => void;
  unit: string; autoUnit?: boolean; disabled?: boolean;
  variables?: VariablesFile | null;
}) {
  const tokenName = varTokenName(value);
  const display = tokenName ? tokenName : (unit === 'px' ? stripPxUnit(value) : value);
  const step = unit === 'px' ? 1 : 0.1;
  const canStep = !disabled && !tokenName && isNumericInput(display);
  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim();
    if (looksLikeVarToken(trimmed)) return trimmed;
    if (autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`;
    if (autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  };
  const handle = (raw: string) => {
    const next = valueFromDisplay(raw);
    if (next !== value) onChange(next);
  };
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    const next = formatSteppedNumber(Number(display) + direction * step, display, step);
    onChange(valueFromDisplay(next));
  };
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className={`cc-value${tokenName ? ' cc-value-token' : ''}`}>
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} decrease`} onClick={() => stepBy(-1)}>−</button>
        <input value={display} placeholder="" disabled={disabled} onChange={(e) => onChange(valueFromDisplay(e.currentTarget.value))} onBlur={(e) => handle(e.currentTarget.value)} />
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} increase`} onClick={() => stepBy(1)}>+</button>
        {unit && !tokenName ? <em className="cc-unit">{unit}</em> : null}
        {variables ? (
          <VariablePicker
            variables={variables}
            filterType="number"
            ariaLabel={`Bind ${label} to design system variable`}
            onPick={(slug) => onChange(`var(${slug})`)}
          />
        ) : null}
      </span>
    </label>
  );
}

function DropdownRow({ label, value, onChange, options, placeholder, disabled, variables = null }: {
  label: string; value: string; onChange: (v: string) => void;
  options: ReadonlyArray<string>; placeholder?: string; disabled?: boolean;
  variables?: VariablesFile | null;
}) {
  const tokenName = varTokenName(value);
  if (tokenName) {
    return (
      <label className="cc-row">
        <span className="cc-label">{label}</span>
        <span className="cc-value cc-value-token">
          <input value={tokenName} readOnly aria-label={`${label} bound to ${tokenName}`} />
          <button
            type="button"
            className="cc-token-clear"
            aria-label={`Unbind ${label}`}
            title="Unbind token"
            onClick={() => onChange('')}
          >×</button>
          {variables ? (
            <VariablePicker
              variables={variables}
              filterType="string"
              ariaLabel={`Rebind ${label} to design system variable`}
              onPick={(slug) => onChange(`var(${slug})`)}
            />
          ) : null}
        </span>
      </label>
    );
  }
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value cc-select">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
          {!options.includes(value) && value ? <option value={value}>{value}</option> : null}
          {options.map((opt) => <option key={opt || '__'} value={opt}>{opt || (placeholder ?? '–')}</option>)}
        </select>
        <em className="cc-chevron">▾</em>
        {variables ? (
          <VariablePicker
            variables={variables}
            filterType="string"
            ariaLabel={`Bind ${label} to design system variable`}
            onPick={(slug) => onChange(`var(${slug})`)}
          />
        ) : null}
      </span>
    </label>
  );
}

function FontRow({ value, onChange, variables = null }: {
  value: string;
  onChange: (v: string) => void;
  variables?: VariablesFile | null;
}) {
  const tokenName = varTokenName(value);
  if (tokenName) {
    return (
      <label className="cc-row">
        <span className="cc-label">Font</span>
        <span className="cc-value cc-value-token">
          <input value={tokenName} readOnly aria-label={`Font bound to ${tokenName}`} />
          <button
            type="button"
            className="cc-token-clear"
            aria-label="Unbind Font"
            title="Unbind token"
            onClick={() => onChange('')}
          >×</button>
          {variables ? (
            <VariablePicker
              variables={variables}
              filterType="string"
              ariaLabel="Rebind Font to design system variable"
              onPick={(slug) => onChange(`var(${slug})`)}
            />
          ) : null}
        </span>
      </label>
    );
  }
  const normalizedValue = normalizeFontFamilyForSelect(value);
  const customValue = normalizedValue === value ? value : '';
  return (
    <label className="cc-row">
      <span className="cc-label">Font</span>
      <span className="cc-value cc-select">
        <select value={normalizedValue} onChange={(event) => onChange(event.currentTarget.value)}>
          {customValue && !FONT_OPTS.some((option) => option.value === customValue) ? (
            <option value={customValue}>{fontFamilyLabel(customValue)}</option>
          ) : null}
          {FONT_OPTS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <em className="cc-chevron">▾</em>
        {variables ? (
          <VariablePicker
            variables={variables}
            filterType="string"
            ariaLabel="Bind Font to design system variable"
            onPick={(slug) => onChange(`var(${slug})`)}
          />
        ) : null}
      </span>
    </label>
  );
}

function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const direct = FONT_OPTS.find((option) => option.value === trimmed);
  if (direct) return direct.value;
  const families = parseFontFamilies(trimmed);
  const primaryFamily = families[0];
  const match = FONT_OPTS.find((option) => {
    if (!option.value) return false;
    const optionFamilies = parseFontFamilies(option.value);
    return optionFamilies[0] === primaryFamily;
  });
  return match?.value ?? trimmed;
}

function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value;
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
}

function ColorRow({ label, value, onChange, compact, variables = null, allowGradient = false }: {
  label: string; value: string; onChange: (v: string) => void; compact?: boolean;
  /** Project's DS variables; when present, a small link affordance lets
   * the user bind this color to a token (writes `var(--<slug>)`). */
  variables?: VariablesFile | null;
  /** Fill row enables gradient mode in the popover. Color/Border use solid only. */
  allowGradient?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  // click-outside is handled inside ColorPickerPopover (it owns the portal'd
  // node and the trigger anchor); we only manage open/closed state here.
  const swatchBackground = resolveVarColor(value, variables) ?? value ?? 'transparent';
  return (
    <label className="cc-row">
      {compact ? null : <span className="cc-label">{label}</span>}
      <span className={`cc-value cc-color ${compact ? 'cc-color-compact' : ''}`} ref={ref}>
        <button ref={swatchRef} type="button" className="cc-swatch"
          style={{ background: swatchBackground }}
          onClick={() => setOpen((v) => !v)} aria-label={`Pick ${label}`} />
        <input value={value} placeholder="#000000"
          onChange={(e) => onChange(e.currentTarget.value)} onFocus={() => setOpen(true)} />
        {variables ? (
          <VariablePicker
            variables={variables}
            filterType="color"
            ariaLabel={`Bind ${label} to design system variable`}
            onPick={(slug) => onChange(`var(${slug})`)}
          />
        ) : null}
        {open ? (
          <ColorPickerPopover
            value={value}
            onChange={onChange}
            variables={variables}
            allowGradient={allowGradient}
            anchorRef={swatchRef}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </span>
    </label>
  );
}

function QuadRow({ label, values, onChange, variables = null }: {
  label: string; values: { t: string; r: string; b: string; l: string };
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
  variables?: VariablesFile | null;
}) {
  const [open, setOpen] = useState(true);
  const allEqualValue = (() => {
    const v = values.t;
    return v === values.r && v === values.b && v === values.l ? v : null;
  })();
  return (
    <div className="cc-quad">
      <button type="button" className="cc-quad-head" onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        {!open && allEqualValue !== null ? <em>{allEqualValue || '0 px'}</em> : <span className="cc-chevron-small">{open ? '▾' : '▸'}</span>}
      </button>
      {open ? (
        <div className="cc-quad-grid">
          <QuadCell axis="T" value={values.t} onChange={(v) => onChange('t', v)} variables={variables} />
          <QuadCell axis="R" value={values.r} onChange={(v) => onChange('r', v)} variables={variables} />
          <QuadCell axis="B" value={values.b} onChange={(v) => onChange('b', v)} variables={variables} />
          <QuadCell axis="L" value={values.l} onChange={(v) => onChange('l', v)} variables={variables} />
        </div>
      ) : null}
    </div>
  );
}

function QuadCell({ axis, value, onChange, variables = null }: {
  axis: string; value: string; onChange: (v: string) => void;
  variables?: VariablesFile | null;
}) {
  const tokenName = varTokenName(value);
  const display = tokenName ? tokenName : stripPxUnit(value);
  const canStep = !tokenName && isNumericInput(display);
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    onChange(`${formatSteppedNumber(Number(display) + direction, display, 1)}px`);
  };
  return (
    <span className={`cc-quad-cell${tokenName ? ' cc-quad-cell-token' : ''}`}>
      <em className="cc-quad-axis">{axis}</em>
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} decrease`} onClick={() => stepBy(-1)}>−</button>
      <input value={display} placeholder="0" readOnly={!!tokenName}
        onChange={(e) => {
          const raw = e.currentTarget.value.trim();
          if (raw === '') onChange('');
          else if (looksLikeVarToken(raw)) onChange(raw);
          else if (isNumericInput(raw)) onChange(`${raw}px`);
          else if (/^-?\d+(\.\d+)?px$/i.test(raw)) onChange(raw.toLowerCase());
          else onChange(e.currentTarget.value);
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (looksLikeVarToken(v)) return;
          const next = v && isNumericInput(v) ? `${v}px` : e.currentTarget.value;
          if (next !== value) onChange(next);
        }} />
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} increase`} onClick={() => stepBy(1)}>+</button>
      {tokenName ? null : <em className="cc-quad-unit">px</em>}
      {variables ? (
        <VariablePicker
          variables={variables}
          filterType="number"
          ariaLabel={`Bind ${axis} to design system variable`}
          onPick={(slug) => onChange(`var(${slug})`)}
        />
      ) : null}
    </span>
  );
}

function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match?.[1] ?? value;
}

function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)));
  return decimals > 0
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : String(Math.round(value));
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/);
  return match?.[1]?.length ?? 0;
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles;
}
function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left';
}

function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`;
  }
  return '#000000';
}

export function manualEditPatchSummary(patch: ManualEditPatch): string {
  if (patch.kind === 'set-full-source') return JSON.stringify({ kind: patch.kind, bytes: patch.source.length });
  if (patch.kind === 'set-outer-html') return JSON.stringify({ id: patch.id, kind: patch.kind, bytes: patch.html.length });
  return JSON.stringify(patch);
}
