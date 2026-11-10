// D9-09 / D9-10 (R-060): data date rules and the Friday freeze figures (src/domain/data-date.ts); D9-11 / D9-12 (R-063): the
// baseline rules of src/domain/baseline-policy.ts.
import { describe, expect, it } from 'vitest';
import { approvedBaselineBecomesCurrent } from './baseline-policy';
import { DEMO_TODAY_ISO } from './clock';
import { DATA_DATE_ERRORS, criticalFloatDays, dataDateError, fridayOnOrBefore, frozenIndex, milestoneSlipDays, proposedDataDate } from './data-date';

describe('D9-09 — the data date', () => {
  it('the week’s Friday: the latest Friday up to today', () => {
    // DEMO_TODAY_ISO is Friday 25 Sep 2026.
    expect([fridayOnOrBefore(DEMO_TODAY_ISO), fridayOnOrBefore('2026-09-28'), fridayOnOrBefore('2026-10-01'), fridayOnOrBefore('2026-10-03')])
      .toEqual(['2026-09-25', '2026-09-25', '2026-09-25', '2026-10-02']);
  });

  it('Keystone proposes that Friday while the stored date is unset or older', () => {
    expect([proposedDataDate(null, '2026-09-29'), proposedDataDate('2026-09-18', '2026-09-29'), proposedDataDate('2026-09-25', '2026-09-29'), proposedDataDate('2026-09-28', '2026-09-29')])
      .toEqual(['2026-09-25', '2026-09-25', null, null]);
  });

  it('the PM moves it forward, never after today, never backwards', () => {
    const today = DEMO_TODAY_ISO;
    expect([
      dataDateError('2026-09-18', null, today), dataDateError('2026-09-25', '2026-09-18', today), dataDateError('2026-09-26', null, today),
      dataDateError('2026-09-11', '2026-09-18', today), dataDateError('2026-09-18', '2026-09-18', today), dataDateError('2026-02-30', null, today), dataDateError(42, null, today),
    ]).toEqual([null, null, DATA_DATE_ERRORS.future, DATA_DATE_ERRORS.backwards, DATA_DATE_ERRORS.unchanged, DATA_DATE_ERRORS.invalid, DATA_DATE_ERRORS.invalid]);
  });
});

describe('D9-10 — the Friday freeze figures', () => {
  it('milestone slip: the largest delay of an open milestone on its baseline', () => {
    expect(milestoneSlipDays([
      { finish: '2026-10-12', baselineFinish: '2026-10-02', done: false },
      { finish: '2026-11-20', baselineFinish: '2026-11-01', done: true },
      { finish: '2026-09-28', baselineFinish: '2026-10-01', done: false },
      { finish: null, baselineFinish: '2026-10-01', done: false },
    ])).toBe(10);
    expect(milestoneSlipDays([])).toBe(0);
  });

  it('critical float: the smallest total float of the unfinished activities', () => {
    expect(criticalFloatDays([{ totalFloatDays: 4, finished: false }, { totalFloatDays: -6, finished: true }, { totalFloatDays: -2, finished: false }, { totalFloatDays: null, finished: false }])).toBe(-2);
    expect(criticalFloatDays([])).toBe(0);
  });

  it('indices to two decimals; none = 1', () => {
    expect([frozenIndex(0.9349), frozenIndex(null), frozenIndex(Infinity)]).toEqual([0.93, 1, 1]);
  });
});

describe('D9-12 — the highest baseline stays current', () => {
  it('an older request approved after a newer one leaves BL3 current', () => {
    expect([
      approvedBaselineBecomesCurrent('BL3', 'BL2'), approvedBaselineBecomesCurrent('BL2', 'BL3'), approvedBaselineBecomesCurrent('BL2', null),
      approvedBaselineBecomesCurrent('BL10', 'BL9'), approvedBaselineBecomesCurrent('BL4', 'BL4'),
    ]).toEqual([true, false, true, true, true]);
  });
});
