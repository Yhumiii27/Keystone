// Golden values reproduced from the prototype's own logic (design lines 3099–3100, 3787–3845, 4051–4056, 4905–4928)
// run on HLT_PD / projectData('NDC-031') / CONTRACTS['HLT-026'] — see docs/spec/04 §1.4–§1.8.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import {
  cashRecovery, categoryBar, contingencyDrawn, contractValue, costVarianceBars, evmCore, milestoneAmount, monthAt, offerPoints,
  offerSummary, openCommitment, plannedValueFromOffer, termsDays, workPackageBar, workPackageTotals, type OfferQuote, type PaymentMilestone,
} from './evm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

const toQuote = (q: { sys: string; sup: string; amt: number; terms: string; order: number; deliv: number; acc: number | null; lead: number }): OfferQuote => ({
  system: q.sys, supplier: q.sup, amount: q.amt, terms: q.terms, orderMonth: q.order, deliveryMonth: q.deliv, acceptanceMonth: q.acc, leadWeeks: q.lead,
});
const HLT_OFFER: OfferQuote[] = P.HLT_OFFER.map(toQuote);
const HLT = { pv: P.HPV as number[], ev: P.HEV as number[], ac: P.HAC as number[], bac: P.HBAC as number };
const pct1 = (v: number) => Math.round(v * 1000) / 10; // lib/format pct() without the "%"

describe('evmCore', () => {
  it('HLT-026: BAC 4800, PV 3420, EV 3080, AC 3360 → CPI 0.92, SPI 0.90, EAC 5236.4, VAC −436.4, TCPI 1.19', () => {
    const e = evmCore(HLT);
    expect(e.evn).toBe(9);
    expect([e.ev, e.ac, e.pv]).toEqual([3080, 3360, 3420]);
    expect(e.cpi).toBeCloseTo(0.9166667, 6);
    expect(e.cpi.toFixed(2)).toBe('0.92');
    expect(e.spi).toBeCloseTo(0.9005848, 6);
    expect(e.eac).toBeCloseTo(5236.3636, 3);
    expect(e.vac).toBeCloseTo(-436.3636, 3);
    expect(e.tcpi.toFixed(2)).toBe('1.19');
    expect(e.cv).toBe(-280);
    expect(e.sv).toBe(-340);
    // KPI subs: "70% of budget", "-9.1% of budget"
    expect(Math.round((e.ac / HLT.bac) * 100)).toBe(70);
    expect(Math.round((e.vac / HLT.bac) * 1000) / 10).toBe(-9.1);
  });

  it('NDC-031 (generated): EVn 6, CPI 1.05, SPI 1.34, EAC 2000, TCPI 0.95', () => {
    const d = G.projectData['NDC-031'];
    const e = evmCore({ pv: d.PV, ev: d.EV, ac: d.AC, bac: d.BAC });
    expect(e.evn).toBe(6);
    expect(e.cpi).toBeCloseTo(1.05, 10);
    expect(e.spi.toFixed(2)).toBe('1.34');
    expect(e.eac).toBeCloseTo(2000, 6);
    expect(e.tcpi.toFixed(2)).toBe('0.95');
  });

  it('no actuals → neutral ratios instead of NaN/Infinity', () => {
    const e = evmCore({ pv: [10], ev: [0], ac: [0], bac: 100 });
    expect(e.cpi).toBe(1);
    expect(e.eac).toBe(100);
  });
});

describe('commercial offer', () => {
  it('offerPoints: 11 disbursement steps for HLT-026', () => {
    const pts = offerPoints(HLT_OFFER);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual({ m: 2, k: 'order', pct: 30, amt: 192, sys: 'Structural steel — columns, beams, purlins', sup: 'Keystone Steelworks' });
    expect(pts.map((p) => `${p.k}:${p.m}:${p.amt}`)).toEqual([
      'order:2:192', 'deliv:5:384', 'acc:8:64', 'order:3:87', 'deliv:9:203', 'order:1:84', 'deliv:9:294', 'acc:11:42', 'order:4:108', 'deliv:10:216', 'acc:11:36',
    ]);
  });

  it('HPV = offer disbursements + cost streams, cumulated (ends at BAC 4800)', () => {
    const pv = plannedValueFromOffer(HLT_OFFER, (P.HLT_STREAMS as [string, string, number[]][]).map((s) => s[2]));
    expect(pv).toEqual([162, 349, 733, 1133, 1573, 2290, 2622, 2975, 3420, 4151, 4569, 4800]);
    expect(pv).toEqual(P.HPV);
  });

  it('cost profile: "4 quotes · €1.71M · 36 % of BAC"', () => {
    expect(offerSummary(HLT_OFFER, 4800)).toEqual({ count: 4, amount: 1710, pctOfBac: 36 });
  });
});

describe('variance card & bars', () => {
  it('cost variance bars: cv −5…−280, heights 3 %…80 %', () => {
    const bars = costVarianceBars(HLT.ev, HLT.ac);
    expect(bars.map((b) => b.cv)).toEqual([-5, -20, -45, -70, -110, -150, -190, -240, -280]);
    expect(bars.map((b) => b.h + '%')).toEqual([
      '3%', '5.7142857142857135%', '12.857142857142858%', '20%', '31.428571428571427%', '42.857142857142854%', '54.28571428571429%',
      '68.57142857142857%', '80%',
    ]);
  });

  it('cost breakdown bullets (HCATS)', () => {
    const rows = (P.HCATS as [string, number, number, number, number][]).map(([, b, a, c, fc]) => categoryBar(b, a, c, fc));
    expect(rows.map((r) => [pct1(r.actual), pct1(r.committed), pct1(r.tick), pct1(r.forecast)])).toEqual([
      [54.8, 6.9, 71.4, 77.6],
      [51.9, 13, 71.4, 79],
      [49.5, 11, 71.4, 75.1],
      [42.1, 19.1, 71.4, 77.8],
      [31.6, 0, 71.4, 65.3],
      [22.9, 0, 71.4, 99],
    ]);
    const budgets = (P.HCATS as [string, number, number, number, number][]).reduce((s, c) => s + c[1], 0);
    const forecasts = (P.HCATS as [string, number, number, number, number][]).reduce((s, c) => s + c[4], 0);
    expect([budgets, forecasts]).toEqual([4800, 5236]);
  });

  it('work packages (HWPS): bars and totals €4.60M / +€200k / €4.80M / €3.36M / €5.24M', () => {
    const wps = (P.HWPS as [string, string, number, number, number, number][]).map(([, , original, changes, actual, eac]) => ({ original, changes, actual, eac }));
    const tot = workPackageTotals(wps);
    expect(tot).toEqual({ original: 4600, changes: 200, actual: 3360, eac: 5236 });
    const bars = [...wps, tot].map((w) => workPackageBar(w.original + w.changes, w.actual, w.eac));
    expect(bars.map((b) => [pct1(b.actual), pct1(b.eac)])).toEqual([
      [71, 71], [73.9, 73.9], [77.4, 77.4], [56.9, 82.9], [42.9, 79.5], [26.6, 74.6], [9.1, 73.8], [0, 78.6], [22.9, 99], [50, 77.9],
    ]);
    expect(pct1(bars[0].tick)).toBe(71.4);
    // Variance of the total row: current − EAC → "−€436k"
    expect(tot.original + tot.changes - tot.eac).toBe(-436);
  });

  it('contingency tile: 208 drawn of 150 → 139 % · +58 over', () => {
    expect(contingencyDrawn(150, 208)).toEqual({ pct: 139, over: 58 });
    expect(contingencyDrawn(100, 85)).toEqual({ pct: 85, over: 0 });
  });
});

describe('cash recovery (HLT-026)', () => {
  const CT = P.CONTRACTS['HLT-026'];
  const total = contractValue(CT.amount, (CT.amendments as [string, number, string][]).map(([, amount, st]) => ({ amount, signed: st === 'Signed' })));
  const ms: PaymentMilestone[] = (CT.milestones as [string, string, number, string, string, string, string][]).map(([id, label, pct, due, st, inv, paid]) => ({
    id, label, pct, due, status: st.toLowerCase() as PaymentMilestone['status'], invoiced: inv === '—' ? null : inv, paid: paid === '—' ? null : paid,
  }));
  const core = evmCore(HLT);
  const rc = cashRecovery({
    pv: HLT.pv, ac: HLT.ac, bac: HLT.bac, evn: core.evn, cpi: core.cpi, contractTotal: total, milestones: ms,
    termsDays: termsDays(CT.terms), openCommit: openCommitment(HLT.pv, core.evn, 713),
  });

  it('contract value 5400 + signed amendment 120 = 5520; milestone amounts', () => {
    expect(total).toBe(5520);
    expect(ms.map((m) => milestoneAmount(total, m.pct))).toEqual([552, 1104, 1380, 1104, 1380]);
    expect(termsDays('Net 45 days')).toBe(45);
    expect(termsDays('')).toBe(45);
  });

  it('monthAt', () => {
    expect(monthAt('2 Apr')).toBe(3);
    expect(monthAt('29 Aug')).toBe(7);
    expect(monthAt('14 Dec 2026')).toBe(11);
    expect(monthAt('14 Jan 2027')).toBe(12);
    expect(monthAt('—')).toBeNull();
    expect(monthAt(null)).toBeNull();
  });

  it('receipts, commitments, recovery by month', () => {
    expect(rc.todayM).toBe(8);
    expect(rc.termsM).toBe(2);
    expect(rc.recA).toEqual([0, 0, 0, 552, 0, 0, 0, 1104, 0, 0, 0, 0, 0, 0, 0]);
    expect(rc.recP).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1380, 0, 0, 1104, 1380]);
    expect(rc.recWhat.map((w) => w.join(' · '))).toEqual(['', '', '', 'M1', '', '', '', 'M2', '', '', 'M3', '', '', 'M4', 'M5']);
    expect(rc.cumRec).toEqual([0, 0, 0, 552, 552, 552, 552, 1656, 1656, 1656, 3036, 3036, 3036, 4140, 5520]);
    expect(rc.cumCom).toEqual([175, 410, 745, 1130, 1560, 2030, 2490, 2950, 4073, 4157, 4613, 4865, 4865, 4865, 4865]);
    expect(rc.recov).toEqual([-175, -410, -745, -578, -1008, -1478, -1938, -1294, -2417, -2501, -1577, -1829, -1829, -725, 655]);
    expect(rc.recNow).toBe(-2417);
    expect(rc.lowI).toBe(9);
    expect(rc.nextI).toBe(10);
  });

  it('KPI inputs: €1.66M received (2 milestones, 30 %), €4.07M committed, coverage 41 %', () => {
    expect(rc.paid).toBe(1656);
    expect(rc.paidCount).toBe(2);
    expect(Math.round((rc.paid / total) * 100)).toBe(30);
    expect(rc.openCommit).toBe(713);
    expect(rc.committedNow).toBe(4073);
    expect(Math.round((rc.paid / rc.committedNow) * 100)).toBe(41);
  });

  it('openCommitment fallback = 60 % of next month PV', () => {
    expect(openCommitment(HLT.pv, 9)).toBe(Math.round((4151 - 3420) * 0.6));
    expect(openCommitment([0, 100], 2)).toBe(0);
  });
});
