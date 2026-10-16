// Portfolio schedule — sliding 24-month window (Delivery 8, L-8 = a, R-136). The prototype's window was fixed
// (Jan 2026 – Dec 2027); the screen now opens on the quarter nearest to now − 12 months (Oct 2025 – Sep 2027 on the
// seed, PG_NOW ≈ 30 Sep 2026) and moves by quarters within Jan 2020 – Oct 2035. Board states, gates and KPIs stay on
// now whatever the window; rows are clipped, never filtered. R-013: "now" is passed in (here the prototype's PG_NOW).
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { fmtD } from '@/lib/format';
import {
  PG_FROM_MAX, PG_FROM_MIN, defaultWindowStart, isWindowStart, parseWindowParam, pgMonths, pgPct, pgRow, pgSeg, pgTodayL,
  portfolioScheduleModel, windowLabel, windowParam, type PgInput, type PgRowInput,
} from './pfplan';

/** The prototype's now (`PG_NOW`, ≈ 30 Sep 2026): passed explicitly since R-013. */
const PG_NOW = 8.97;

const pipeRow = (code: string, windows: PgRowInput['windows'], finishMonth: number | null): PgRowInput => ({
  project: {
    code, displayId: code, name: `Project ${code}`, pm: 'R. Aubert', client: 'Client', status: 'APS', stage: 'aps', finish: finishMonth === null ? '—' : 'Nov 2027',
    budget: 1000, actual: 0, progress: 0, spi: null, hasData: false,
  },
  pipeline: true,
  finishMonth,
  windows,
  execStart: windows[windows.length - 1].end,
  schedule: null,
});

describe('window start (L-8 = a)', () => {
  it('default = the quarter start nearest to now − 12 months: Oct 2025 on the seed', () => {
    expect(defaultWindowStart(PG_NOW)).toBe(-3);
    // R-013: the demo data set's business date (25 Sep 2026, month index 8.8) gives the same window.
    expect(defaultWindowStart(8.8)).toBe(-3);
    expect(windowLabel(defaultWindowStart(PG_NOW))).toBe('Oct 2025 – Sep 2027');
    // Rounded to the nearest quarter: now = 12 (Jan 2027) → Jan 2026; 13.6 → Apr 2026; 10.5 (tie) → Jan 2026, never −0.
    expect([defaultWindowStart(12), defaultWindowStart(13.6), Object.is(defaultWindowStart(10.5), -0), defaultWindowStart(10.5)]).toEqual([0, 3, false, 0]);
  });

  it('quarter starts only, within Jan 2020 – Oct 2035', () => {
    expect([PG_FROM_MIN, PG_FROM_MAX]).toEqual([-72, 117]);
    expect([isWindowStart(-3), isWindowStart(0), isWindowStart(3), isWindowStart(-72), isWindowStart(117)]).toEqual([true, true, true, true, true]);
    expect([isWindowStart(-2), isWindowStart(1), isWindowStart(-75), isWindowStart(120), isWindowStart(0.5)]).toEqual([false, false, false, false, false]);
  });

  it('?from=YYYY-MM: parsed when a quarter month within the bounds, else null (the default applies)', () => {
    expect(['2025-10', '2026-01', ' 2026-04 ', '2020-01', '2035-10'].map(parseWindowParam)).toEqual([-3, 0, 3, -72, 117]);
    expect(['2026-02', '2019-10', '2036-01', '2025-13', '2025-00', '2025-1', 'abc', '', '2025-10-01'].map(parseWindowParam)).toEqual(Array(9).fill(null));
    expect([parseWindowParam(undefined), parseWindowParam(null), parseWindowParam(['2025-10']), parseWindowParam(202510)]).toEqual([null, null, null, null]);
    // Round trip over every allowed start.
    for (let f = PG_FROM_MIN; f <= PG_FROM_MAX; f += 3) expect(parseWindowParam(windowParam(f))).toBe(f);
    expect([windowParam(-3), windowParam(0), windowParam(-72), windowParam(117)]).toEqual(['2025-10', '2026-01', '2020-01', '2035-10']);
  });

  it('window label in French through the month dictionary', () => {
    const fr = makeT('fr');
    expect(windowLabel(-3, fr)).toBe('oct. 2025 – sept. 2027');
    expect(windowLabel(0, fr)).toBe('janv. 2026 – déc. 2027');
    expect(windowLabel(-72)).toBe('Jan 2020 – Dec 2021');
  });
});

describe('geometry on a sliding window', () => {
  it('month header: 24 months from the window start, year on each January and on the first column (mod arithmetic)', () => {
    const m = pgMonths(-3);
    expect(m).toHaveLength(24);
    expect(m.slice(0, 4)).toEqual([
      { label: 'Oct', year: '2025', yearStart: false }, { label: 'Nov', year: '', yearStart: false }, { label: 'Dec', year: '', yearStart: false },
      { label: 'Jan', year: '2026', yearStart: true },
    ]);
    expect([m[15], m[23]]).toEqual([{ label: 'Jan', year: '2027', yearStart: true }, { label: 'Sep', year: '', yearStart: false }]);
    // Far in the past: Apr 2020 … Mar 2022.
    const past = pgMonths(-69);
    expect([past[0], past[9], past[23].label]).toEqual([{ label: 'Apr', year: '2020', yearStart: false }, { label: 'Jan', year: '2021', yearStart: true }, 'Mar']);
    // The prototype's window is unchanged.
    expect(pgMonths()[0]).toEqual({ label: 'Jan', year: '2026', yearStart: true });
  });

  it('positions are relative to the window start; segments clipped on both sides', () => {
    expect([pgPct(-3, -3), pgPct(9, -3), pgPct(21, -3), pgPct(30, -3), pgPct(-10, -3)]).toEqual(['0.00%', '50.00%', '100.00%', '100.00%', '0.00%']);
    expect(pgSeg(-5, -2, -3)).toEqual({ left: '0.00%', width: '4.17%', w: 1 });
    expect(pgSeg(19, 25, -3)).toEqual({ left: '91.67%', width: '8.33%', w: 2 });
    expect(pgSeg(-10, -4, -3)).toBeNull();
    expect(pgSeg(21, 23, -3)).toBeNull();
  });

  it('today line: on the default window ≈ the middle; none when now is outside the window', () => {
    expect(pgTodayL(-3, PG_NOW)).toBe(pgPct(PG_NOW, -3));
    expect(pgTodayL(-3, PG_NOW)).toBe(((PG_NOW + 3) / 24 * 100).toFixed(2) + '%');
    expect(pgTodayL(0, PG_NOW)).toBe('37.38%');
    expect([pgTodayL(12, PG_NOW), pgTodayL(-30, PG_NOW)]).toEqual([null, null]);
  });

  it('a bar past the window end is clipped ("→ finish") on that window only; board states stay on now', () => {
    // A pipeline project whose execution runs to the end of Nov 2027 (month 23).
    const r = pipeRow('X-1', [{ window: 'board', start: 8.5, end: 9.5 }], 23);
    expect([pgRow(r, 0, PG_NOW).clipText, pgRow(r, -3, PG_NOW).clipText]).toEqual(['', '→ Nov 2027']);
    expect(pgRow(r, -3, PG_NOW).segments.filter((x) => x.kind === 'diamond').map((x) => (x as { state: string }).state)).toEqual(['pending']);
    expect(pgRow(r, -3, PG_NOW).gateSub).toBe(pgRow(r, 0, PG_NOW).gateSub);
    // A board of 2025 is visible on the default window, outside the prototype's.
    const old = pipeRow('X-2', [{ window: 'initiative', start: -2.5, end: -1 }, { window: 'board', start: -1, end: -0.5 }], 23);
    expect(pgRow(old, 0, PG_NOW).segments).toEqual([]);
    expect(pgRow(old, -3, PG_NOW).segments.map((x) => x.kind)).toEqual(['stage', 'board', 'diamond']);
  });
});

describe('screen model window', () => {
  const input: PgInput = {
    rows: [pipeRow('X-1', [{ window: 'board', start: 8.5, end: 9.5 }], 23), pipeRow('X-2', [{ window: 'board', start: -1, end: -0.5 }], null)],
    averageBoardWaitDays: 14,
    now: PG_NOW,
  };

  it('default window (no `from`): Oct 2025 – Sep 2027, quarter steps, today line set', () => {
    const m = portfolioScheduleModel(input, { filter: 'all', lang: 'en' });
    expect(m.window).toEqual({ from: -3, label: 'Oct 2025 – Sep 2027', prevFrom: -6, nextFrom: 0, isDefault: true, defaultFrom: -3 });
    expect(m.months[0]).toEqual({ label: 'Oct', year: '2025', yearStart: false });
    expect(m.todayL).toBe(pgTodayL(-3, PG_NOW));
    // `from: null` (a malformed ?from=) is the default too.
    expect(portfolioScheduleModel(input, { filter: 'all', lang: 'en', from: null }).window.from).toBe(-3);
  });

  it('another window: steps stop at the bounds, rows never filtered, KPIs unchanged', () => {
    const def = portfolioScheduleModel(input, { filter: 'all', lang: 'en' });
    const far = portfolioScheduleModel(input, { filter: 'all', lang: 'en', from: 117 });
    expect(far.window).toEqual({ from: 117, label: 'Oct 2035 – Sep 2037', prevFrom: 114, nextFrom: null, isDefault: false, defaultFrom: -3 });
    expect(far.todayL).toBeNull();
    expect(far.groups.flatMap((g) => g.rows.map((r) => r.code))).toEqual(['X-1', 'X-2']);
    expect(far.groups.flatMap((g) => g.rows.map((r) => r.exec))).toEqual([null, null]);
    expect(far.kpis).toEqual(def.kpis);
    expect(portfolioScheduleModel(input, { filter: 'all', lang: 'en', from: -72 }).window).toMatchObject({ prevFrom: null, nextFrom: -69 });
    expect(portfolioScheduleModel(input, { filter: 'all', lang: 'en', from: 0 }).window).toMatchObject({ label: 'Jan 2026 – Dec 2027', isDefault: false });
  });
});

describe('fmtD year suffix (L-8: the actual year, the prototype always wrote ’27)', () => {
  it('2026 none, 2027 ’27, 2028 ’28', () => {
    expect([fmtD(new Date(2026, 10, 12)), fmtD(new Date(2027, 0, 14)), fmtD(new Date(2028, 2, 3)), fmtD(new Date(2030, 11, 1))]).toEqual([
      '12 Nov', '14 Jan ’27', '3 Mar ’28', '1 Dec ’30',
    ]);
  });
});
