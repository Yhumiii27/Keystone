// Golden values reproduced from the prototype's own logic (design lines 4959–4967, afSubmit `contingency` bucket)
// run on CONTINGENCY['HLT-026'], projectData() and the risk registers — see docs/spec/04 §5.4
// ("€150k · 3 % of budget", "€48k · 32 % used · project 64 % complete", "€102k · 3 draw-downs", "€340k · exceeds").
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import {
  approverLabel, approversOf, contingencySummary, defaultProvision, drawCountText, drawRows, parseAmount, parseDrawDown,
} from './contingency';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

const progressOf = (code: string) => (G.initialProjects as { code: string; progress: number }[]).find((p) => p.code === code)!.progress;
type Draw = [string, number, string, string, string];
const HLT_DRAWS: Draw[] = P.CONTINGENCY['HLT-026'].draws;

describe('contingencySummary', () => {
  it('HLT-026: €150k (3 % of budget) · €48k drawn, 32 % used vs 64 % complete · €102k remaining · €340k exposure exceeds', () => {
    const s = contingencySummary({
      initial: P.CONTINGENCY['HLT-026'].initial, draws: HLT_DRAWS.map((d) => ({ amount: d[1] })), exposure: 340, progress: progressOf('HLT-026'),
      bac: G.projectData['HLT-026'].BAC,
    });
    expect(s).toEqual({
      initial: 150, initialPctOfBudget: 3, drawn: 48, usedPct: 32, progPct: 64, drawnAlert: false, remaining: 102, drawCount: 3,
      exposure: 340, exposureExceeds: true, barUsed: 32, barExposure: 100, barProgress: 64,
    });
  });

  it('projects without a register: default round(BAC × 3 %), no draws, exposure of their generated risks', () => {
    const exp: Record<string, [number, number, number]> = {
      // initial, open-risk EMV, progress %
      'NDC-031': [63, 115, 51], 'RCF-019': [41, 74, 82], 'ERP-202': [29, 52, 45], 'WSA-044': [102, 186, 27], 'MSR-012': [19, 35, 91],
    };
    for (const [code, [initial, emv, prog]] of Object.entries(exp)) {
      const bac = G.projectData[code].BAC;
      expect(defaultProvision(bac)).toBe(initial);
      const s = contingencySummary({ initial: defaultProvision(bac), draws: [], exposure: emv, progress: progressOf(code), bac });
      expect([s.initialPctOfBudget, s.drawn, s.usedPct, s.progPct, s.drawnAlert, s.remaining, s.drawCount, s.exposureExceeds, s.barUsed, s.barExposure, s.barProgress])
        .toEqual([3, 0, 0, prog, false, initial, 0, true, 0, 100, prog]);
    }
  });

  it('drawn faster than progress → LO; bars clamped at 100; exposure covered by the remainder', () => {
    const s = contingencySummary({ initial: 100, draws: [{ amount: 70 }, { amount: 50 }], exposure: 0, progress: 0.6, bac: 2000 });
    // A negative remainder is "exceeded" by any exposure, as in the prototype (0 > −20).
    expect([s.drawn, s.usedPct, s.drawnAlert, s.remaining, s.exposureExceeds, s.barUsed, s.barExposure]).toEqual([120, 120, true, -20, true, 100, 100]);
    const c = contingencySummary({ initial: 100, draws: [{ amount: 10 }], exposure: 30, progress: 0.5, bac: 2000 });
    expect([c.exposureExceeds, c.barExposure, c.initialPctOfBudget]).toEqual([false, 40, 5]);
  });

  it('no provision and no budget never divide by zero', () => {
    const s = contingencySummary({ initial: 0, draws: [], exposure: 0, progress: 0, bac: 0 });
    expect([s.initialPctOfBudget, s.usedPct, s.barExposure, s.exposureExceeds]).toEqual([0, 0, 0, false]);
  });
});

describe('draw-down list and texts', () => {
  it('most recent first', () => {
    expect(drawRows(HLT_DRAWS).map((d) => d[0])).toEqual(['12 Sep', '30 Jul', '18 Jun']);
    expect(drawRows(HLT_DRAWS).map((d) => d[1])).toEqual([12, 14, 22]);
  });

  it('"3 draw-downs" / "1 draw-down"', () => {
    expect([drawCountText(3), drawCountText(0), drawCountText(1)]).toEqual(['3 draw-downs', '0 draw-downs', '1 draw-down']);
  });
});

describe('"Contingency draw-down" form', () => {
  const approvers = approversOf('R. Aubert', 'M. Lefebvre');

  it('approvers: the project manager then the portfolio director (prototype labels for Harbor Line)', () => {
    expect(approvers.map(approverLabel)).toEqual(P.AF.contingency.fields[3][3]);
    expect(approversOf('—', 'M. Lefebvre').map(approverLabel)).toEqual(['M. Lefebvre · Portfolio director']);
    expect(approversOf('J. Wagner', 'M. Lefebvre').map((a) => a.name)).toEqual(['J. Wagner', 'M. Lefebvre']);
  });

  it('amount as parseFloat, with a decimal comma', () => {
    expect(['12', '12.5', '12,5', ' 7 ', 'abc', ''].map(parseAmount)).toEqual([12, 12.5, 12.5, 7, 0, 0]);
  });

  it('valid draw-down: trimmed, link optional, approver by name or label, default the first approver', () => {
    expect(parseDrawDown({ amount: '10', reason: ' Night shift lighting ', link: 'R-07', approver: 'R. Aubert' }, approvers)).toEqual({
      ok: true, value: { amountKeur: 10, reason: 'Night shift lighting', linkRef: 'R-07', approvedBy: 'R. Aubert' },
    });
    expect(parseDrawDown({ amount: '5,25', reason: 'UPS', link: '', approver: 'M. Lefebvre · Portfolio director' }, approvers)).toEqual({
      ok: true, value: { amountKeur: 5.25, reason: 'UPS', linkRef: null, approvedBy: 'M. Lefebvre' },
    });
    expect(parseDrawDown({ amount: '3', reason: 'x' }, approvers)).toMatchObject({ ok: true, value: { approvedBy: 'R. Aubert' } });
  });

  it('rejects a missing / non-positive amount, a blank reason and an unknown approver', () => {
    expect(parseDrawDown({ amount: '', reason: 'x' }, approvers)).toEqual({ ok: false, error: 'Enter an amount greater than 0' });
    expect(parseDrawDown({ amount: '-4', reason: 'x' }, approvers)).toEqual({ ok: false, error: 'Enter an amount greater than 0' });
    expect(parseDrawDown({ amount: '4', reason: '  ' }, approvers)).toEqual({ ok: false, error: 'Reason is required' });
    expect(parseDrawDown({ amount: '4', reason: 'x', approver: 'N. Bensaïd' }, approvers)).toEqual({ ok: false, error: 'Unknown approver' });
    expect(parseDrawDown({ amount: '400000', reason: 'x' }, approvers)).toEqual({ ok: false, error: 'Amount is too large' });
  });
});
