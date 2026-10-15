// Golden values reproduced from the prototype's own logic (design lines 4959–4967, afSubmit `contingency` bucket)
// run on CONTINGENCY['HLT-026'], projectData() and the risk registers — see docs/spec/04 §5.4
// ("€150k · 3 % of budget", "€48k · 32 % used · project 64 % complete", "€102k · 3 draw-downs", "€340k · exceeds").
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import {
  contingencySummary, defaultProvision, drawCountText, drawRows, linkOptionLabel, parseAmount, parseDrawDown, type DrawLinkOption,
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
      pending: 0, pendingCount: 0, exposure: 340, exposureExceeds: true, barUsed: 32, barExposure: 100, barProgress: 64,
    });
  });

  it('delivery 7 (C-4, A-8): only validated draw-downs are drawn; those awaiting validation show apart, rejected ones count nowhere', () => {
    const s = contingencySummary({
      initial: 150, exposure: 0, progress: 0.5, bac: 4800,
      draws: [{ amount: 22, status: 'validated' }, { amount: 14 }, { amount: 30, status: 'submitted' }, { amount: 9, status: 'rejected' }, { amount: 5, status: 'submitted' }],
    });
    expect([s.drawn, s.drawCount, s.pending, s.pendingCount, s.remaining, s.usedPct]).toEqual([36, 2, 35, 2, 114, 24]);
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

describe('"Contingency draw-down" form (delivery 7, C-4: link required from a list, no approver)', () => {
  const links: DrawLinkOption[] = [
    { value: 'CR-004', label: linkOptionLabel('CR-004', 'Additional piling — soft ground at Bay 4'), type: 'change_request' },
    { value: 'R-07', label: linkOptionLabel('R-07', 'Night works'), type: 'risk' },
    { value: 'NCR-029', label: linkOptionLabel('NCR-029', 'Weld defect'), type: 'ncr' },
  ];

  it('option label "CR-004 · title"', () => {
    expect(links[0].label).toBe('CR-004 · Additional piling — soft ground at Bay 4');
  });

  it('amount as parseFloat, with a decimal comma', () => {
    expect(['12', '12.5', '12,5', ' 7 ', 'abc', ''].map(parseAmount)).toEqual([12, 12.5, 12.5, 7, 0, 0]);
  });

  it('valid draw-down: trimmed, linked by value or by label, with the kind of the link', () => {
    expect(parseDrawDown({ amount: '10', reason: ' Night shift lighting ', link: 'R-07' }, links)).toEqual({
      ok: true, value: { amountKeur: 10, reason: 'Night shift lighting', linkRef: 'R-07', linkType: 'risk' },
    });
    expect(parseDrawDown({ amount: '5,25', reason: 'UPS', link: 'CR-004 · Additional piling — soft ground at Bay 4' }, links)).toEqual({
      ok: true, value: { amountKeur: 5.25, reason: 'UPS', linkRef: 'CR-004', linkType: 'change_request' },
    });
    expect(parseDrawDown({ amount: '3', reason: 'x', link: 'NCR-029' }, links)).toMatchObject({ ok: true, value: { linkType: 'ncr' } });
  });

  it('rejects a missing / non-positive amount, a blank reason, a missing link and a link that is not offered', () => {
    const missing = 'Choose the change request, risk or NCR the draw-down covers';
    const unknown = 'Unknown change request, risk or NCR';
    expect(parseDrawDown({ amount: '', reason: 'x', link: 'R-07' }, links)).toEqual({ ok: false, error: 'Enter an amount greater than 0' });
    expect(parseDrawDown({ amount: '-4', reason: 'x', link: 'R-07' }, links)).toEqual({ ok: false, error: 'Enter an amount greater than 0' });
    expect(parseDrawDown({ amount: '4', reason: '  ', link: 'R-07' }, links)).toEqual({ ok: false, error: 'Reason is required' });
    expect(parseDrawDown({ amount: '4', reason: 'x', link: '' }, links)).toEqual({ ok: false, error: missing });
    expect(parseDrawDown({ amount: '4', reason: 'x' }, links)).toEqual({ ok: false, error: missing });
    // The prototype's pre-filled literal (04 Q8) and a reference of another project are refused.
    expect(parseDrawDown({ amount: '4', reason: 'x', link: 'CR / risk / NCR' }, links)).toEqual({ ok: false, error: unknown });
    expect(parseDrawDown({ amount: '4', reason: 'x', link: 'R-99' }, links)).toEqual({ ok: false, error: unknown });
    expect(parseDrawDown({ amount: '400000', reason: 'x', link: 'R-07' }, links)).toEqual({ ok: false, error: 'Amount is too large' });
    expect(parseDrawDown({ amount: '4', reason: 'x'.repeat(501), link: 'R-07' }, links)).toEqual({ ok: false, error: 'Reason is too long' });
  });
});
