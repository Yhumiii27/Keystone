// L-4c = a (Delivery 7, R-055): the effective date of a stage change — today (the project's data date) by default, not
// before the previous change, not after today.
import { describe, expect, it } from 'vitest';
import { defaultEffectiveDate, effectiveDateError } from './lifecycle';

const B = { previous: '2026-09-10', today: '2026-09-25' };

describe('effective date of a stage change (L-4c)', () => {
  it('defaults to today, or to the previous change when the history is dated after the data date', () => {
    expect(defaultEffectiveDate(B)).toBe('2026-09-25');
    expect(defaultEffectiveDate({ previous: null, today: '2026-09-25' })).toBe('2026-09-25');
    expect(defaultEffectiveDate({ previous: '2026-10-02', today: '2026-09-25' })).toBe('2026-10-02');
  });

  it('accepts any day from the previous change to today (bounds included)', () => {
    for (const d of ['2026-09-10', '2026-09-24', '2026-09-25']) expect(effectiveDateError(d, B)).toBeNull();
    expect(effectiveDateError('2020-01-01', { previous: null, today: '2026-09-25' })).toBeNull();
  });

  it('refuses a date after today, before the previous change, or not a calendar date', () => {
    expect(effectiveDateError('2026-09-26', B)).toBe('The effective date cannot be after today');
    expect(effectiveDateError('2026-09-09', B)).toBe('The effective date cannot be before the previous stage change');
    for (const bad of ['', '25/09/2026', '2026-02-30', '2026-9-1', 20260925, null, undefined, '2026-09-25T00:00'])
      expect(effectiveDateError(bad, B)).toBe('Enter a valid effective date');
  });
});
