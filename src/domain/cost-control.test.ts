// Cost control from Keystone data (delivery 7, lot cost-control): golden values on the prototype's own data where the
// decision keeps them (HLT-026 actual cost 3 360 k€, register reconciliation 4 600 + 200 = 4 800, 3 approved / 85 pending),
// hand-computed values elsewhere. Decisions: R-073 / C-2a (EV = progress × budget), A-4 (one change register),
// A-8 (the contingency register is the drawn figure), C-4 (validated draw-downs).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import { isoOfDemoDate, splitActual } from '@/server/db/codes';
import {
  activityProgress, allocateChange, amendmentOutcome, amendmentSubject, budgetChangeRows, computeEvm, contingencyTile, daysBetween, drawTotals,
  isContractualChange, isDrawDecider, monthEndOf, monthIndexOf, openCommitmentKeur, pendingSubText, provisionOf, registerReconciliation, spanShare,
  submitBalanceError, validateBalanceError, workPackageChanges, type EvmActivity, type RegisterChange,
} from './cost-control';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

describe('months and spans', () => {
  it('month index from Jan 2026 and month ends', () => {
    expect(['2026-01-05', '2026-09-25', '2027-01-14', '2025-12-31'].map(monthIndexOf)).toEqual([0, 8, 12, -1]);
    expect([0, 1, 8, 12, -1].map(monthEndOf)).toEqual(['2026-01-31', '2026-02-28', '2026-09-30', '2027-01-31', '2025-12-31']);
    expect(daysBetween('2026-09-01', '2026-09-25')).toBe(24);
  });

  it('share of a span elapsed at the end of a day: linear over inclusive calendar days', () => {
    expect(spanShare('2026-09-01', '2026-09-10', '2026-08-31')).toBe(0);
    expect(spanShare('2026-09-01', '2026-09-10', '2026-09-01')).toBe(0.1);
    expect(spanShare('2026-09-01', '2026-09-10', '2026-09-05')).toBe(0.5);
    expect(spanShare('2026-09-01', '2026-09-10', '2026-09-10')).toBe(1);
    // One missing bound → a one-day span; reversed bounds are swapped; no date at all → nothing.
    expect([spanShare(null, '2026-09-10', '2026-09-09'), spanShare(null, '2026-09-10', '2026-09-10'), spanShare('2026-09-10', '2026-09-01', '2026-09-05')]).toEqual([0, 1, 0.5]);
    expect(spanShare(null, null, '2026-09-10')).toBe(0);
  });
});

// HLT-026 activities as the seed stores them (prototype ACTS: b = [budget, actual, EAC], pc, " A" = actual date).
interface Act { id?: string; s?: string; f?: string; pc?: number; b?: [number, number, number] }
const hltActivities = (): EvmActivity[] =>
  (G.projectData['HLT-026'].ACTS as Act[])
    .filter((a) => a.id)
    .map((a) => {
      const s = splitActual(a.s!);
      const f = splitActual(a.f!);
      return {
        budget: a.b![0], actual: a.b![1], pct: a.pc!, start: isoOfDemoDate(s.text), finish: isoOfDemoDate(f.text),
        started: s.actual || a.pc! > 0, finished: f.actual || a.pc! >= 100,
      };
    });
const HLT_DRAWS = (P.CONTINGENCY['HLT-026'].draws as [string, number][]).map(([d, amount]) => ({ date: isoOfDemoDate(d)!, amount }));

describe('earned value from Keystone data (R-073)', () => {
  it('HLT-026 at the data date: progress 62.6 % (was 64 %), EV = progress × BAC 3 006 (was 3 080), AC 3 312 + 48 drawn = 3 360 (unchanged)', () => {
    const acts = hltActivities();
    expect(activityProgress(acts)).toBeCloseTo(2911.6 / 4650, 10);
    const e = computeEvm({ bac: 4800, dataDate: '2026-09-25', startMonth: 0, activities: acts, plan: [], costs: HLT_DRAWS })!;
    expect([e.ev, e.ac, e.evn, e.todayM]).toEqual([3006, 3360, 9, 8]);
    expect(e.series.ev).toHaveLength(9);
    expect(e.series.ac).toHaveLength(9);
    expect(e.series.pv).toHaveLength(12);
    // Without a baseline snapshot, PV follows the activities' current dates: the forecast handover is 14 Jan 2027, after the
    // 12-month chart, so December stays below the BAC (4 713) — the BAC is reached at the last finish.
    expect(e.planSource).toBe('plan');
    expect(e.series.pv[11]).toBe(4713);
    expect(computeEvm({ bac: 4800, dataDate: '2026-09-25', startMonth: 1, activities: acts, plan: [] })!.series.pv[11]).toBe(4800);
    expect(e.cpi).toBeCloseTo(3006 / 3360, 10);
    // The draw-downs are booked at their dates: 22 k€ on 18 Jun is in June's actual cost, not May's.
    const noDraws = computeEvm({ bac: 4800, dataDate: '2026-09-25', startMonth: 0, activities: acts, plan: [] })!;
    expect(e.series.ac.map((v, i) => v - noDraws.series.ac[i])).toEqual([0, 0, 0, 0, 0, 22, 36, 36, 48]);
  });

  it('a small project computed by hand: PV from the baseline, EV / AC from the actual spans, BAC scaling, values at the data date', () => {
    const e = computeEvm({
      bac: 120, dataDate: '2026-02-15', startMonth: 0,
      activities: [
        // Done in January (31 days), budget 40, actual 50.
        { budget: 40, actual: 50, pct: 100, start: '2026-01-01', finish: '2026-01-31', started: true, finished: true },
        // Started 1 Feb, 50 % done at the data date, budget 60, actual 20.
        { budget: 60, actual: 20, pct: 50, start: '2026-02-01', finish: '2026-03-31', started: true, finished: false },
        // Not started, nothing spent.
        { budget: 0, actual: 0, pct: 0, start: '2026-04-01', finish: '2026-04-30', started: false, finished: false },
      ],
      plan: [
        { budget: 40, start: '2026-01-01', finish: '2026-01-31' },
        { budget: 60, start: '2026-02-01', finish: '2026-03-02' },
      ],
    })!;
    // progress = (40 + 30) / 100 = 0.7; EV = 0.7 × 120 = 84; BAC 120 spreads the 20 unallocated pro rata (× 1.2).
    expect(e.progress).toBeCloseTo(0.7, 10);
    expect(e.planSource).toBe('baseline');
    // PV: end of January 40 × 1.2 = 48; at the data date (15 Feb) + 60 × 15/30 × 1.2 = 36 → 84; March on: 120.
    expect(e.series.pv.slice(0, 4)).toEqual([48, 84, 120, 120]);
    // EV: January 40 × 1.2 = 48; at the data date 84. AC: 50, then 70.
    expect([e.series.ev, e.series.ac]).toEqual([[48, 84], [50, 70]]);
    expect([e.pv, e.ev, e.ac, e.spi, e.evn]).toEqual([84, 84, 70, 1, 2]);
    expect(e.cpi).toBeCloseTo(1.2, 10);
  });

  it('a project that has not started at the data date: no EV / AC months, figures at the data date still computed', () => {
    const e = computeEvm({
      bac: 100, dataDate: '2026-09-25', startMonth: 12,
      activities: [{ budget: 100, actual: 5, pct: 0, start: '2027-01-04', finish: '2027-03-31', started: false, finished: false }],
      plan: [],
    })!;
    expect([e.todayM, e.evn, e.series.ev, e.series.ac, e.ev, e.ac, e.pv, e.spi, e.progress]).toEqual([-4, 0, [], [], 0, 5, 0, null, 0]);
  });

  it('a project past its 12 chart months keeps the data date on the last point', () => {
    const e = computeEvm({
      bac: 10, dataDate: '2026-09-25', startMonth: -10,
      activities: [{ budget: 10, actual: 4, pct: 40, start: '2025-03-01', finish: '2026-12-31', started: true, finished: false }],
      plan: [{ budget: 10, start: '2025-03-01', finish: '2026-12-31' }],
    })!;
    expect([e.evn, e.series.ev.length, e.ev, e.ac]).toEqual([12, 12, 4, 4]);
  });

  it('no activity budget → null (the project keeps its own figures)', () => {
    expect(computeEvm({ bac: 100, dataDate: '2026-09-25', startMonth: 0, activities: [], plan: [] })).toBeNull();
    expect(computeEvm({ bac: 100, dataDate: '2026-09-25', startMonth: 0, activities: [{ budget: 0, actual: 3, pct: 50, start: null, finish: null, started: true, finished: false }], plan: [] })).toBeNull();
  });

  it('inconsistent data stays bounded: % outside 0–100, a start after the data date, an actual finish in the future', () => {
    const e = computeEvm({
      bac: 100, dataDate: '2026-09-25', startMonth: 8,
      activities: [
        { budget: 50, actual: 10, pct: 140, start: '2026-10-10', finish: '2026-11-30', started: true, finished: true },
        { budget: 50, actual: 0, pct: -20, start: '2026-09-01', finish: '2026-09-30', started: true, finished: false },
      ],
      plan: [],
    })!;
    expect([e.progress, e.ev, e.ac]).toEqual([0.5, 50, 10]);
  });
});

describe('commitments: open purchase orders (R-073)', () => {
  it('Σ (ordered − received) × unit price of ordered / partially received orders, k€ to one decimal', () => {
    expect(openCommitmentKeur([
      { status: 'ordered', orderedQty: 10, receivedQty: 0, unitPriceEur: 1250 },
      { status: 'partially_received', orderedQty: 4, receivedQty: 1, unitPriceEur: 10_000 },
      { status: 'received', orderedQty: 5, receivedQty: 5, unitPriceEur: 99_999 },
      { status: 'awaiting_approval', orderedQty: 5, receivedQty: 0, unitPriceEur: 99_999 },
      { status: 'draft', orderedQty: 5, receivedQty: 0, unitPriceEur: 99_999 },
      { status: 'cancelled', orderedQty: 5, receivedQty: 0, unitPriceEur: 99_999 },
      // Over-received lines never count negatively.
      { status: 'partially_received', orderedQty: 1, receivedQty: 3, unitPriceEur: 500 },
    ])).toBe(42.5);
    expect(openCommitmentKeur([])).toBe(0);
  });
});

// HLT-026 register (HLT_CRS_X + CR-005 of the Budget dataset).
const HLT_CRS: RegisterChange[] = [
  ...(P.HLT_CRS_X as { id: string; amt: number; wbs: string[]; status: string; chain: Record<string, string> }[]).map((c) => ({
    id: c.id, amount: c.amt, wbs: c.wbs.map((code) => ({ code, amount: null })),
    status: ({ Approved: 'approved', 'In review': 'in_review', Draft: 'draft', Rejected: 'rejected' } as const)[c.status as 'Approved'],
    clientStep: (c.chain.client === 'n/a' ? 'na' : c.chain.client) as RegisterChange['clientStep'],
  })),
  { id: 'CR-005', amount: -40, wbs: [{ code: '1.7', amount: null }], status: 'rejected', clientStep: 'rejected' },
];
const HLT_WPS = (G.projectData['HLT-026'].WPS as [string, string, number][]).map(([code, , original]) => ({ code, original }));

describe('change-request register (R-068, A-4)', () => {
  it('HLT-026 reconciliation: approved +200 · 3 requests (as the seeded tiles), pending +85 · CR-008 in review', () => {
    const r = registerReconciliation(HLT_CRS);
    expect(r).toEqual({ approved: 200, approvedCount: 3, pending: 85, pendingIds: ['CR-008'] });
    expect(4600 + r.approved).toBe(G.projectData['HLT-026'].BAC);
    expect(pendingSubText(r.pendingIds, HLT_CRS.length)).toBe('CR-008 · In review');
    expect([pendingSubText(['CR-011', 'CR-012'], 7), pendingSubText([], 7), pendingSubText([], 0)])
      .toEqual(['2 change requests in review', 'No change request in review', 'No change requests raised']);
  });

  it('HLT-026 work-package changes follow the register\'s WBS: 1.3 +120 · 1.5 +65 · 1.7 +15 (the Budget list said 1.2 · 1.4 · 1.6, 04 Q6)', () => {
    expect(Object.fromEntries(workPackageChanges(HLT_CRS, HLT_WPS))).toEqual({ '1.3': 120, '1.5': 65, '1.7': 15 });
  });

  it('split of a change: entered amounts kept, the rest pro rata of the original budgets, the root over every package', () => {
    const wps = [{ code: '1.1', original: 300 }, { code: '1.2', original: 100 }, { code: '—', original: 50 }];
    expect(allocateChange(85, [{ code: '1.2', amount: null }], wps)).toEqual([{ code: '1.2', amount: 85 }]);
    expect(allocateChange(100, [{ code: '1', amount: null }], wps)).toEqual([{ code: '1.1', amount: 75 }, { code: '1.2', amount: 25 }]);
    expect(allocateChange(100, [{ code: '1.1', amount: 30 }, { code: '1.2', amount: null }], wps)).toEqual([{ code: '1.1', amount: 30 }, { code: '1.2', amount: 70 }]);
    expect(allocateChange(-40, [{ code: '1.1', amount: null }, { code: '1.2', amount: null }], wps)).toEqual([{ code: '1.1', amount: -30 }, { code: '1.2', amount: -10 }]);
    // Rounding: the remainder goes to the largest share so the split adds up to the amount.
    const thirds = allocateChange(10, [{ code: 'a', amount: null }, { code: 'b', amount: null }, { code: 'c', amount: null }], [
      { code: 'a', original: 1 }, { code: 'b', original: 1 }, { code: 'c', original: 1 },
    ]);
    expect(thirds.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(10, 10);
    // Unknown WBS → every package; no package or no amount → nothing; zero budgets → equal split.
    expect(allocateChange(10, [{ code: '9.9', amount: null }], [{ code: '1.1', original: 0 }, { code: '1.2', original: 0 }])).toEqual([{ code: '1.1', amount: 5 }, { code: '1.2', amount: 5 }]);
    expect([allocateChange(10, [{ code: '1', amount: null }], [{ code: '—', original: 50 }]), allocateChange(0, [{ code: '1.1', amount: null }], wps)]).toEqual([[], []]);
  });

  it('contract: a change the client approved prepares a draft amendment once; internal changes and projects without a contract do not', () => {
    const [cr004, , cr007] = HLT_CRS;
    expect([isContractualChange(cr004), isContractualChange(cr007), isContractualChange({ clientStep: 'ok', amount: 0 })]).toEqual([true, false, false]);
    expect(amendmentOutcome(cr004, { hasContract: true, amendmentExists: false })).toBe('prepared');
    expect(amendmentOutcome(cr004, { hasContract: true, amendmentExists: true })).toBe('exists');
    expect(amendmentOutcome(cr004, { hasContract: false, amendmentExists: false })).toBe('no_contract');
    expect(amendmentOutcome(cr007, { hasContract: true, amendmentExists: false })).toBe('not_contractual');
    expect(amendmentSubject(3, 'Second steel crew — schedule recovery')).toBe('Amendment 3 — Second steel crew — schedule recovery');
  });

  it('the Budget lists every request but the drafts, in register order', () => {
    expect(budgetChangeRows(HLT_CRS).map((c) => c.id)).toEqual(['CR-004', 'CR-006', 'CR-007', 'CR-008', 'CR-005']);
  });
});

describe('contingency (R-070 / R-071, A-8, C-4)', () => {
  it('provision: the register, else the budget\'s contingency line, else round(BAC × 3 %)', () => {
    expect(provisionOf({ registerInitial: 150, budgetContingency: 999, bac: 4800 })).toEqual({ initial: 150, source: 'register' });
    expect(provisionOf({ registerInitial: null, budgetContingency: 100, bac: 2100 })).toEqual({ initial: 100, source: 'budget' });
    expect(provisionOf({ registerInitial: null, budgetContingency: null, bac: 2100 })).toEqual({ initial: 63, source: 'default' });
  });

  it('drawn = validated draw-downs; pending apart; rejected nowhere', () => {
    expect(drawTotals([
      { amount: 22, status: 'validated' }, { amount: 14, status: 'validated' }, { amount: 12, status: 'validated' },
      { amount: 30, status: 'submitted' }, { amount: 9, status: 'rejected' },
    ])).toEqual({ drawn: 48, pending: 30, validatedCount: 3, pendingCount: 1 });
  });

  it('balance: a submission counts the pending draw-downs, a validation the drawn ones only', () => {
    const c = { initial: 150, drawn: 48, pending: 30 };
    expect([submitBalanceError(72, c), submitBalanceError(72.01, c)]).toEqual([null, 'The draw-down exceeds the remaining provision']);
    expect([validateBalanceError(102, c), validateBalanceError(103, c)]).toEqual([null, 'The draw-down exceeds the remaining provision']);
  });

  it('HLT-026 Budget tile: 48 drawn of 150 → 32 % (was 139 % · +58 over on the seeded 208), forecast 208 shown apart and alerting', () => {
    expect(contingencyTile(150, 48, 208)).toEqual({ pct: 32, over: 0, forecast: 208, alert: true });
    expect(contingencyTile(100, 0, 85)).toEqual({ pct: 0, over: 0, forecast: 85, alert: false });
    expect(contingencyTile(100, 120, null)).toEqual({ pct: 120, over: 20, forecast: 120, alert: true });
    expect(contingencyTile(0, 0, 0)).toEqual({ pct: 0, over: 0, forecast: 0, alert: false });
  });

  it('only the portfolio director validates', () => {
    // The 8 personas: only the portfolio director decides (C-4).
    expect((['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const).map(isDrawDecider)).toEqual([true, false, false, false, false, false, false, false]);
  });
});
