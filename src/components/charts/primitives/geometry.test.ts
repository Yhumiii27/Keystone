import { describe, expect, it } from 'vitest';
import { areaPath, evmGrid, sparkPath, trendDelta, trendFrame } from './geometry';

describe('chart geometry', () => {
  it('sparkPath matches mini() (logic 4564)', () => {
    expect(sparkPath([1, 3, 2])).toBe('M0.0 30.0 L60.0 2.0 L120.0 16.0');
    expect(sparkPath([5, 5])).toBe('M0.0 16.0 L120.0 16.0');
  });

  it('evmGrid picks the first step with ymax/step ≤ 6.5', () => {
    expect(evmGrid(1170).step).toBe(200);
    expect(evmGrid(5616).step).toBe(1000);
    expect(evmGrid(600).ticks).toEqual([0, 100, 200, 300, 400, 500, 600]);
  });

  it('trendFrame pads the range by 15 % and closes the area at the baseline', () => {
    const f = trendFrame([1, 2], 760, 220, null);
    expect(f.lo).toBeCloseTo(0.85);
    expect(f.hi).toBeCloseTo(2.15);
    expect(f.area.endsWith('L744.0 194 L48 194 Z')).toBe(true);
    expect(f.grid.map((g) => g.y)).toEqual([14, 59, 104, 149, 194]);
  });

  it('areaPath', () => {
    expect(areaPath([[0, 10], [10, 5]], 20)).toBe('M0.0 10.0 L10.0 5.0 L10.0 20 L0 20 Z');
  });

  it('trendDelta compares with 4 snapshots earlier', () => {
    expect(trendDelta([1, 2, 3, 4, 5, 6], false)).toEqual({ last: 6, prev: 2, delta: 4, worse: false });
    expect(trendDelta([1, 2, 3, 4, 5, 6], true).worse).toBe(true);
  });
});
