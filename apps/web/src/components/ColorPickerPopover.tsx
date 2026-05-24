import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VariablesFile } from '../providers/design-system-variables';
import { Icon } from './Icon';

/**
 * Modern color picker. Supports solid (hex/rgba) and linear-gradient with
 * multiple stops and direction. Emits a string the caller can drop into
 * `background-color` (solid) or `background-image` (gradient). For solid
 * values the picker exposes hue/saturation/value + alpha; for gradients it
 * exposes the same picker for the active stop plus a strip of stops and an
 * angle dial.
 */

type Mode = 'solid' | 'gradient';

interface RGB { r: number; g: number; b: number }
interface HSV { h: number; s: number; v: number }

interface Stop { color: string; position: number }
interface GradientValue { type: 'linear'; angle: number; stops: Stop[] }

export interface ColorPickerPopoverProps {
  value: string;
  onChange: (next: string) => void;
  /** When true, the user can switch to gradient mode. Defaults to false. */
  allowGradient?: boolean;
  variables?: VariablesFile | null;
  /** Element the popover anchors to on first open. Used to position the
   * popover near the trigger while keeping a safe gap from viewport edges. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Called when ESC is pressed or the user clicks outside the popover. */
  onClose?: () => void;
}

const POPOVER_WIDTH = 240;
// Approximate popover height for first-frame clamping; the real measurement
// is read after mount and re-clamps if needed.
const POPOVER_HEIGHT_ESTIMATE = 540;
const VIEWPORT_MARGIN = 12;

interface Position { top: number; left: number }

function clampPositionToViewport(position: Position, size: { width: number; height: number }): Position {
  if (typeof window === 'undefined') return position;
  const maxLeft = window.innerWidth - size.width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - size.height - VIEWPORT_MARGIN;
  return {
    top: clamp(position.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, maxTop)),
    left: clamp(position.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, maxLeft)),
  };
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#000000',
  '#525252', '#a3a3a3', '#e5e5e5', '#ffffff',
];

// --- Color math --------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex: string): RGB | null {
  const trimmed = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    const r = parseInt(trimmed[0]! + trimmed[0]!, 16);
    const g = parseInt(trimmed[1]! + trimmed[1]!, 16);
    const b = parseInt(trimmed[2]! + trimmed[2]!, 16);
    return { r, g, b };
  }
  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return {
      r: parseInt(trimmed.slice(0, 2), 16),
      g: parseInt(trimmed.slice(2, 4), 16),
      b: parseInt(trimmed.slice(4, 6), 16),
    };
  }
  return null;
}

function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function parseColor(value: string): { rgb: RGB; a: number } | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v);
    return rgb ? { rgb, a: 1 } : null;
  }
  const rgba = /^rgba?\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d*\.?\d+)\s*)?\)$/i.exec(v);
  if (rgba) {
    return {
      rgb: { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) },
      a: rgba[4] != null ? clamp(Number(rgba[4]), 0, 1) : 1,
    };
  }
  return null;
}

function formatColor(rgb: RGB, a: number): string {
  if (a >= 1) return rgbToHex(rgb);
  const r = Math.round(clamp(rgb.r, 0, 255));
  const g = Math.round(clamp(rgb.g, 0, 255));
  const b = Math.round(clamp(rgb.b, 0, 255));
  const alpha = Number(a.toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Parse `linear-gradient(<angle>deg, <color> <pos>%, ...)`. Only linear is
// supported; everything else returns null and the picker falls back to solid.
function parseGradient(value: string): GradientValue | null {
  const match = /^linear-gradient\((.+)\)$/is.exec(value.trim());
  if (!match) return null;
  const inner = match[1]!;
  const parts = splitTopLevelCommas(inner);
  let angle = 180;
  let cursor = 0;
  const head = parts[0]!.trim();
  const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/i.exec(head);
  if (angleMatch) { angle = Number(angleMatch[1]); cursor = 1; }
  const stops: Stop[] = [];
  for (let i = cursor; i < parts.length; i++) {
    const stopText = parts[i]!.trim();
    const stopMatch = /^(.+?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(stopText);
    if (!stopMatch) continue;
    const colorText = stopMatch[1]!.trim();
    const posText = stopMatch[2];
    const parsed = parseColor(colorText);
    if (!parsed) continue;
    stops.push({
      color: formatColor(parsed.rgb, parsed.a),
      position: posText != null ? Number(posText) : ((i - cursor) / Math.max(1, parts.length - cursor - 1)) * 100,
    });
  }
  if (stops.length < 2) return null;
  return { type: 'linear', angle, stops };
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function formatGradient(g: GradientValue): string {
  const stops = g.stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${Math.round(s.position)}%`)
    .join(', ');
  return `linear-gradient(${Math.round(g.angle)}deg, ${stops})`;
}

function gradientPreviewCss(g: GradientValue): string {
  return formatGradient({ ...g, angle: 90 });
}

// Resolve `var(--token)` for swatches inside the picker. Falls back to the
// raw value so the caller can still preview an unresolvable token.
function resolveSwatchColor(value: string, variables: VariablesFile | null | undefined): string {
  if (!variables) return value;
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!match) return value;
  const target = match[1]!;
  for (const collection of variables.collections) {
    for (const group of collection.groups) {
      for (const variable of group.variables) {
        if (variable.type !== 'color') continue;
        const slug = `--${slugify(collection.name)}-${slugify(group.name)}-${slugify(variable.name)}`;
        if (slug === target) return String(variable.value);
      }
    }
  }
  return value;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// --- Sliders -----------------------------------------------------------

function usePointerDrag(
  ref: React.RefObject<HTMLElement>,
  onMove: (clientX: number, clientY: number, rect: DOMRect) => void,
): (ev: React.PointerEvent<HTMLElement>) => void {
  const handler = useCallback((ev: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture(ev.pointerId);
    const rect = el.getBoundingClientRect();
    onMove(ev.clientX, ev.clientY, rect);
    const move = (e: PointerEvent) => onMove(e.clientX, e.clientY, rect);
    const up = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }, [onMove, ref]);
  return handler;
}

function SVPicker({ h, s, v, onChange }: { h: number; s: number; v: number; onChange: (s: number, v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = usePointerDrag(ref, (clientX, clientY, rect) => {
    const nextS = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nextV = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    onChange(nextS, nextV);
  });
  return (
    <div
      ref={ref}
      className="cpx-sv"
      style={{ background: `hsl(${h}, 100%, 50%)` }}
      onPointerDown={start}
    >
      <div className="cpx-sv-sat" />
      <div className="cpx-sv-val" />
      <div
        className="cpx-sv-thumb"
        style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
      />
    </div>
  );
}

function HueSlider({ h, onChange }: { h: number; onChange: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = usePointerDrag(ref, (clientX, _y, rect) => {
    onChange(clamp((clientX - rect.left) / rect.width, 0, 1) * 360);
  });
  return (
    <div ref={ref} className="cpx-hue" onPointerDown={start}>
      <div className="cpx-hue-thumb" style={{ left: `${(h / 360) * 100}%` }} />
    </div>
  );
}

function AlphaSlider({ rgb, a, onChange }: { rgb: RGB; a: number; onChange: (a: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = usePointerDrag(ref, (clientX, _y, rect) => {
    onChange(clamp((clientX - rect.left) / rect.width, 0, 1));
  });
  const opaque = formatColor(rgb, 1);
  return (
    <div ref={ref} className="cpx-alpha" onPointerDown={start}>
      <div
        className="cpx-alpha-fill"
        style={{ background: `linear-gradient(to right, ${rgbToRgba(rgb, 0)}, ${opaque})` }}
      />
      <div className="cpx-alpha-thumb" style={{ left: `${a * 100}%` }} />
    </div>
  );
}

function rgbToRgba(rgb: RGB, a: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

// --- Main popover ------------------------------------------------------

export function ColorPickerPopover({ value, onChange, allowGradient = false, variables = null, anchorRef, onClose }: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // Position is null on first render so we can measure the anchor and place
  // the popover near it; after mount it becomes a concrete {top, left}.
  const [position, setPosition] = useState<Position | null>(null);
  // True while the user is dragging the popover by its header so we know
  // not to re-anchor on viewport resize / scroll while a drag is in flight.
  const draggingRef = useRef(false);

  // Initial placement next to the anchor + clamp to viewport.
  useLayoutEffect(() => {
    if (position) return; // only run once per open
    const anchor = anchorRef?.current;
    let initial: Position;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      // Prefer placing the popover under the anchor, right-aligned to it.
      // Clamp brings it back inside the viewport when there is not enough
      // space — this is what was clipping the picker before.
      const measuredHeight = popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
      initial = {
        top: rect.bottom + 6,
        left: rect.right - POPOVER_WIDTH,
      };
      // If there is more room above than below the anchor, flip up.
      if (initial.top + measuredHeight > window.innerHeight - VIEWPORT_MARGIN && rect.top > window.innerHeight - rect.bottom) {
        initial.top = rect.top - measuredHeight - 6;
      }
    } else {
      initial = { top: 80, left: 80 };
    }
    setPosition(clampPositionToViewport(initial, {
      width: POPOVER_WIDTH,
      height: popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE,
    }));
  }, [anchorRef, position]);

  // Re-clamp when the viewport changes (resize / scroll) so the popover
  // can't get stranded outside the visible area.
  useEffect(() => {
    if (!position) return;
    const onViewportChange = () => {
      if (draggingRef.current || !popoverRef.current) return;
      setPosition((current) => current ? clampPositionToViewport(current, {
        width: popoverRef.current!.offsetWidth || POPOVER_WIDTH,
        height: popoverRef.current!.offsetHeight || POPOVER_HEIGHT_ESTIMATE,
      }) : current);
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [position]);

  // ESC closes; click outside the popover (and outside the trigger) closes.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose, anchorRef]);

  // Drag handle on the header lets the user reposition the popover anywhere
  // inside the viewport (still clamped). Without this they were stuck with
  // wherever the auto-placement landed.
  const onHeaderPointerDown = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (!popoverRef.current || !position) return;
    // Ignore drags that start on the tab buttons (let the click reach them).
    const target = ev.target as HTMLElement;
    if (target.closest('.cpx-tab')) return;
    ev.preventDefault();
    draggingRef.current = true;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startPos = { ...position };
    const size = {
      width: popoverRef.current.offsetWidth || POPOVER_WIDTH,
      height: popoverRef.current.offsetHeight || POPOVER_HEIGHT_ESTIMATE,
    };
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      setPosition(clampPositionToViewport({
        top: startPos.top + (e.clientY - startY),
        left: startPos.left + (e.clientX - startX),
      }, size));
    };
    const up = (e: PointerEvent) => {
      draggingRef.current = false;
      try { (ev.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [position]);

  // -- Picker state (unchanged from before) --
  // Initial mode + state derived from the incoming value. A `linear-gradient`
  // opens the picker in gradient mode with its stops; anything else opens
  // in solid mode with the resolved color (var() bindings get resolved
  // against the project's DS variables for display).
  const initial = useMemo(() => {
    const g = parseGradient(value);
    if (g && allowGradient) return { mode: 'gradient' as Mode, gradient: g, solid: parseColor(g.stops[0]!.color) ?? { rgb: { r: 0, g: 0, b: 0 }, a: 1 } };
    const resolved = resolveSwatchColor(value, variables);
    const solid = parseColor(resolved) ?? { rgb: { r: 0, g: 0, b: 0 }, a: 1 };
    return { mode: 'solid' as Mode, gradient: null as GradientValue | null, solid };
  }, [value, variables, allowGradient]);

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(initial.solid.rgb));
  const [alpha, setAlpha] = useState<number>(initial.solid.a);
  const [gradient, setGradient] = useState<GradientValue>(() =>
    initial.gradient ?? {
      type: 'linear',
      angle: 180,
      stops: [
        { color: formatColor(initial.solid.rgb, initial.solid.a), position: 0 },
        { color: '#ffffff', position: 100 },
      ],
    },
  );
  const [activeStop, setActiveStop] = useState<number>(0);
  const [hexInput, setHexInput] = useState<string>(rgbToHex(initial.solid.rgb).replace('#', '').toUpperCase());

  // When the user drives the SV / hue / alpha sliders, the new color either
  // updates the solid output or the active gradient stop. We then push the
  // composed value up to the caller.
  const emit = useCallback((m: Mode, h: HSV, a: number, g: GradientValue, idx: number) => {
    if (m === 'solid') {
      const rgb = hsvToRgb(h);
      onChange(formatColor(rgb, a));
      return;
    }
    const rgb = hsvToRgb(h);
    const nextStop = { ...g.stops[idx]!, color: formatColor(rgb, a) };
    const nextStops = g.stops.slice();
    nextStops[idx] = nextStop;
    onChange(formatGradient({ ...g, stops: nextStops }));
  }, [onChange]);

  const updateColor = useCallback((nextHsv: HSV, nextAlpha: number) => {
    setHsv(nextHsv);
    setAlpha(nextAlpha);
    setHexInput(rgbToHex(hsvToRgb(nextHsv)).replace('#', '').toUpperCase());
    if (mode === 'gradient') {
      const rgb = hsvToRgb(nextHsv);
      const nextStops = gradient.stops.slice();
      nextStops[activeStop] = { ...nextStops[activeStop]!, color: formatColor(rgb, nextAlpha) };
      const nextGradient = { ...gradient, stops: nextStops };
      setGradient(nextGradient);
      onChange(formatGradient(nextGradient));
    } else {
      emit('solid', nextHsv, nextAlpha, gradient, activeStop);
    }
  }, [mode, gradient, activeStop, emit, onChange]);

  const commitHex = useCallback((raw: string) => {
    const cleaned = raw.replace(/^#/, '').toUpperCase();
    setHexInput(cleaned);
    const parsed = hexToRgb(`#${cleaned}`);
    if (!parsed) return;
    const nextHsv = rgbToHsv(parsed);
    updateColor(nextHsv, alpha);
  }, [updateColor, alpha]);

  const commitAlphaPercent = useCallback((raw: string) => {
    const n = Number(raw.replace('%', '').trim());
    if (!Number.isFinite(n)) return;
    updateColor(hsv, clamp(n, 0, 100) / 100);
  }, [updateColor, hsv]);

  // --- Gradient ops ---
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'gradient') {
      // Seed gradient from the current solid value if it's not initialized.
      const current = formatColor(hsvToRgb(hsv), alpha);
      const seeded: GradientValue = {
        type: 'linear', angle: 180,
        stops: [{ color: current, position: 0 }, { color: '#ffffff', position: 100 }],
      };
      setGradient(seeded);
      setActiveStop(0);
      setMode('gradient');
      onChange(formatGradient(seeded));
    } else {
      // Drop back to the active stop's color when leaving gradient mode.
      const active = gradient.stops[activeStop] ?? gradient.stops[0]!;
      const parsed = parseColor(active.color) ?? { rgb: hsvToRgb(hsv), a: alpha };
      const nextHsv = rgbToHsv(parsed.rgb);
      setHsv(nextHsv);
      setAlpha(parsed.a);
      setMode('solid');
      onChange(formatColor(parsed.rgb, parsed.a));
    }
  };

  const setStopActive = (idx: number) => {
    setActiveStop(idx);
    const stop = gradient.stops[idx];
    if (!stop) return;
    const parsed = parseColor(stop.color);
    if (!parsed) return;
    setHsv(rgbToHsv(parsed.rgb));
    setAlpha(parsed.a);
    setHexInput(rgbToHex(parsed.rgb).replace('#', '').toUpperCase());
  };

  const addStop = (positionHint?: number) => {
    const sorted = gradient.stops.slice().sort((a, b) => a.position - b.position);
    const position = positionHint != null ? positionHint : 50;
    // Interpolate from neighbors for a sensible default color.
    const before = [...sorted].reverse().find((s) => s.position <= position) ?? sorted[0]!;
    const after = sorted.find((s) => s.position >= position) ?? sorted[sorted.length - 1]!;
    const t = before === after ? 0 : (position - before.position) / Math.max(1, after.position - before.position);
    const a = parseColor(before.color) ?? { rgb: { r: 0, g: 0, b: 0 }, a: 1 };
    const b = parseColor(after.color) ?? a;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    const newColor: Stop = {
      color: formatColor({ r: lerp(a.rgb.r, b.rgb.r), g: lerp(a.rgb.g, b.rgb.g), b: lerp(a.rgb.b, b.rgb.b) }, lerp(a.a, b.a)),
      position,
    };
    const next = { ...gradient, stops: [...gradient.stops, newColor] };
    setGradient(next);
    setActiveStop(next.stops.length - 1);
    setStopActive(next.stops.length - 1);
    onChange(formatGradient(next));
  };

  const removeStop = (idx: number) => {
    if (gradient.stops.length <= 2) return;
    const nextStops = gradient.stops.filter((_, i) => i !== idx);
    const next = { ...gradient, stops: nextStops };
    setGradient(next);
    const nextActive = clamp(activeStop > idx ? activeStop - 1 : activeStop, 0, nextStops.length - 1);
    setActiveStop(nextActive);
    setStopActive(nextActive);
    onChange(formatGradient(next));
  };

  const setStopPosition = (idx: number, position: number) => {
    const nextStops = gradient.stops.slice();
    nextStops[idx] = { ...nextStops[idx]!, position: clamp(position, 0, 100) };
    const next = { ...gradient, stops: nextStops };
    setGradient(next);
    onChange(formatGradient(next));
  };

  const setAngle = (angle: number) => {
    const next = { ...gradient, angle: ((angle % 360) + 360) % 360 };
    setGradient(next);
    onChange(formatGradient(next));
  };

  // --- Saved colors (DS variables) ---
  const dsColors: Array<{ slug: string; value: string; name: string }> = [];
  if (variables) {
    for (const collection of variables.collections) {
      for (const group of collection.groups) {
        for (const variable of group.variables) {
          if (variable.type !== 'color') continue;
          const slug = `--${slugify(collection.name)}-${slugify(group.name)}-${slugify(variable.name)}`;
          dsColors.push({ slug, value: String(variable.value), name: variable.name });
        }
      }
    }
  }

  const currentRgb = hsvToRgb(hsv);

  const body = (
    <div
      ref={popoverRef}
      className="cpx cpx-floating"
      role="dialog"
      aria-label="Color picker"
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: POPOVER_WIDTH,
        visibility: position ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
    >
      <div
        className="cpx-header"
        onPointerDown={onHeaderPointerDown}
        role="presentation"
      >
        <span className="cpx-header-handle" aria-hidden="true">⋮⋮</span>
        {allowGradient ? (
          <div className="cpx-tabs">
            <button type="button" className={`cpx-tab${mode === 'solid' ? ' cpx-tab-active' : ''}`} onClick={() => switchMode('solid')}>Solid</button>
            <button type="button" className={`cpx-tab${mode === 'gradient' ? ' cpx-tab-active' : ''}`} onClick={() => switchMode('gradient')}>Gradient</button>
          </div>
        ) : <span className="cpx-header-title">Color</span>}
        {onClose ? (
          <button type="button" className="cpx-close" aria-label="Close color picker" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </div>

      <SVPicker h={hsv.h} s={hsv.s} v={hsv.v} onChange={(s, v) => updateColor({ h: hsv.h, s, v }, alpha)} />
      <HueSlider h={hsv.h} onChange={(h) => updateColor({ ...hsv, h }, alpha)} />
      <AlphaSlider rgb={currentRgb} a={alpha} onChange={(a) => updateColor(hsv, a)} />

      <div className="cpx-inputs">
        <span className="cpx-input cpx-input-hex">
          <em className="cpx-input-prefix">#</em>
          <input
            value={hexInput}
            maxLength={6}
            spellCheck={false}
            onChange={(e) => commitHex(e.currentTarget.value)}
            aria-label="Hex value"
          />
        </span>
        <span className="cpx-input cpx-input-alpha">
          <input
            value={`${Math.round(alpha * 100)}`}
            onChange={(e) => commitAlphaPercent(e.currentTarget.value)}
            aria-label="Alpha percentage"
            inputMode="numeric"
          />
          <em className="cpx-input-suffix">%</em>
        </span>
      </div>

      {mode === 'gradient' ? (
        <div className="cpx-gradient">
          <div
            className="cpx-gradient-strip"
            style={{ background: gradientPreviewCss(gradient) }}
            onPointerDown={(ev) => {
              const rect = ev.currentTarget.getBoundingClientRect();
              const position = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100);
              addStop(position);
            }}
          >
            {gradient.stops.map((stop, idx) => (
              <GradientStop
                key={idx}
                stop={stop}
                active={idx === activeStop}
                onActivate={() => setStopActive(idx)}
                onMove={(position) => setStopPosition(idx, position)}
                onRemove={() => removeStop(idx)}
                canRemove={gradient.stops.length > 2}
              />
            ))}
          </div>
          <div className="cpx-gradient-controls">
            <label className="cpx-angle">
              <span>Angle</span>
              <input
                type="number"
                value={Math.round(gradient.angle)}
                min={0}
                max={360}
                onChange={(e) => setAngle(Number(e.currentTarget.value))}
                aria-label="Gradient angle in degrees"
              />
              <em>°</em>
            </label>
            <button type="button" className="cpx-gradient-add" onClick={() => addStop()} aria-label="Add stop">
              <Icon name="plus" size={11} /> Add stop
            </button>
          </div>
        </div>
      ) : null}

      {dsColors.length > 0 ? (
        <div className="cpx-section">
          <div className="cpx-section-title">DS Colors</div>
          <div className="cpx-swatches">
            {dsColors.map((c) => (
              <button
                key={c.slug}
                type="button"
                className="cpx-swatch"
                title={`${c.name} (var(${c.slug}))`}
                style={{ background: c.value }}
                onClick={() => onChange(`var(${c.slug})`)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="cpx-section">
        <div className="cpx-section-title">Presets</div>
        <div className="cpx-swatches">
          {PRESET_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              className="cpx-swatch"
              title={hex}
              style={{ background: hex }}
              onClick={() => {
                const parsed = hexToRgb(hex);
                if (!parsed) return;
                updateColor(rgbToHsv(parsed), 1);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return body;
  return createPortal(body, document.body);
}

function GradientStop({ stop, active, onActivate, onMove, onRemove, canRemove }: {
  stop: Stop;
  active: boolean;
  onActivate: () => void;
  onMove: (position: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Doppelgänger so the visual swatch shows the resolved fill of the stop
    // (rgba including alpha) on top of a checkerboard.
  }, [stop.color]);
  const onPointerDown = (ev: React.PointerEvent<HTMLButtonElement>) => {
    ev.stopPropagation();
    onActivate();
    const strip = ref.current?.parentElement;
    if (!strip) return;
    strip.setPointerCapture(ev.pointerId);
    const rect = strip.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const position = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
      onMove(position);
    };
    const up = (e: PointerEvent) => {
      strip.releasePointerCapture(e.pointerId);
      strip.removeEventListener('pointermove', move);
      strip.removeEventListener('pointerup', up);
      strip.removeEventListener('pointercancel', up);
    };
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up);
    strip.addEventListener('pointercancel', up);
  };
  return (
    <button
      ref={ref}
      type="button"
      className={`cpx-gradient-stop${active ? ' cpx-gradient-stop-active' : ''}`}
      style={{ left: `${stop.position}%`, background: stop.color }}
      onPointerDown={onPointerDown}
      onDoubleClick={(ev) => { ev.stopPropagation(); if (canRemove) onRemove(); }}
      aria-label={`Gradient stop at ${Math.round(stop.position)}%`}
      title={canRemove ? `${Math.round(stop.position)}% — double click to remove` : `${Math.round(stop.position)}%`}
    />
  );
}
