// R-116 (Q-4 a): the "Received on" date of "Mark received" — typed in either language, required, never after today.
import { describe, expect, it } from 'vitest';
import { DATE_ERROR } from './contract';
import { RECEIVED_AFTER_TODAY, parseReceivedOn } from './team';

const TODAY = '2026-09-30';

describe('parseReceivedOn (Q-4 a)', () => {
  it('reads the dialog default in both languages and other typed forms', () => {
    for (const raw of ['30 Sep 2026', '30 sept. 2026', '30/09/2026', '2026-09-30', '30 Sep']) expect(parseReceivedOn(raw, TODAY)).toEqual({ ok: true, value: '2026-09-30' });
    expect(parseReceivedOn('28 sept. 2026', TODAY)).toEqual({ ok: true, value: '2026-09-28' });
    expect(parseReceivedOn('12 Jan 2025', TODAY)).toEqual({ ok: true, value: '2025-01-12' });
  });

  it('refuses an empty or unreadable date, and a date after today', () => {
    for (const raw of [undefined, '', '  ', 'yesterday', '31 Feb 2026', '2026-13-01']) expect(parseReceivedOn(raw, TODAY)).toEqual({ ok: false, error: DATE_ERROR });
    expect(parseReceivedOn('1 Oct 2026', TODAY)).toEqual({ ok: false, error: RECEIVED_AFTER_TODAY });
    expect(parseReceivedOn('1 Oct 2026', '2026-10-01')).toEqual({ ok: true, value: '2026-10-01' });
  });
});
