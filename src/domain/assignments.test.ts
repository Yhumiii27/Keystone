import { describe, expect, it } from 'vitest';
import { parseAssignmentQuantities, parseProgressHours, parseUnits } from './assignments';

describe('assignment quantities (A1250_RES)', () => {
  it('parses the four A1250 assignments', () => {
    expect([
      ['40 h/wk', '296 / 400 h'], ['6 × 10 h/d', '1,840 / 2,400 h'], ['1 unit', '28 / 40 d'], ['184 t', '132 t installed'],
    ].map(([u, p]) => parseAssignmentQuantities(u, p))).toEqual([
      { resourceCount: 1, hoursPerDay: 8, plannedHours: 400, actualHours: 296 },
      { resourceCount: 6, hoursPerDay: 10, plannedHours: 2400, actualHours: 1840 },
      { resourceCount: 1, hoursPerDay: null, plannedHours: null, actualHours: null },
      { resourceCount: null, hoursPerDay: null, plannedHours: null, actualHours: null },
    ]);
  });
  it('synthesised owner rows and variants', () => {
    expect(parseUnits('8 h/d')).toEqual({ resourceCount: 1, hoursPerDay: 8 });
    expect(parseUnits('2 x 7,5 h/day')).toEqual({ resourceCount: 2, hoursPerDay: 7.5 });
    expect(parseUnits('')).toEqual({ resourceCount: null, hoursPerDay: null });
    expect(parseProgressHours('0 / 160 h')).toEqual({ actualHours: 0, plannedHours: 160 });
    expect(parseProgressHours('12,5 / 40 h')).toEqual({ actualHours: 12.5, plannedHours: 40 });
    expect(parseProgressHours(null)).toEqual({ actualHours: null, plannedHours: null });
  });
});
