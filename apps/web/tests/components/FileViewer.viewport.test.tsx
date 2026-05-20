import { describe, expect, it } from 'vitest';
import { BREAKPOINT_PRESETS } from '../../src/components/BreakpointRuler';

function snapWidth(width: number, presetId: 'tailwind' | 'bootstrap'): number {
  const stops = BREAKPOINT_PRESETS[presetId];
  const closest = stops.reduce((acc: number, bp) =>
    Math.abs(bp.px - width) < Math.abs(acc - width) ? bp.px : acc,
  stops[0]!.px);
  return Math.abs(closest - width) <= 12 ? closest : width;
}

describe('responsive snap math', () => {
  it('snaps to 768 (md) when width is 760 with Tailwind', () => {
    expect(snapWidth(760, 'tailwind')).toBe(768);
  });

  it('does not snap when width is 720 (>12px away from md=768)', () => {
    expect(snapWidth(720, 'tailwind')).toBe(720);
  });

  it('snaps to 992 (lg) when width is 1000 with Bootstrap', () => {
    expect(snapWidth(1000, 'bootstrap')).toBe(992);
  });
});
