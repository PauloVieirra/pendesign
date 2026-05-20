import type { Dict } from '../i18n/types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type BreakpointPresetId = 'tailwind' | 'bootstrap';

export type BreakpointDef = { id: string; px: number };

export const BREAKPOINT_PRESETS: Record<BreakpointPresetId, ReadonlyArray<BreakpointDef>> = {
  tailwind: [
    { id: 'sm', px: 640 },
    { id: 'md', px: 768 },
    { id: 'lg', px: 1024 },
    { id: 'xl', px: 1280 },
    { id: '2xl', px: 1536 },
  ],
  bootstrap: [
    { id: 'sm', px: 576 },
    { id: 'md', px: 768 },
    { id: 'lg', px: 992 },
    { id: 'xl', px: 1200 },
    { id: 'xxl', px: 1400 },
  ],
};

const MINOR_TICK_PX = 100;
const RULER_MAX_PADDING_PX = 256;

export type BreakpointRulerProps = {
  width: number;
  height: number;
  preset: BreakpointPresetId;
  onPresetChange: (next: BreakpointPresetId) => void;
  t: TranslateFn;
};

export function BreakpointRuler({ width, height, preset, onPresetChange, t }: BreakpointRulerProps) {
  const stops = BREAKPOINT_PRESETS[preset];
  const activeIdx = computeActiveIndex(stops, width);
  const smallestId = stops[0]?.id ?? '';
  const isBelowSmallest = activeIdx === -1;

  // Track extends beyond the widest breakpoint so the user can drag past it
  // and still see ticks. The container clips overflow visually.
  const lastBp = stops[stops.length - 1]?.px ?? 1536;
  const rulerRange = Math.max(width + RULER_MAX_PADDING_PX, lastBp + RULER_MAX_PADDING_PX);
  const minorTicks: number[] = [];
  for (let x = MINOR_TICK_PX; x <= rulerRange; x += MINOR_TICK_PX) minorTicks.push(x);

  return (
    <div
      className="breakpoint-ruler"
      role="region"
      aria-label={t('fileViewer.breakpointPresetLabel')}
    >
      <select
        data-preset-select
        className="breakpoint-ruler-preset"
        value={preset}
        onChange={(e) => onPresetChange(e.currentTarget.value as BreakpointPresetId)}
        aria-label={t('fileViewer.breakpointPresetLabel')}
      >
        <option value="tailwind">{t('fileViewer.breakpointPresetTailwind')}</option>
        <option value="bootstrap">{t('fileViewer.breakpointPresetBootstrap')}</option>
      </select>

      <div className="breakpoint-ruler-track">
        {minorTicks.map((x) => {
          const isHundredsLabel = x % 200 === 0;
          return (
            <div
              key={`m-${x}`}
              data-minor-tick={x}
              className="breakpoint-ruler-minor"
              style={{ left: `${x}px` }}
            >
              {isHundredsLabel ? (
                <span className="breakpoint-ruler-minor-label">{x}</span>
              ) : null}
            </div>
          );
        })}

        {stops.map((bp, i) => (
          <div
            key={bp.id}
            data-breakpoint-id={bp.id}
            data-active-breakpoint={i === activeIdx ? 'true' : 'false'}
            className={`breakpoint-ruler-bp${i === activeIdx ? ' breakpoint-ruler-bp-active' : ''}`}
            style={{ left: `${bp.px}px` }}
          >
            <span className="breakpoint-ruler-bp-label">{bp.id}</span>
          </div>
        ))}

        <div
          data-current-width-indicator="true"
          className="breakpoint-ruler-indicator"
          style={{ left: `${Math.max(0, width)}px` }}
          aria-hidden
        >
          <div className="breakpoint-ruler-indicator-arrow" />
        </div>
      </div>

      <div
        data-ruler-badge
        className="breakpoint-ruler-badge"
      >
        {isBelowSmallest ? `< ${smallestId} · ` : ''}
        {Math.round(width)} × {Math.round(height)} px
      </div>
    </div>
  );
}

function computeActiveIndex(stops: ReadonlyArray<BreakpointDef>, width: number): number {
  let idx = -1;
  for (let i = 0; i < stops.length; i += 1) {
    if (stops[i]!.px <= width) idx = i;
  }
  return idx;
}
