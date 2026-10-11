// NEW-D2-2 = a (Delivery 7, R-062): the activities a change request touches and their new durations.
import { describe, expect, it } from 'vitest';
import {
  canEditCrActivities, crActivitiesEditable, durationChangeText, isPendingDuration, isPlanActivityCode, parseCrActivities, parseNewDuration,
} from './change-activities';

describe('change request ↔ plan activities (NEW-D2-2)', () => {
  it('parses the form field: codes, each with an optional new duration', () => {
    expect(parseCrActivities('')).toEqual({ ok: true, value: [] });
    expect(parseCrActivities(undefined)).toEqual({ ok: true, value: [] });
    expect(parseCrActivities(' A1250=28, A1320 ;A1410=0 ')).toEqual({
      ok: true, value: [{ code: 'A1250', newDurationDays: 28 }, { code: 'A1320', newDurationDays: null }, { code: 'A1410', newDurationDays: 0 }],
    });
    for (const bad of ['A1250=', 'A1250=x', 'A1250=-3', 'A1250=1.5', 'A1250=99999', '=28', 'A1250=2=3', '<script>', 'A 1250=1=']) {
      expect(parseCrActivities(bad), bad).toEqual({ ok: false, error: 'Enter activity codes such as A1250 or A1250=28' });
    }
    expect(parseCrActivities('A1250, A1250=3')).toEqual({ ok: false, error: 'An activity is listed twice' });
    expect(parseCrActivities(Array.from({ length: 51 }, (_, i) => `A${1000 + i}`).join(','))).toEqual({ ok: false, error: 'Too many activities' });
  });

  it('a new duration is blank or a whole number of working days up to 3650', () => {
    expect([parseNewDuration(''), parseNewDuration(null), parseNewDuration('28'), parseNewDuration(0), parseNewDuration('3650')]).toEqual([
      { ok: true, value: null }, { ok: true, value: null }, { ok: true, value: 28 }, { ok: true, value: 0 }, { ok: true, value: 3650 },
    ]);
    for (const bad of ['3651', '-1', '2.5', 'abc', {}, true]) expect(parseNewDuration(bad).ok, String(bad)).toBe(false);
    expect([isPlanActivityCode('A1250'), isPlanActivityCode('WP-1.4_a'), isPlanActivityCode(''), isPlanActivityCode('A 1'), isPlanActivityCode(7)]).toEqual([true, true, false, false, false]);
  });

  it('links are edited on open requests by the project team, never by the client', () => {
    expect((['draft', 'in_review', 'approved', 'rejected'] as const).map(crActivitiesEditable)).toEqual([true, true, false, false]);
    expect([canEditCrActivities({ role: 'pm' }, true), canEditCrActivities({ role: 'director' }, true), canEditCrActivities({ role: 'client' }, true), canEditCrActivities({ role: 'pm' }, false)])
      .toEqual([true, true, false, false]);
  });

  it('the next Reschedule applies the new duration of an approved request, once', () => {
    expect(isPendingDuration({ newDurationDays: 28, appliedAt: null }, 'approved')).toBe(true);
    expect(isPendingDuration({ newDurationDays: 28, appliedAt: new Date() }, 'approved')).toBe(false);
    expect(isPendingDuration({ newDurationDays: null, appliedAt: null }, 'approved')).toBe(false);
    expect(isPendingDuration({ newDurationDays: 28, appliedAt: null }, 'in_review')).toBe(false);
    expect([durationChangeText(20, 28), durationChangeText(20, null), durationChangeText(null, 28)]).toEqual(['20d → 28d', '20d', '— → 28d']);
  });
});
