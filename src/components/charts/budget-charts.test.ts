// Golden geometry of the Budget charts (CH-1 / CH-2), compared with the prototype's own output (design lines
// 3816–3828 and 4914–4921 run on HLT_PD and CONTRACTS['HLT-026']).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { cashRecovery, contractValue, evmCore, offerPoints, openCommitment, termsDays, type OfferQuote, type PaymentMilestone } from '@/domain/evm';
import { cashChartGeometry } from './cash-recovery-chart';
import { evmChartGeometry, gridLabel } from './evm-s-curve';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
const HLT = { pv: P.HPV as number[], ev: P.HEV as number[], ac: P.HAC as number[], bac: P.HBAC as number };
const offer: OfferQuote[] = P.HLT_OFFER.map((q: { sys: string; sup: string; amt: number; terms: string; order: number; deliv: number; acc: number | null; lead: number }) => ({
  system: q.sys, supplier: q.sup, amount: q.amt, terms: q.terms, orderMonth: q.order, deliveryMonth: q.deliv, acceptanceMonth: q.acc, leadWeeks: q.lead,
}));

describe('EVM S-curve geometry (HLT-026)', () => {
  const core = evmCore(HLT);
  const g = evmChartGeometry(HLT, core.eac, offerPoints(offer));

  it('scale and grid: ymax 5616 → step 1000 → 0…5000', () => {
    expect(g.ymax).toBeCloseTo(5616, 6);
    expect(g.gstep).toBe(1000);
    expect(g.grid.map((r) => [r.v, r.y, r.ty])).toEqual([
      [0, '260.0', '264.0'], [1000, '216.2', '220.2'], [2000, '172.4', '176.4'], [3000, '128.6', '132.6'], [4000, '84.8', '88.8'], [5000, '41.0', '45.0'],
    ]);
    expect(['en', 'fr'].map((l) => [0, 1000, 500, 1500].map((v) => gridLabel(v, l as 'en' | 'fr')))).toEqual([
      ['0', '€1M', '€500k', '€1.50M'],
      ['0', '1,00 M€', '500 k€', '1,50 M€'],
    ]);
  });

  it('series paths', () => {
    expect(g.monthX).toEqual(['80.8', '138.5', '196.2', '253.8', '311.5', '369.2', '426.8', '484.5', '542.2', '599.8', '657.5', '715.2']);
    expect(g.pv).toBe('M52.0 260.0 L109.7 252.9 L167.3 244.7 L225.0 227.9 L282.7 210.4 L340.3 191.1 L398.0 159.7 L455.7 145.1 L513.3 129.7 L571.0 110.2 L628.7 78.2 L686.3 59.9 L744.0 49.7');
    expect(g.ev).toBe('M52.0 260.0 L109.7 252.6 L167.3 242.9 L225.0 229.3 L282.7 213.6 L340.3 196.5 L398.0 177.6 L455.7 159.3 L513.3 141.3 L571.0 125.1');
    expect(g.ac).toBe('M52.0 260.0 L109.7 252.3 L167.3 242.0 L225.0 227.4 L282.7 210.5 L340.3 191.7 L398.0 171.1 L455.7 150.9 L513.3 130.8 L571.0 112.8');
    expect(g.evArea).toBe(g.ev + ' L571.0 260.0 Z');
    expect(g.fc).toBe('M571.0 112.8 L744.0 30.6');
  });

  it('BAC, today and EAC markers', () => {
    expect([g.bacY, g.bacLabelY]).toEqual(['49.7', '43.7']);
    expect([g.todayX, g.todayLabelX]).toEqual(['571.0', '577.0']);
    expect([g.eacX, g.eacY, g.eacLabelX, g.eacLabelY]).toEqual(['744.0', '30.6', '734.0', '20.6']);
  });

  it('disbursement steps at (x(m+1), y(PV[m]))', () => {
    expect(g.steps.map((s) => `${s.x},${s.y}`)).toEqual([
      '225.0,227.9', '398.0,159.7', '571.0,110.2', '282.7,210.4', '628.7,78.2', '167.3,244.7', '628.7,78.2', '744.0,49.7', '340.3,191.1', '686.3,59.9', '744.0,49.7',
    ]);
  });
});

describe('Cash recovery geometry (HLT-026)', () => {
  const CT = P.CONTRACTS['HLT-026'];
  const total = contractValue(CT.amount, (CT.amendments as [string, number, string][]).map(([, amount, st]) => ({ amount, signed: st === 'Signed' })));
  const ms: PaymentMilestone[] = (CT.milestones as [string, string, number, string, string, string, string][]).map(([id, label, pct, due, st, inv, paid]) => ({
    id, label, pct, due, status: st.toLowerCase() as PaymentMilestone['status'], invoiced: inv === '—' ? null : inv, paid: paid === '—' ? null : paid,
  }));
  const core = evmCore(HLT);
  const rc = cashRecovery({
    pv: HLT.pv, ac: HLT.ac, bac: HLT.bac, evn: core.evn, cpi: core.cpi, contractTotal: total, milestones: ms,
    termsDays: termsDays(CT.terms), openCommit: openCommitment(HLT.pv, core.evn, 713), year: 2026,
  });
  const g = cashChartGeometry(rc, total);

  it('scale and grid', () => {
    expect(g.rcMax).toBeCloseTo(5961.6, 6);
    expect(g.step).toBe(1000);
    expect(g.grid.map((r) => r.y)).toEqual(['260.0', '218.7', '177.5', '136.2', '94.9', '53.7']);
    expect(g.monthX[0]).toBe('75.1');
    expect(g.monthX[14]).toBe('720.9');
  });

  it('paths, gap and lowest point', () => {
    expect(g.com).toBe('M52.0 260.0 L98.1 252.8 L144.3 243.1 L190.4 229.3 L236.5 213.4 L282.7 195.6 L328.8 176.2 L374.9 157.3 L421.1 138.3 L467.2 91.9');
    expect(g.comF).toBe('M467.2 91.9 L513.3 88.5 L559.5 69.6 L605.6 59.3 L651.7 59.3 L697.9 59.3 L744.0 59.3');
    expect(g.rec.startsWith('M52.0 260.0 L52.0 260.0 L52.0 260.0 L98.1 260.0 L98.1 260.0')).toBe(true);
    expect(g.rec.endsWith('L697.9 89.2 L697.9 32.2 L744.0 32.2')).toBe(true);
    expect([g.todayX, g.todayLabelX, g.gapY1, g.gapY2, g.gapLabelY]).toEqual(['467.2', '473.2', '91.9', '191.7', '145.8']);
    expect([g.lowX, g.lowY]).toEqual(['513.3', '191.7']);
  });
});
