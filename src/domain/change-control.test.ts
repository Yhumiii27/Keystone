// Golden values reproduced from the prototype's Change control logic (design lines 4591–4610) run on HLT_CRS_X,
// BASELINES and HLT_PD (recon.orig 4600, contingency 150, BAC 4800) — docs/spec/07 §2.2.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import type { BaselineState, ChangeStatus, ChangeStep, ChangeType, StepDecision } from '@/server/db/codes';
import {
  CR_STATUS_TONE, amountCell, baselineKpi, canDecideStep, chainDots, crChips, crHint, crImpact, crKpis, daysCell, deriveCrStatus, filterCrs,
  parseCrFilter, stepState, stepsOfRole, typesText, withDerivedStatus, type BaselineLike, type ChangeRequestLike,
} from './change-control';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

const STATUS: Record<string, ChangeStatus> = { Draft: 'draft', 'In review': 'in_review', Approved: 'approved', Rejected: 'rejected' };
const DECISION: Record<string, StepDecision> = { ok: 'ok', pending: 'pending', rejected: 'rejected', 'n/a': 'na' };
const STEPS: ChangeStep[] = ['pm', 'director', 'client', 'ccb'];
const ACTS = G.projectData['HLT-026'].ACTS as { w: string; n: string; id?: string }[];
const wbsName = (w: string) => ACTS.find((a) => a.w === w && !a.id)?.n ?? null;

const fromProto = (c: { id: string; title: string; types: ChangeType[]; amt: number; days: number; wbs: string[]; status: string; by: string; date: string; chain: Record<string, string>; bl: string }): ChangeRequestLike => ({
  id: c.id, title: c.title, types: c.types, amount: c.amt, days: c.days, status: STATUS[c.status], by: c.by, date: c.date, baseline: c.bl,
  chain: STEPS.map((step) => ({ step, decision: DECISION[c.chain[step]] })),
  wbs: c.wbs.map((code) => ({ code, name: wbsName(code) })),
});

const HLT_CRS: ChangeRequestLike[] = (P.HLT_CRS_X as Parameters<typeof fromProto>[0][]).map(fromProto);
/** CR-005, only known from the Budget dataset (HCRS): rejected, budget, chain not recorded (data layer, 11 §7). */
const CR005: ChangeRequestLike = {
  id: 'CR-005', title: 'Value engineering — paving thickness', types: ['budget'], amount: -40, days: 0, status: 'rejected', by: 'Client', date: '11 Jun',
  baseline: 'BL1', chain: STEPS.map((step) => ({ step, decision: null })), wbs: [],
};
const STATE: Record<string, BaselineState> = { Current: 'current', Proposed: 'proposed', Superseded: 'superseded' };
const BASELINES: BaselineLike[] = (P.BASELINES as [string, string, string, number, string, string][]).map(([code, name, setOn, bac, finish, state]) => ({
  code, name, setOn, bac, finish, state: STATE[state], changeRequest: /^Pending (CR-\d+)$/.exec(setOn)?.[1] ?? null,
}));
const CTX = { originalBudget: 4600, bac: 4800, baselines: BASELINES };
const byId = (id: string) => HLT_CRS.find((c) => c.id === id)!;

describe('derived status (allCRs 4593, without the stuck override — 07 OQ1)', () => {
  it('seed statuses are unchanged', () => {
    expect(withDerivedStatus(HLT_CRS).map((c) => c.status)).toEqual(['approved', 'approved', 'approved', 'in_review', 'draft']);
  });

  it('a submitted CR follows its chain: all required ok → approved, any rejection → rejected, n/a ignored', () => {
    const chain = (d: Partial<Record<ChangeStep, StepDecision>>) => STEPS.map((step) => ({ step, decision: d[step] ?? 'pending' }));
    // CR-009 once submitted (the prototype kept the "In review" override forever)
    expect(deriveCrStatus('in_review', chain({ pm: 'ok', director: 'ok', client: 'ok', ccb: 'ok' }))).toBe('approved');
    expect(deriveCrStatus('in_review', chain({ pm: 'ok', director: 'ok', client: 'na', ccb: 'ok' }))).toBe('approved');
    expect(deriveCrStatus('in_review', chain({ pm: 'ok', client: 'rejected' }))).toBe('rejected');
    expect(deriveCrStatus('in_review', chain({ pm: 'ok' }))).toBe('in_review');
    expect(deriveCrStatus('draft', chain({ pm: 'ok', director: 'ok', client: 'ok', ccb: 'ok' }))).toBe('draft');
    expect(deriveCrStatus('rejected', CR005.chain)).toBe('rejected');
  });
});

describe('KPI tiles (crKpis 4604)', () => {
  it('HLT-026 as the prototype: 5 · +€200k · +€85k · 2 · BL1', () => {
    const k = crKpis(HLT_CRS, CTX, 'en');
    expect(k.map((x) => [x.label, x.value, x.sub, x.alert])).toEqual([
      ['Change requests', '5', '1 in review · 1 draft', false],
      ['Approved budget changes', '+€200k', 'BL1 €4.60M → BAC €4.80M', false],
      ['Pending value', '+€85k', 'Awaiting director · client · CCB', true],
      ['Schedule changes', '2', 'Net 27 d on handover', false],
      ['Baseline', 'BL1', 'BL2 proposed · CR-009 draft', false],
    ]);
    expect(crKpis(HLT_CRS, CTX, 'fr')[1]).toMatchObject({ value: '+200 k€', sub: 'BL1 4,60 M€ → BAC 4,80 M€' });
  });

  it('register with CR-005 (rejected −€40k): 6 requests, approved/pending/net days unchanged', () => {
    const k = crKpis([...HLT_CRS, CR005], CTX, 'en');
    expect(k.map((x) => x.value)).toEqual(['6', '+€200k', '+€85k', '2', 'BL1']);
    expect(k[3].sub).toBe('Net 27 d on handover');
  });

  it('empty register (projects without changes): dashes, BAC only without cost controls', () => {
    const k = crKpis([], { originalBudget: null, bac: 1200, baselines: [] }, 'en');
    expect(k.map((x) => [x.value, x.sub])).toEqual([
      ['0', '0 in review · 0 draft'],
      ['—', 'BAC €1.20M'],
      ['—', 'Awaiting director · client · CCB'],
      ['0', 'Net 0 d on handover'],
      ['—', 'No baseline yet'],
    ]);
    expect(k[2].alert).toBe(false);
  });

  it('baseline tile follows the register: CR-009 in review, then BL2 current', () => {
    const inReview = HLT_CRS.map((c) => (c.id === 'CR-009' ? { ...c, status: 'in_review' as const } : c));
    expect(baselineKpi(BASELINES, inReview)).toEqual({ value: 'BL1', sub: 'BL2 proposed · CR-009 in review' });
    const after = BASELINES.map((b) => ({ ...b, state: (b.code === 'BL2' ? 'current' : 'superseded') as BaselineState, setOn: b.code === 'BL2' ? '25 Sep 2026' : b.setOn }));
    expect(baselineKpi(after, HLT_CRS)).toEqual({ value: 'BL2', sub: 'Recovery re-baseline · 25 Sep 2026' });
  });
});

describe('filter chips (crChips 4602)', () => {
  it('All 5 · Budget 3 · Scope 3 · Schedule 2 (a CR counts in each of its types)', () => {
    expect(crChips(HLT_CRS).map((c) => [c.value, c.label, c.count])).toEqual([
      ['all', 'All', 5],
      ['budget', 'Budget', 3],
      ['scope', 'Scope', 3],
      ['schedule', 'Schedule', 2],
    ]);
    expect(crChips([...HLT_CRS, CR005])[1].count).toBe(4);
    expect(filterCrs(HLT_CRS, 'schedule').map((c) => c.id)).toEqual(['CR-008', 'CR-009']);
    expect(filterCrs(HLT_CRS, 'all')).toHaveLength(5);
    expect([parseCrFilter('scope'), parseCrFilter('x'), parseCrFilter(undefined)]).toEqual(['scope', 'all', 'all']);
  });
});

describe('register cells (crRows 4599–4601)', () => {
  it('types, budget and schedule cells', () => {
    expect(HLT_CRS.map((c) => typesText(c.types))).toEqual(['Scope · Budget', 'Scope · Budget', 'Scope', 'Budget · Schedule', 'Schedule']);
    expect(HLT_CRS.map((c) => amountCell(c.amount, 'en'))).toEqual([
      { text: '+€120k', lo: true },
      { text: '+€65k', lo: true },
      { text: '+€15k', lo: true },
      { text: '+€85k', lo: true },
      { text: '—', lo: false },
    ]);
    expect(amountCell(-40, 'fr')).toEqual({ text: '−40 k€', lo: false });
    expect(HLT_CRS.map((c) => daysCell(c.days))).toEqual([
      { text: '+12 d', tone: 'delay' },
      { text: '—', tone: 'none' },
      { text: '—', tone: 'none' },
      { text: '-12 d', tone: 'gain' },
      { text: '+27 d', tone: 'delay' },
    ]);
    expect(HLT_CRS.map((c) => CR_STATUS_TONE[c.status])).toEqual(['neutral', 'neutral', 'neutral', 'accent', 'outline']);
  });

  it('approval chain dots: ok accent, pending neutral-700, n/a hollow ring', () => {
    const d7 = chainDots(byId('CR-007').chain);
    expect(d7.map((d) => d.label)).toEqual(['Project', 'Portfolio', 'Client', 'Change']);
    expect(d7.map((d) => [d.dot, d.ring])).toEqual([
      ['var(--color-accent)', 'none'],
      ['var(--color-accent)', 'none'],
      ['transparent', 'inset 0 0 0 1px var(--color-neutral-700)'],
      ['var(--color-accent)', 'none'],
    ]);
    expect(chainDots(byId('CR-008').chain).map((d) => d.dot)).toEqual(['var(--color-accent)', 'var(--color-neutral-700)', 'var(--color-neutral-700)', 'var(--color-neutral-700)']);
    expect(chainDots([{ step: 'client', decision: 'rejected' }])[2].dot).toBe('var(--color-neutral-100)');
    expect(chainDots(CR005.chain).every((d) => d.dot === 'transparent' && d.ring !== 'none')).toBe(true);
    // accessible state of each dot (the prototype conveyed it by colour only)
    expect(d7.map((d) => d.state)).toEqual(['Approved', 'Approved', 'Not required', 'Approved']);
    expect(chainDots(byId('CR-008').chain).map((d) => d.state)).toEqual(['Approved', 'Pending', 'Pending', 'Pending']);
    expect(chainDots(CR005.chain).map((d) => d.state)).toEqual([null, null, null, null]);
  });
});

describe('drawer (crVals 4607–4610)', () => {
  const ctx = { bac: 4800, contingency: 150 };
  it('impact of CR-008, CR-004 and CR-009', () => {
    expect(crImpact(byId('CR-008'), ctx, 'en')).toEqual([
      { k: 'Budget', v: '+€85k → BAC €4.88M', lo: true }, // (4.885).toFixed(2) = '4.88', as the prototype
      { k: 'Schedule', v: '-12 days on handover', lo: false },
      { k: 'WBS impacted', v: '1.4 · Steel structure', lo: false },
      { k: 'Baseline', v: 'Requires re-baseline → BL2', lo: false },
      { k: 'Contingency', v: 'Funded from contingency · 57% of reserve', lo: false },
    ]);
    expect(crImpact(byId('CR-004'), ctx, 'en').map((r) => r.v)).toEqual([
      '+€120k → BAC €4.80M',
      '+12 days on handover',
      '1.3 · Foundations',
      'Within BL1',
      'Funded from contingency · 80% of reserve',
    ]);
    expect(crImpact(byId('CR-007'), ctx, 'en')[0]).toEqual({ k: 'Budget', v: '+€15k → BAC €4.80M', lo: false });
    expect(crImpact(byId('CR-009'), ctx, 'en').map((r) => r.v)).toEqual(['None', '+27 days on handover', '1 · Harbor Line Terminal Expansion', 'Requires re-baseline → BL2', '—']);
    expect(crImpact(CR005, ctx, 'fr').map((r) => r.v)).toEqual(['−40 k€ → BAC 4,76 M€', 'None', '—', 'Within BL1', '—']);
    // S-3: the baseline the request proposes comes from the Baselines register (BL3 for a request raised from the Plan).
    expect(crImpact(byId('CR-008'), { ...ctx, proposedBaseline: 'BL3' }, 'en')[3]).toEqual({ k: 'Baseline', v: 'Requires re-baseline → BL3', lo: false });
    expect(crImpact(byId('CR-009'), { ...ctx, proposedBaseline: null }, 'en')[3].v).toBe('Within BL1');
  });

  it('step state tags', () => {
    expect((['ok', 'rejected', 'na', 'pending'] as StepDecision[]).map(stepState)).toEqual([
      { label: 'Approved', tone: 'neutral' },
      { label: 'Rejected', tone: 'outline' },
      { label: 'Not required', tone: 'neutral' },
      { label: 'Pending', tone: 'accent' },
    ]);
    expect(stepState(null)).toBeNull();
  });

  it('who decides: pm, director (+ change control board, 07 OQ2), client; others none', () => {
    expect(stepsOfRole('pm')).toEqual(['pm']);
    expect(stepsOfRole('director')).toEqual(['director', 'ccb']);
    expect(stepsOfRole('client')).toEqual(['client']);
    expect(stepsOfRole('quality')).toEqual([]);
    const cr8 = byId('CR-008');
    expect(STEPS.filter((s) => canDecideStep('director', cr8, s))).toEqual(['director', 'ccb']);
    expect(STEPS.filter((s) => canDecideStep('client', cr8, s))).toEqual(['client']);
    expect(STEPS.filter((s) => canDecideStep('pm', cr8, s))).toEqual([]); // pm step already ok
    expect(STEPS.filter((s) => canDecideStep('pm', byId('CR-009'), s))).toEqual([]); // draft: submit first
    expect(STEPS.filter((s) => canDecideStep('director', byId('CR-004'), s))).toEqual([]);
  });

  it('hints', () => {
    expect(crHint(byId('CR-009'), 'director')).toBe('Submit the request to start the approval chain.');
    expect(crHint(byId('CR-008'), 'quality')).toBe('Switch to Project manager, Portfolio director or Client (bottom-left) to decide.');
    expect(crHint(byId('CR-008'), 'client')).toBe('');
    expect(crHint(byId('CR-004'), 'quality')).toBe('');
  });
});
