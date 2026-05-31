# Properties Panel Figma-Style Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Edit-mode properties panel (`ManualEditPanel.tsx → StyleInspector`) into Figma-style sections, make W/H numeric values always visible, and support up to 4-decimal precision in numeric inputs.

**Architecture:** Surgical rewrite of one component (`StyleInspector` + `SizeRow` + `FixedPxInput`) and its CSS, preserving all existing host wiring (`onStyleChange`, `onApplyPatch`, `normalizeManualEditStyles`) and the design-system variable token chip path. Behavioral guarantees (emit-on-blur, no data loss for tokens, content live-preview) are unchanged; only the UI shape and section order change.

**Tech Stack:** React 18, TypeScript, JSDOM + Vitest, CSS (no framework, hand-rolled in `index.css`), `@open-design/edit-bridge` for style types.

**Spec:** `docs/superpowers/specs/2026-05-27-properties-panel-figma-reorg-design.md`

---

## File Structure

**Modify:**
- `apps/web/src/components/ManualEditPanel.tsx` — rewrite `SizeRow` and `FixedPxInput`; reorganize `StyleInspector` JSX into new section order; add `SubSection` and `SizeModeIcon` helpers.
- `apps/web/src/index.css` — update `.manual-edit-workspace` grid template, `.cc-section-head` typography + divider, add `.cc-section-sub` mini-header, add `.cc-size-mode-btn`.
- `apps/web/tests/components/ManualEditPanel.test.tsx` — update existing SizeRow specs (radios → mode buttons), add new specs for always-visible W/H, decimal precision, and new section order.

No new files. No changes to `@open-design/edit-bridge` or the host wiring in `FileViewer.tsx`.

---

## Task 1: Decimal precision in `FixedPxInput`

**Files:**
- Modify: `apps/web/src/components/ManualEditPanel.tsx:122-153` (`FixedPxInput`)
- Test: `apps/web/tests/components/ManualEditPanel.test.tsx` (add new specs in the SizeRow `describe` block, near line 487)

### Why

`FixedPxInput` uses `<input type="number">`. Browsers (a) default `step` to 1, so spinner buttons round to integers; (b) strip trailing zeros when the value is coerced through `Number()` on blur; (c) reject pasted values that exceed `max=10000` silently. We need to preserve up to 4 decimal places exactly as typed.

- [ ] **Step 1: Add a failing test for 4-decimal preservation**

In `apps/web/tests/components/ManualEditPanel.test.tsx`, inside the existing `describe('ManualEditPanel', () => { ... })` block (after the existing SizeRow specs around line 610), add:

```typescript
it('Fixed mode preserves up to 4 decimal places on blur', () => {
  const onStyleChange = vi.fn();
  renderPanel({
    onStyleChange,
    styles: { ...emptyManualEditStyles(), width: '120px' },
  });

  const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
  if (!widthGroup) throw new Error('Width group not found');
  const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  if (!numberInput) throw new Error('Width decimal input not found');

  act(() => {
    numberInput.value = '120.5050';
    Simulate.change(numberInput);
  });
  act(() => {
    Simulate.blur(numberInput);
  });

  expect(onStyleChange).toHaveBeenCalledWith(
    'hero-title',
    expect.objectContaining({ width: '120.5050px' }),
    'Style: Hero Title',
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: FAIL — selector `input[inputmode="decimal"]` returns null (current input is `type="number"` without `inputmode`).

- [ ] **Step 3: Rewrite `FixedPxInput` to use text + decimal regex**

Replace lines 116-153 of `apps/web/src/components/ManualEditPanel.tsx` with:

```typescript
/**
 * Numeric input for Fixed-mode Width/Height. Uses `type="text"
 * inputMode="decimal"` instead of `type="number"` so the browser does not
 * round to integers, strip trailing zeros via `Number()`, or eat pasted
 * values that exceed an HTML max. Local draft commits on blur (or Enter),
 * matching the original behavior of emitting once per edit rather than
 * once per keystroke.
 */
function FixedPxInput({ value, onChange, ariaLabel, readOnly }: {
  value: number;
  onChange: (raw: string) => void;
  ariaLabel: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const acceptDraft = /^-?\d*(\.\d{0,4})?$/;
  const validCommit = /^-?\d+(\.\d{0,4})?$/;
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      readOnly={readOnly}
      aria-label={`${ariaLabel} size in pixels`}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '' || acceptDraft.test(next)) setDraft(next);
      }}
      onBlur={() => {
        if (validCommit.test(draft)) onChange(draft);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="manual-edit-size-input"
    />
  );
}
```

Note: the `onChange` signature changes from `(n: number) => void` to `(raw: string) => void` so the caller appends `px` itself, preserving the exact decimal string the user typed. The two call sites — both inside `SizeRow` — will be updated in Task 2.

For Task 1, update the existing two call sites to keep building `"<n>px"` from the raw string:

`SizeRow` body around line 109-111 (still using the old radio-based shape — this is a transitional edit that Task 2 replaces):
```typescript
{mode === 'fixed' ? (
  <FixedPxInput value={fixedPx} onChange={(raw) => onChange(`${raw}px`)} ariaLabel={ariaLabel} />
) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: the new decimal spec PASSES; the existing `'Fixed mode reveals a px input that emits onStyleChange on blur'` spec FAILS because it selects `input[type="number"]`.

Update the existing spec at line 497:
```typescript
const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
```
(was `widthGroup.querySelector('input[type="number"]')`)

And the other reference at line 572:
```typescript
const numberInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
```

And the assertion at line 560:
```typescript
expect(widthGroup.querySelector('input[inputmode="decimal"]')).toBeNull();
```

And the assertion at line 532:
```typescript
expect(widthGroup.querySelector('input[inputmode="decimal"]')).toBeNull();
```

Run again — all SizeRow specs should pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ManualEditPanel.tsx apps/web/tests/components/ManualEditPanel.test.tsx
git commit -m "feat(manual-edit): preserve up to 4 decimals in Fixed px input"
```

---

## Task 2: Redesign `SizeRow` — input + mode icon button

**Files:**
- Modify: `apps/web/src/components/ManualEditPanel.tsx:55-114` (`SizeRow`)
- Test: `apps/web/tests/components/ManualEditPanel.test.tsx` (rewrite specs around lines 423-609)

### Why

Current `SizeRow` shows three radio buttons (Fixed / Fill / Hug) and only reveals the numeric input when Fixed is active. New design keeps the numeric input always visible (read-only in Fill/Hug) and adds a single icon button that cycles modes. This addresses the primary "values escondidos" complaint.

- [ ] **Step 1: Rewrite the existing SizeRow specs to expect the new shape**

In `apps/web/tests/components/ManualEditPanel.test.tsx`, replace the spec at line 423 (`'renders Width and Height 3-way toggles in the SIZE section'`) with:

```typescript
it('renders Width and Height as always-visible inputs + mode buttons', () => {
  renderPanel({
    selectedTarget: { ...target, isLayoutContainer: true },
    styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
  });

  const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
  const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
  if (!widthGroup || !heightGroup) throw new Error('Width/Height groups not found');

  const widthInput = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  const heightInput = heightGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  expect(widthInput?.value).toBe('120');
  expect(heightInput?.value).toBe('80');

  const widthModeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  const heightModeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  expect(widthModeBtn?.getAttribute('data-mode')).toBe('fixed');
  expect(heightModeBtn?.getAttribute('data-mode')).toBe('fixed');
});
```

Replace `'switching Width to Fill emits onStyleChange with width: 100%'` (line 441):
```typescript
it('cycling the Width mode to Fill emits width: 100%', () => {
  const onStyleChange = vi.fn();
  renderPanel({
    onStyleChange,
    styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
  });

  const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
  if (!widthGroup) throw new Error('Width group not found');
  const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  if (!modeBtn) throw new Error('Width mode button not found');

  // Cycle: Fixed → Fill
  act(() => {
    modeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });

  expect(onStyleChange).toHaveBeenCalledWith(
    'hero-title',
    expect.objectContaining({ width: '100%' }),
    'Style: Hero Title',
  );
});
```

Replace `'switching Height to Hug emits onStyleChange with height: fit-content'` (line 464):
```typescript
it('cycling the Height mode twice from Fixed lands on Hug (fit-content)', () => {
  const onStyleChange = vi.fn();
  renderPanel({
    onStyleChange,
    styles: { ...emptyManualEditStyles(), width: '120px', height: '80px' },
  });

  const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
  if (!heightGroup) throw new Error('Height group not found');
  const modeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  if (!modeBtn) throw new Error('Height mode button not found');

  // Fixed → Fill (writes 100%)
  act(() => {
    modeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  // Fill → Hug (writes fit-content)
  act(() => {
    modeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });

  const calls = onStyleChange.mock.calls.map((c) => c[1]);
  expect(calls).toEqual([
    expect.objectContaining({ height: '100%' }),
    expect.objectContaining({ height: 'fit-content' }),
  ]);
});
```

Replace `'does not check any radio when width is unset (empty string)'` (line 548) with:
```typescript
it('shows an empty input and Fixed mode button when width is unset', () => {
  renderPanel({
    styles: { ...emptyManualEditStyles(), width: '' },
  });

  const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
  if (!widthGroup) throw new Error('Width group not found');

  const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  expect(input?.value).toBe('');
  const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  expect(modeBtn?.getAttribute('data-mode')).toBe('fixed');
});
```

Add a new spec for always-visible read-only value in Fill/Hug:
```typescript
it('shows 100% read-only in the input when width is Fill', () => {
  renderPanel({
    styles: { ...emptyManualEditStyles(), width: '100%' },
  });

  const widthGroup = host.querySelector('div[role="group"][aria-label="width"]') as HTMLElement | null;
  if (!widthGroup) throw new Error('Width group not found');
  const input = widthGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  expect(input?.value).toBe('100%');
  expect(input?.readOnly).toBe(true);
  const modeBtn = widthGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  expect(modeBtn?.getAttribute('data-mode')).toBe('fill');
});

it('shows auto read-only in the input when height is Hug', () => {
  renderPanel({
    styles: { ...emptyManualEditStyles(), height: 'fit-content' },
  });

  const heightGroup = host.querySelector('div[role="group"][aria-label="height"]') as HTMLElement | null;
  if (!heightGroup) throw new Error('Height group not found');
  const input = heightGroup.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
  expect(input?.value).toBe('auto');
  expect(input?.readOnly).toBe(true);
  const modeBtn = heightGroup.querySelector('button[data-mode]') as HTMLButtonElement | null;
  expect(modeBtn?.getAttribute('data-mode')).toBe('hug');
});
```

The existing token-chip spec (line 516, `'renders a clear-token chip when width is a var() token (no data loss)'`) needs only one assertion update — replace `expect(widthGroup.querySelectorAll('input[type="radio"]').length).toBe(0)` with `expect(widthGroup.querySelector('button[data-mode]')).toBeNull()` (the mode button must be hidden when a token is bound).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: the rewritten SizeRow specs FAIL — no `button[data-mode]` selector matches yet, and the current input is conditional on Fixed mode.

- [ ] **Step 3: Rewrite `SizeRow` and add `SizeModeIcon`**

Replace lines 47-114 of `apps/web/src/components/ManualEditPanel.tsx` with:

```typescript
type SizeMode = 'fixed' | 'fill' | 'hug';

const NEXT_MODE: Record<SizeMode, SizeMode> = { fixed: 'fill', fill: 'hug', hug: 'fixed' };
const MODE_LABEL: Record<SizeMode, string> = { fixed: 'Fixed', fill: 'Fill', hug: 'Hug' };

function modeFromValue(value: string): SizeMode {
  const trimmed = (value || '').trim();
  if (trimmed === '100%') return 'fill';
  if (trimmed === 'fit-content' || trimmed === 'auto') return 'hug';
  return 'fixed';
}

function valueForMode(mode: SizeMode, fixedPx: number): string {
  if (mode === 'fill') return '100%';
  if (mode === 'hug') return 'fit-content';
  return `${fixedPx}px`;
}

function readOnlyDisplay(mode: Exclude<SizeMode, 'fixed'>): string {
  return mode === 'fill' ? '100%' : 'auto';
}

/**
 * Mode glyph drawn inline so we don't depend on an icon library. Three shapes:
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
 *   - Fixed: editable text input, decimal-aware via FixedPxInput.
 *   - Fill:  read-only "100%".
 *   - Hug:   read-only "auto".
 * One icon button to the right cycles the mode (Fixed → Fill → Hug → Fixed).
 * When the value is a var(--token), renders the existing token chip + clear
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
    return match ? Number(match[1]) : 0;
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
          aria-label={`${ariaLabel} ${mode}`}
        />
      )}
      <button
        type="button"
        className="manual-edit-size-mode-btn"
        data-mode={mode}
        aria-label={`${label} mode: ${MODE_LABEL[mode]}`}
        title={`Switch to ${MODE_LABEL[next]}`}
        onClick={() => onChange(valueForMode(next, fixedPx || 120))}
      >
        <SizeModeIcon mode={mode} />
      </button>
    </div>
  );
}
```

Update the two `<SizeRow ...>` call sites in `StyleInspector` (around lines 721-740) to drop the now-unused `fixedLabel` / `fillLabel` / `hugLabel` props:

```typescript
<SizeRow label="Width" ariaLabel="width" value={styles.width} onChange={(v) => u('width', v)} />
<SizeRow label="Height" ariaLabel="height" value={styles.height} onChange={(v) => u('height', v)} />
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: all SizeRow specs PASS. The blur-emits-once spec (line 563) and Fixed-decimal spec from Task 1 still pass because they select via `input[inputmode="decimal"]`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ManualEditPanel.tsx apps/web/tests/components/ManualEditPanel.test.tsx
git commit -m "feat(manual-edit): SizeRow shows W/H value always + cycling mode icon"
```

---

## Task 3: Reorganize `StyleInspector` into new section order

**Files:**
- Modify: `apps/web/src/components/ManualEditPanel.tsx:687-799` (`StyleInspector`)
- Test: `apps/web/tests/components/ManualEditPanel.test.tsx` (add a section-order spec)

### Why

The current section order (`TYPOGRAPHY → SIZE → LAYOUT → BOX`) mixes Fill / Opacity / Padding / Margin / Border / Radius into one `BOX` wall. New order matches Figma: **Layout → Typography → Appearance → Fill → Stroke**, with Size, Flex, and Spacing as mini-sub-sections inside Layout.

- [ ] **Step 1: Add a failing test for section order**

Add inside the existing `describe('ManualEditPanel', () => { ... })`:

```typescript
it('renders sections in Layout → Typography → Appearance → Fill → Stroke order', () => {
  renderPanel({
    selectedTarget: { ...target, isLayoutContainer: true },
    styles: emptyManualEditStyles(),
  });

  const headers = Array.from(host.querySelectorAll('.cc-section > .cc-section-head'))
    .map((el) => el.textContent?.trim());
  expect(headers).toEqual(['Layout', 'Typography', 'Appearance', 'Fill', 'Stroke']);
});

it('renders Size / Flex / Spacing mini-sub-sections inside Layout', () => {
  renderPanel({
    selectedTarget: { ...target, isLayoutContainer: true },
    styles: emptyManualEditStyles(),
  });

  const layoutSection = Array.from(host.querySelectorAll('.cc-section'))
    .find((s) => s.querySelector('.cc-section-head')?.textContent?.trim() === 'Layout') as HTMLElement | undefined;
  if (!layoutSection) throw new Error('Layout section not found');

  const subs = Array.from(layoutSection.querySelectorAll('.cc-section-sub'))
    .map((el) => el.textContent?.trim());
  expect(subs).toEqual(['Size', 'Flex', 'Spacing']);
});

it('renders Stroke section with color, style, width quad, and radius', () => {
  renderPanel({
    selectedTarget: { ...target, isLayoutContainer: true },
    styles: emptyManualEditStyles(),
  });

  const sections = Array.from(host.querySelectorAll('.cc-section')) as HTMLElement[];
  const stroke = sections.find((s) => s.querySelector('.cc-section-head')?.textContent?.trim() === 'Stroke');
  if (!stroke) throw new Error('Stroke section not found');

  // Border style dropdown
  const styleSelect = stroke.querySelector('select');
  expect(styleSelect).not.toBeNull();
  // Width quad has four T/R/B/L cells
  expect(stroke.querySelectorAll('.cc-quad-cell').length).toBeGreaterThanOrEqual(4);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: all three new specs FAIL — current headers are `TYPOGRAPHY` / `SIZE` / `LAYOUT` / `BOX`, no `.cc-section-sub` exists, Stroke section doesn't exist yet.

- [ ] **Step 3: Add `SubSection` helper and rewrite `StyleInspector` JSX**

In `apps/web/src/components/ManualEditPanel.tsx`, just after the existing `Section` function (around line 808), add:

```typescript
function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cc-sub">
      <header className="cc-section-sub">{title}</header>
      <div className="cc-section-body">{children}</div>
    </div>
  );
}
```

Replace the entire `StyleInspector` body (the return statement around lines 698-798) with:

```typescript
return (
  <div className="cc-inspector">
    <div className="cc-inspector-nav">
      <button type="button" className="cc-inspector-page" onClick={onClearSelection} aria-label="Show page inspector">
        Page
      </button>
    </div>

    <Section title="Layout">
      <SubSection title="Size">
        <PairRow>
          <SizeRow label="W" ariaLabel="width" value={styles.width} onChange={(v) => u('width', v)} />
          <SizeRow label="H" ariaLabel="height" value={styles.height} onChange={(v) => u('height', v)} />
        </PairRow>
      </SubSection>

      <SubSection title="Flex">
        {!layoutEnabled ? (
          <p className="cc-section-hint">Select a container or group to edit flex layout.</p>
        ) : null}
        <PairRow>
          <UnitRow label="Gap" value={styles.gap} onChange={(v) => u('gap', v)} unit="px" autoUnit disabled={!layoutEnabled} variables={dsVariables} />
          <DropdownRow label="Direction" value={styles.flexDirection} onChange={(v) => u('flexDirection', v)} options={DIRECTION_OPTS} disabled={!layoutEnabled} />
        </PairRow>
        <PairRow>
          <DropdownRow label="Justify" value={styles.justifyContent} onChange={(v) => u('justifyContent', v)} options={JUSTIFY_OPTS} disabled={!layoutEnabled} />
          <DropdownRow label="Align" value={styles.alignItems} onChange={(v) => u('alignItems', v)} options={ITEMS_OPTS} disabled={!layoutEnabled} />
        </PairRow>
      </SubSection>

      <SubSection title="Spacing">
        <QuadRow label="Padding" values={{
          t: styles.paddingTop, r: styles.paddingRight, b: styles.paddingBottom, l: styles.paddingLeft,
        }} onChange={(side, value) => u(sideToProp('padding', side), value)} variables={dsVariables} />
        <QuadRow label="Margin" values={{
          t: styles.marginTop, r: styles.marginRight, b: styles.marginBottom, l: styles.marginLeft,
        }} onChange={(side, value) => u(sideToProp('margin', side), value)} variables={dsVariables} />
      </SubSection>
    </Section>

    <Section title="Typography">
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

    <Section title="Appearance">
      <UnitRow label="Opacity" value={styles.opacity} onChange={(v) => u('opacity', v)} unit="" variables={dsVariables} />
    </Section>

    <Section title="Fill">
      <ColorRow
        label="Fill"
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
    </Section>

    <Section title="Stroke">
      <PairRow>
        <ColorRow label="Color" value={styles.borderColor} onChange={(v) => u('borderColor', v)} variables={dsVariables} />
        <DropdownRow label="Style" value={styles.borderStyle} onChange={(v) => u('borderStyle', v)} options={BORDER_STYLE_OPTS} />
      </PairRow>
      <QuadRow label="Width" values={{
        t: styles.borderTopWidth, r: styles.borderRightWidth, b: styles.borderBottomWidth, l: styles.borderLeftWidth,
      }} onChange={(side, value) => u(`border${sideUpper(side)}Width` as keyof ManualEditStyles, value)} variables={dsVariables} />
      <UnitRow label="Radius" value={styles.borderRadius} onChange={(v) => u('borderRadius', v)} unit="px" autoUnit variables={dsVariables} />
    </Section>
  </div>
);
```

Two structural notes:
- Layout is always rendered (never wrapped in `inactive`). When the selected element isn't a layout container, the `Flex` sub-section displays the existing hint and the Gap/Direction/Justify/Align rows are `disabled` — same UX, just relocated.
- The W/H pair uses the existing `PairRow` grid (1fr 1fr) — that, with `SizeRow` wrapping each one, gives the side-by-side W / H look from the Figma reference.

- [ ] **Step 4: Run all SizeRow + section tests**

Run: `pnpm --filter @open-design/web test -- ManualEditPanel`
Expected: section-order specs PASS, sub-section specs PASS, Stroke spec PASS.

The layout-enabled specs (around lines 364-422) may need a minor update: `'renders layout as inactive for non-layout single targets'` historically inspected `Section title="LAYOUT"`. Update the assertion to look for the Flex sub-section instead:

```typescript
const flexSub = Array.from(host.querySelectorAll('.cc-section-sub'))
  .find((el) => el.textContent?.trim() === 'Flex');
expect(flexSub?.parentElement?.querySelector('.cc-section-hint')).not.toBeNull();
```

Run again to confirm.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ManualEditPanel.tsx apps/web/tests/components/ManualEditPanel.test.tsx
git commit -m "feat(manual-edit): reorganize StyleInspector into Figma-style sections"
```

---

## Task 4: CSS — section visuals, sub-headers, panel width, mode button

**Files:**
- Modify: `apps/web/src/index.css` (sections around lines 20659-20910 and 27208-27270)

### Why

The new section layout needs (a) sentence-case headers with stronger separation, (b) a mini-header style for Size / Flex / Spacing, (c) a styled mode button for SizeRow, (d) extra panel width so the side-by-side W/H pair breathes.

- [ ] **Step 1: Widen the panel grid template**

Edit `apps/web/src/index.css` line 20659-20668:

```css
.manual-edit-workspace {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) 300px;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 10px;
  background: var(--bg);
}
```

(Change `280px` → `300px` in the grid template.)

- [ ] **Step 2: Update section header typography and add divider**

Edit `apps/web/src/index.css` lines 20700-20706:

```css
.cc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.cc-section:first-of-type {
  padding-top: 0;
  border-top: 0;
}
.cc-section-inactive { opacity: 0.58; }
.cc-section-head {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text);
  padding: 0 0 2px;
  text-transform: none;
}
.cc-section-body { display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 3: Add sub-section style**

Append after the `.cc-section-body` rule:

```css
.cc-sub { display: flex; flex-direction: column; gap: 4px; }
.cc-section-sub {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 4px 0 2px;
}
```

- [ ] **Step 4: Style the size mode button**

Append near the existing `.manual-edit-size-input` rule (around line 27239):

```css
.manual-edit-size-mode-btn {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text-muted);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.manual-edit-size-mode-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--bg-subtle);
}
.manual-edit-size-mode-btn[data-mode="fill"],
.manual-edit-size-mode-btn[data-mode="hug"] {
  color: var(--accent, #2563eb);
  border-color: var(--accent, #2563eb);
}
```

Also tighten `.manual-edit-size-row` to align with the new shape (replace lines 27208-27213):

```css
.manual-edit-size-row {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2, #f6f6f7);
  border: 1px solid var(--border, #e4e4e7);
  border-radius: 4px;
  padding: 0 4px 0 8px;
  height: 26px;
  font-size: 12px;
}
.manual-edit-size-row:focus-within { border-color: var(--accent, #2563eb); }
.manual-edit-size-label {
  font-size: 11px;
  color: var(--text-muted);
  flex: 0 0 auto;
  padding-right: 4px;
}
.manual-edit-size-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--text);
  text-align: right;
  padding: 0;
  outline: none;
}
.manual-edit-size-input[readonly] {
  color: var(--accent, #2563eb);
  cursor: default;
}
```

The old `.manual-edit-size-toggle` / `.manual-edit-size-mode` / `.manual-edit-size-mode.active` rules (lines 27219-27238) are no longer used — remove them. Keep `.manual-edit-size-token` and `.manual-edit-size-clear` (still used for the token chip path).

- [ ] **Step 5: Manually verify the panel in a running app**

Run: `pnpm tools-dev run web --daemon-port 17456 --web-port 17573` in one terminal.

In another terminal:
```bash
pnpm tools-dev status --json
```

Confirm the web URL, open it in a browser, open an Edit-mode design file (any `.html` in a project), select an element. Confirm:
1. Sections appear in order: Layout, Typography, Appearance, Fill, Stroke.
2. W and H show numeric values directly; clicking the mode icon cycles Fixed/Fill/Hug; in Fill the input shows `100%` (read-only, accent-colored); in Hug it shows `auto`.
3. Typing `120.5050` into W on Fixed, blurring, persists the value (re-select the element; W still shows `120.5050`).
4. Section dividers (subtle top border) visible between Layout/Typography/etc.
5. Size, Flex, Spacing show as small uppercase mini-headers inside Layout.
6. Stop the dev server: `pnpm tools-dev stop`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/index.css
git commit -m "style(manual-edit): Figma-style section dividers, sub-headers, size mode button"
```

---

## Task 5: Validation — typecheck, full test suite, E2E smoke

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the web package**

Run: `pnpm --filter @open-design/web typecheck`
Expected: 0 errors. If the rewritten `SizeRow` introduced unused symbols (the old prop labels), remove them.

- [ ] **Step 2: Run the full web test suite**

Run: `pnpm --filter @open-design/web test`
Expected: all tests pass. Pay particular attention to:
- `tests/components/ManualEditPanel.test.tsx` (all SizeRow + new section specs).
- `tests/components/FileViewer.manual-edit.test.tsx` (must keep passing — it doesn't touch SizeRow internals).
- `tests/components/FileViewer.manual-edit-history.test.tsx` (history flows unchanged).

- [ ] **Step 3: Run the repo-level guard + typecheck**

Run: `pnpm guard && pnpm typecheck`
Expected: both pass.

- [ ] **Step 4: Run the E2E manual-edit smoke**

Run: `pnpm --filter @open-design/e2e test -- app-manual-edit`
Expected: pass. If any spec selects by visible label `SIZE` or `BOX`, update to `Layout` / `Fill` / `Stroke`. If any spec interacts with the W/H toggle via the old radio shape, replace with `button[data-mode]` clicks. (Existing E2E selectors were checked during planning and use `Width` / `Height` / `Background` / `Padding` text labels — should be stable.)

- [ ] **Step 5: Final commit (if any test fixups were needed)**

If only the changes above pass cleanly, no extra commit is needed and this task ends here. Otherwise commit any fixups:

```bash
git add -A
git commit -m "test(manual-edit): align E2E selectors with new section labels"
```

---

## Acceptance summary

After this plan is executed, the following are observable in the running app:

1. The right-hand Edit-mode panel is 300px wide (was 280px).
2. Section headers read `Layout`, `Typography`, `Appearance`, `Fill`, `Stroke` (sentence case, 12px, bold), separated by a thin top border.
3. Inside `Layout`: small uppercase mini-headers `SIZE`, `FLEX`, `SPACING`.
4. W and H sit side-by-side under SIZE. The numeric value is always visible. A small icon button to the right cycles Fixed → Fill → Hug. Read-only display in Fill (`100%`) and Hug (`auto`) is tinted accent-blue.
5. Typing `120.5050` into a Width on Fixed and blurring writes `width: 120.5050px` to the source file (verifiable via the on-disk HTML file the project is editing).
6. Selecting an element whose width is `var(--container-max)` still shows the token chip and Clear button (no data loss).
7. All existing tests pass; the new specs for decimal precision, always-visible value, mode cycling, and section order also pass.
