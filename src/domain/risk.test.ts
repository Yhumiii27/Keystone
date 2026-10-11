// Golden values reproduced from the prototype's own logic (design lines 4570–4590, afSubmit 5121) run on RISKS_HLT,
// the generated registers of the other projects (RISKS_HLT[0..3] renumbered, EMV × BAC / 4800) and projectData()
// — see docs/spec/07 §2.1 ("HLT-026 seed values: 7 · 5 · €340k (227 % of €150k, LO) · 2 · 2", badge 1).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import { riskCategory, riskResponse, riskStatus } from '@/server/db/codes';
import {
  FORM_CATEGORIES, FORM_RESPONSES, MAX_COST, badgeText, cellLevel, costIfOccurs, costOfLegacyEmv, criticalOpenCount, emvOf, levelOf, levelTagText,
  levelTone, onCriticalPath, parseCategory, parseCost, parseNewRisk, parseRiskEdit, parseScale, registerRows, riskChips, riskKpis, riskMatrix, scoreOf,
  statusTone, toggleOf, type RiskFacts,
} from './risk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

interface ProtoRisk { id: string; cat: string; p: number; i: number; emv: number; act: string; status: string; trend: 'up' | 'flat' | 'down' }
const floatOf = (code: string): number | null => {
  const a = (G.projectData['HLT-026'].ACTS as { id?: string; tf?: number | null }[]).find((x) => x.id === code);
  return a ? (a.tf ?? null) : null;
};
const facts = (r: ProtoRisk): RiskFacts => ({
  id: r.id, category: riskCategory.code(r.cat), probability: r.p, impact: r.i, emv: r.emv, status: riskStatus.code(r.status), trend: r.trend,
  activity: r.act ? { code: r.act, totalFloat: floatOf(r.act) } : null,
});
const HLT: RiskFacts[] = (P.RISKS_HLT as ProtoRisk[]).map(facts);
/** The prototype's register of another project with data (logic 4572). */
const generated = (code: string): RiskFacts[] => {
  const bac = G.projectData[code].BAC as number;
  return (P.RISKS_HLT as ProtoRisk[]).slice(0, 4).map((r, i) => facts({ ...r, id: 'R-0' + (i + 1), act: '', emv: Math.round((r.emv * bac) / 4800) }));
};

describe('score, level, cost if it occurs', () => {
  it('level thresholds 15 / 8 / 4 and tag tones', () => {
    expect([25, 15, 14, 8, 7, 4, 3, 1].map(levelOf)).toEqual(['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low']);
    expect(['critical', 'high', 'medium', 'low'].map((l) => levelTone(l as never))).toEqual(['accent', 'outline', 'neutral', 'neutral']);
    expect([statusTone('open'), statusTone('closed')]).toEqual(['outline', 'neutral']);
  });

  it('HLT-026 scores and drawer tags', () => {
    expect(HLT.map((r) => `${r.id}:${scoreOf(r)}`)).toEqual(['R-03:16', 'R-07:10', 'R-09:9', 'R-11:12', 'R-12:10', 'R-14:6', 'R-15:6', 'R-05:4']);
    expect(levelTagText(HLT[0])).toBe('Critical · 16');
    expect(levelTagText(HLT[1])).toBe('High · 10');
    expect(levelTagText(HLT[5])).toBe('Medium · 6');
  });

  // Q-1 (delivery 7, R-072): the cost if it occurs is entered and stored; EMV = cost × P / 5. The prototype stored the EMV and
  // derived the cost the other way round (round(EMV / (P/5))): the seed's costs are the stored EMVs converted once.
  it('Q-1: the seed\'s costs keep every EMV the prototype showed (HLT-026 and the scaled registers)', () => {
    const costs = HLT.map((r) => costOfLegacyEmv(r.emv, r.probability));
    expect(costs).toEqual([150, 150, 75, 45, 100, 60, 25, 0]);
    expect(HLT.map((r, i) => emvOf(costs[i], r.probability))).toEqual(HLT.map((r) => r.emv));
    expect(costs.map(costIfOccurs)).toEqual([150, 150, 75, 45, 100, 60, 25, null]);
    const wsa = generated('WSA-044');
    const wsaCosts = wsa.map((r) => costOfLegacyEmv(r.emv, r.probability));
    // Two decimals (85 × 5 / 4 = 106.25), shown "€106k" as before; the EMV comes back exactly.
    expect(wsaCosts).toEqual([106.25, 107.5, 53.33, 32.5]);
    expect(wsa.map((r, i) => emvOf(wsaCosts[i], r.probability))).toEqual(wsa.map((r) => r.emv));
  });

  it('Q-1: EMV = cost × P / 5 follows the probability (P = 1 → 20 %, P = 5 → 100 %)', () => {
    // R-03 (cost 150): P 4 → 120; P 3 → 90 (the prototype kept 120 and showed a cost of 200 instead — 07 OQ4).
    expect([1, 2, 3, 4, 5].map((p) => emvOf(150, p))).toEqual([30, 60, 90, 120, 150]);
    expect([emvOf(0, 5), emvOf(null, 3), emvOf(-10, 3), emvOf(100, 9), emvOf(100, 0)]).toEqual([0, 0, 0, 100, 20]);
    expect([costIfOccurs(0), costIfOccurs(null), costIfOccurs(12.5)]).toEqual([null, null, 12.5]);
  });

  it('critical path = linked activity with total float ≤ 0', () => {
    expect(HLT.filter(onCriticalPath).map((r) => r.id)).toEqual(['R-03', 'R-11']);
    expect(onCriticalPath({ activity: { code: 'A1230', totalFloat: null } })).toBe(false);
    expect(onCriticalPath({ activity: { code: 'X', totalFloat: 0 } })).toBe(true);
  });
});

describe('register rows', () => {
  it('sorted by score descending (stable), closed included', () => {
    expect(registerRows(HLT, null).map((r) => r.id)).toEqual(['R-03', 'R-11', 'R-07', 'R-12', 'R-09', 'R-14', 'R-15', 'R-05']);
    expect(registerRows(generated('NDC-031'), null).map((r) => r.id)).toEqual(['R-01', 'R-04', 'R-02', 'R-03']);
  });

  it('filtered by category', () => {
    expect(registerRows(HLT, 'technical').map((r) => r.id)).toEqual(['R-07', 'R-05']);
    expect(registerRows(HLT, 'hse').map((r) => r.id)).toEqual(['R-12']);
    expect(registerRows(generated('NDC-031'), 'hse')).toEqual([]);
  });

  it('added risks come first in source order and keep it on equal scores', () => {
    const added: RiskFacts = { ...HLT[1], id: 'R-21' }; // score 10 like R-07 / R-12
    expect(registerRows([added, ...HLT], null).map((r) => r.id).slice(0, 5)).toEqual(['R-03', 'R-11', 'R-21', 'R-07', 'R-12']);
  });
});

describe('KPI tiles', () => {
  it('HLT-026: 7 open (1 closed) · 5 critical/high · €340k = 227 % of €150k (LO) · 2 on critical path · 2 trending up', () => {
    const k = riskKpis(HLT, G.projectData['HLT-026'].recon.cont);
    expect(k).toEqual({ open: 7, closed: 1, criticalHigh: 5, exposure: 340, exposurePct: 227, exposureAlert: true, onCriticalPath: 2, trendingUp: 2 });
  });

  it('generated registers: EMV scaled to the budget against DEFS contingency', () => {
    const exp: Record<string, [number, number]> = {
      'NDC-031': [115, 115], 'RCF-019': [74, 93], 'ERP-202': [52, 130], 'WSA-044': [186, 116], 'MSR-012': [35, 350],
    };
    for (const [code, [emv, pct]] of Object.entries(exp)) {
      const k = riskKpis(generated(code), G.projectData[code].recon.cont);
      expect([k.open, k.closed, k.criticalHigh, k.exposure, k.exposurePct, k.exposureAlert, k.onCriticalPath, k.trendingUp]).toEqual([4, 0, 4, emv, pct, true, 0, 2]);
    }
  });

  it('empty register and no contingency', () => {
    expect(riskKpis([], 0)).toEqual({ open: 0, closed: 0, criticalHigh: 0, exposure: 0, exposurePct: 0, exposureAlert: false, onCriticalPath: 0, trendingUp: 0 });
  });

  it('a closed risk leaves the exposure; below 80 % of the contingency the tile is not LO', () => {
    const closed = HLT.map((r) => (r.id === 'R-03' || r.id === 'R-07' || r.id === 'R-12' ? { ...r, status: 'closed' as const } : r));
    const k = riskKpis(closed, 150);
    expect([k.open, k.closed, k.exposure, k.exposurePct, k.exposureAlert]).toEqual([4, 4, 120, 80, false]);
  });
});

describe('category chips', () => {
  it('"All" + Settings order, only categories in use', () => {
    expect(riskChips(HLT).map((c) => [c.label, c.count])).toEqual([
      ['All', 8], ['Technical', 2], ['Supplier / delivery', 1], ['HSE (safety)', 1], ['Contractual / client', 1], ['Financial / currency', 1],
      ['Regulatory / permits', 1], ['Resources / skills', 1],
    ]);
    expect(riskChips(HLT).map((c) => c.label).slice(1)).toEqual(P.SETTINGS0.riskCats);
    expect(riskChips(generated('MSR-012')).map((c) => [c.label, c.count])).toEqual([
      ['All', 4], ['Technical', 1], ['Supplier / delivery', 1], ['Regulatory / permits', 1], ['Resources / skills', 1],
    ]);
    expect(riskChips([])).toEqual([{ value: null, label: 'All', count: 0 }]);
  });

  it('URL filter accepts codes and English labels', () => {
    expect([parseCategory('hse'), parseCategory('Supplier / delivery'), parseCategory('nope'), parseCategory(undefined)]).toEqual(['hse', 'supplier_delivery', null, null]);
  });
});

describe('heat map', () => {
  it('open risks by (P, I); impact rows 5 → 1, probability columns 1 → 5; R-05 (closed) not plotted', () => {
    const m = riskMatrix(HLT);
    expect(m.map((r) => r.i)).toEqual([5, 4, 3, 2, 1]);
    expect(m.map((r) => r.cells.map((c) => c.ids.join(' ')))).toEqual([
      ['', 'R-07 R-12', '', '', ''],
      ['', '', '', 'R-03', ''],
      ['', 'R-14', 'R-09', 'R-11', ''],
      ['', '', 'R-15', '', ''],
      ['', '', '', '', ''],
    ]);
    expect(m[0].cells.map((c) => c.p)).toEqual([1, 2, 3, 4, 5]);
  });

  it('cell bands (rCell): 15+ critical, 8+ high, 4+ medium', () => {
    expect([cellLevel(5, 3), cellLevel(4, 4), cellLevel(2, 4), cellLevel(2, 5), cellLevel(1, 4), cellLevel(3, 1)]).toEqual(['critical', 'critical', 'high', 'high', 'medium', 'low']);
  });
});

describe('nav badge (open risks with score ≥ 15)', () => {
  it('HLT-026 → 1; every generated register → 1 (R-01 = R-03 16); closing it → hidden', () => {
    expect(criticalOpenCount(HLT)).toBe(1);
    expect(['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'].map((c) => criticalOpenCount(generated(c)))).toEqual([1, 1, 1, 1, 1]);
    const closed = HLT.map((r) => (r.id === 'R-03' ? { ...r, status: 'closed' as const } : r));
    expect(badgeText(criticalOpenCount(closed))).toBe('');
    expect(badgeText(2)).toBe('2');
  });
});

describe('"New risk" form', () => {
  it('options: RCAT order (first appearance in the seed register) and the prototype response order', () => {
    const rcat = [...new Set((P.RISKS_HLT as ProtoRisk[]).map((r) => r.cat))];
    expect(FORM_CATEGORIES.map((c) => riskCategory.label(c))).toEqual(rcat);
    expect(FORM_RESPONSES.map((r) => riskResponse.label(r))).toEqual(P.AF.risks.fields[5][3]);
  });

  it('P / I parsing as afSubmit: parseInt, || 3, clamped to 1–5', () => {
    expect(['3', '', '0', '7', '-2', '2.9', 'abc', undefined].map((v) => parseScale(v as string))).toEqual([3, 3, 3, 5, 1, 2, 3, 3]);
  });

  it('Q-1 cost if it occurs: blank → 0, decimals (point or comma) kept to two places, anything else refused', () => {
    expect(['', ' ', '40', '12.7', '12,75', '1 250', '0.005'].map(parseCost)).toEqual([0, 0, 40, 12.7, 12.75, 1250, 0.01]);
    expect(['-5', 'x', '1e3', '12.5.1', String(MAX_COST + 1)].map(parseCost)).toEqual([null, null, null, null, null]);
  });

  it('valid form → defaults, "—" plan, selects default to their first option', () => {
    const team = P.DEFS['HLT-026'].team as string[];
    const r = parseNewRisk({ title: '  Port strike  ', cat: '', p: '9', i: '2', owner: '', resp: '', cost: '30', plan: '' }, team);
    expect(r).toEqual({
      ok: true,
      value: { title: 'Port strike', category: 'supplier_delivery', probability: 5, impact: 2, owner: 'Amélie Ollivier', response: 'mitigate', costKeur: 30, plan: '—' },
    });
    const s = parseNewRisk({ title: 'x', cat: 'hse', p: '3', i: '3', owner: 'Léa Marchand', resp: 'avoid', cost: '', plan: 'Barriers' }, team);
    expect(s.ok && s.value).toMatchObject({ category: 'hse', owner: 'Léa Marchand', response: 'avoid', costKeur: 0, plan: 'Barriers' });
  });

  it('rejects a blank title and values outside the offered lists', () => {
    const team = ['Amélie Ollivier'];
    expect(parseNewRisk({ title: '  ' }, team)).toEqual({ ok: false, error: 'Title is required' });
    expect(parseNewRisk({ title: 'x', cat: 'weather' }, team)).toEqual({ ok: false, error: 'Unknown category' });
    expect(parseNewRisk({ title: 'x', resp: 'pray' }, team)).toEqual({ ok: false, error: 'Unknown response' });
    expect(parseNewRisk({ title: 'x', owner: 'Somebody Else' }, team)).toEqual({ ok: false, error: 'Unknown owner' });
    expect(parseNewRisk({ title: 'x' }, [])).toMatchObject({ ok: true, value: { owner: null } });
    expect(parseNewRisk({ title: 'x', cost: '-3' }, team)).toEqual({ ok: false, error: 'Enter a cost of 0 or more (k€)' });
    expect(parseNewRisk({ title: 'x', cost: 'lots' }, team)).toEqual({ ok: false, error: 'Enter a cost of 0 or more (k€)' });
  });
});

describe('drawer edits', () => {
  it('accepts P / I 1–5, response and status codes', () => {
    expect(parseRiskEdit({ probability: 3 })).toEqual({ ok: true, value: { probability: 3 } });
    expect(parseRiskEdit({ impact: 5, response: 'transfer', status: 'closed' })).toEqual({ ok: true, value: { impact: 5, response: 'transfer', status: 'closed' } });
    // Q-1: the cost if it occurs (two decimals).
    expect(parseRiskEdit({ costKeur: 180.456 })).toEqual({ ok: true, value: { costKeur: 180.46 } });
    expect(parseRiskEdit({ costKeur: 0 })).toEqual({ ok: true, value: { costKeur: 0 } });
  });

  it('rejects anything else', () => {
    for (const bad of [
      null, 'x', {}, { probability: 0 }, { probability: 6 }, { impact: 2.5 }, { response: 'Mitigate' }, { status: 'Open' },
      { costKeur: -1 }, { costKeur: '40' }, { costKeur: Number.NaN }, { costKeur: MAX_COST + 1 },
    ])
      expect(parseRiskEdit(bad).ok).toBe(false);
  });

  it('close / reopen toggle', () => {
    expect(toggleOf('open')).toEqual({ label: 'Close risk', next: 'closed' });
    expect(toggleOf('closed')).toEqual({ label: 'Reopen', next: 'open' });
  });
});
