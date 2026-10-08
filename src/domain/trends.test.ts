// Golden values reproduced from the prototype's Trends logic (design lines 4556–4568) run on HLT_SNAPS / SNAP_WEEKS
// and on the linear series it generates for the other projects (projectData('NDC-031')) — docs/spec/04 §2.4.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import { evmCore } from './evm';
import { parseTrendKey, signedDays, snapshotRows, trendCards, trendChart, trendDefs, trendKpis, type SnapshotLike, type TrendSeries } from './trends';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;

const SNAP_DATES = ['3 Jul', '10 Jul', '17 Jul', '24 Jul', '31 Jul', '7 Aug', '14 Aug', '21 Aug', '28 Aug', '4 Sep', '11 Sep', '18 Sep', '25 Sep'];
const WEEKS = P.SNAP_WEEKS as string[];
const HLT: TrendSeries = P.HLT_SNAPS;
const snaps = (s: TrendSeries): SnapshotLike[] =>
  WEEKS.map((week, i) => ({ week, dateText: SNAP_DATES[i], cpi: s.cpi[i], spi: s.spi[i], eac: s.eac[i], float: s.float[i], risk: s.risk[i], slip: s.slip[i] }));
const fx = (n: number | null | undefined) => (n == null ? null : n.toFixed(1));

/** The prototype's generator for projects other than Harbor Line (logic 4558). */
function generated(code: string): TrendSeries {
  const d = G.projectData[code];
  const e = evmCore({ pv: d.PV, ev: d.EV, ac: d.AC, bac: d.BAC });
  const n = 13;
  const g = (end: number, start: number) => Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(3));
  return {
    cpi: g(e.cpi, Math.min(1.02, e.cpi + 0.04)),
    spi: g(e.spi, Math.min(1.02, e.spi + 0.03)),
    eac: g(e.eac, d.BAC).map(Math.round),
    float: g(d.floatDays, Math.max(0, d.floatDays + 20)).map(Math.round),
    risk: g(90, 60).map(Math.round),
    slip: g(Math.max(0, -d.floatDays), 0).map(Math.round),
  };
}

describe('trend definitions', () => {
  it('TKPI targets and texts (HLT-026: BAC €4.80M, contingency €150k)', () => {
    const defs = trendDefs(4800, 150, 'en');
    expect(defs.map((d) => d.label)).toEqual(['CPI', 'SPI', 'EAC', 'Critical-path float', 'Risk exposure (EMV)', 'Milestone slip']);
    expect(defs.map((d) => d.target)).toEqual([1, 1, 4800, 0, null, 0]);
    expect(defs.map((d) => d.targetText)).toEqual(['≥ 1.00', '≥ 1.00', 'BAC €4.80M', '≥ 0', 'Contingency €150k', '0 d']);
    expect(trendDefs(4800, 150, 'fr')[2].targetText).toBe('BAC 4,80 M€');
    expect(trendDefs(4800, null, 'en')[4].targetText).toBe('—');
  });

  it('?kpi= parsing and the signed day format', () => {
    expect(parseTrendKey('float')).toBe('float');
    expect(parseTrendKey('nope')).toBe('cpi');
    expect(parseTrendKey(undefined)).toBe('cpi');
    expect([signedDays(4), signedDays(0), signedDays(-27)]).toEqual(['+4 d', '+0 d', '−27 d']);
  });
});

describe('KPI row (trendKpis 4568)', () => {
  it('HLT-026: 13 snapshots · CPI −0.01 · EAC +€386k · float -31 d · next report 2 Oct', () => {
    const k = trendKpis(snaps(HLT), HLT, '2 Oct', 'en');
    expect(k.map((x) => [x.label, x.value, x.sub, x.alert])).toEqual([
      ['Snapshots', '13', 'Weekly · Fridays · since 3 Jul', false],
      ['CPI trend', '−0.01', 'Last 4 weeks', true],
      ['EAC drift', '+€386k', 'Since first snapshot', true],
      ['Float lost', '-31 d', 'W27 → W39', true],
      ['Next status report', '2 Oct', 'One-page PDF + live dashboard link', false],
    ]);
    expect(trendKpis(snaps(HLT), HLT, '2 Oct', 'fr')[2].value).toBe('+386 k€');
  });

  it('NDC-031 (generated series): CPI +0.01, EAC −€100k, float -20 d', () => {
    const s = generated('NDC-031');
    expect(s.cpi[12]).toBe(1.05);
    expect(s.cpi[8]).toBe(1.04);
    const k = trendKpis(snaps(s), s, '2 Oct', 'en');
    expect(k.slice(1, 4).map((x) => [x.value, x.alert])).toEqual([
      ['+0.01', false],
      ['−€100k', false],
      ['-20 d', true],
    ]);
  });
});

describe('indicator cards (trendCards 4565)', () => {
  it('HLT-026 values and 4-week deltas, all worse', () => {
    const cards = trendCards(trendDefs(4800, 150, 'en'), HLT, 'cpi', 'en');
    expect(cards.map((c) => [c.key, c.value, c.delta, c.worse, c.selected])).toEqual([
      ['cpi', '0.92', '−0.01 · 4 wk', true, true],
      ['spi', '0.90', '−0.02 · 4 wk', true, false],
      ['eac', '€5.24M', '+€76k · 4 wk', true, false],
      ['float', '−27 d', '−9 d · 4 wk', true, false],
      ['risk', '€340k', '+€50k · 4 wk', true, false],
      ['slip', '39 d', '+13 d · 4 wk', true, false],
    ]);
  });

  it('NDC-031: improving CPI is not worse; FR money', () => {
    const s = generated('NDC-031');
    const cards = trendCards(trendDefs(2100, 100, 'fr'), s, 'eac', 'fr');
    expect(cards[0]).toMatchObject({ value: '1.05', worse: false });
    expect(cards[2]).toMatchObject({ value: '2,00 M€', delta: '−33 k€ · 4 wk', worse: false, selected: true });
  });
});

describe('trend chart (spark 4561–4563)', () => {
  it('CPI: path, target line, grid labels, last marker as the prototype', () => {
    const defs = trendDefs(4800, 150, 'en');
    const c = trendChart(defs[0], HLT.cpi, WEEKS);
    expect(c.path.startsWith('M48.0 51.5 L106.0 68.1 L164.0 68.1 L222.0 84.8 L280.0 101.5 L338.0 118.2')).toBe(true);
    expect(c.area.endsWith(' L744.0 194 L48 194 Z')).toBe(true);
    expect(fx(c.targetY)).toBe('34.8');
    expect(c.grid.map((g) => [fx(g.y), g.label])).toEqual([
      ['14.0', '1.01'],
      ['59.0', '0.99'],
      ['104.0', '0.96'],
      ['149.0', '0.93'],
      ['194.0', '0.90'],
    ]);
    expect(c.labels[0]).toMatchObject({ label: 'W27' });
    expect(c.labels.map((l) => fx(l.x))).toEqual(WEEKS.map((_, i) => fx(48 + (i / 12) * 696)));
    expect([fx(c.last?.cx), fx(c.last?.cy)]).toEqual(['744.0', '173.2']);
  });

  it('EAC grid uses money; risk has no target; day axes are rounded (prototype printed raw floats)', () => {
    const defs = trendDefs(4800, 150, 'en');
    expect(trendChart(defs[2], HLT.eac, WEEKS).grid.map((g) => g.label)).toEqual(['€5.30M', '€5.16M', '€5.02M', '€4.88M', '€4.73M']);
    const risk = trendChart(defs[4], HLT.risk, WEEKS);
    expect(risk.targetY).toBeNull();
    expect(risk.grid.map((g) => g.label)).toEqual(['€364k', '€312k', '€260k', '€208k', '€156k']);
    expect(fx(trendChart(defs[3], HLT.float, WEEKS).targetY)).toBe('52.6');
    // prototype: "+8.649999999999999 d | −1.4250000000000007 d | −11.5 d | −21.575 d | −31.65 d"
    expect(trendChart(defs[3], HLT.float, WEEKS).grid.map((g) => g.label)).toEqual(['+9 d', '−1 d', '−11 d', '−22 d', '−32 d']);
    // prototype: "44.85 d | 32.175 d | 19.5 d | 6.824999999999996 d | -5.850000000000001 d"
    expect(trendChart(defs[5], HLT.slip, WEEKS).grid.map((g) => g.label)).toEqual(['45 d', '32 d', '20 d', '7 d', '-6 d']);
  });
});

describe('snapshot history (snapRows 4567)', () => {
  it('HLT-026 newest first with LO flags', () => {
    const rows = snapshotRows(snaps(HLT), 'en');
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({
      week: 'W39', date: '25 Sep', cpi: '0.92', cpiLo: true, spi: '0.90', spiLo: true, eac: '€5.24M', float: '−27 d', floatLo: true, risk: '€340k', slip: '39 d',
    });
    expect(rows[12]).toEqual({
      week: 'W27', date: '3 Jul', cpi: '0.99', cpiLo: false, spi: '0.99', spiLo: false, eac: '€4.85M', float: '+4 d', floatLo: false, risk: '€180k', slip: '0 d',
    });
    // W30: CPI 0.97 is not below the 0.97 threshold
    expect(rows[9]).toMatchObject({ week: 'W30', cpi: '0.97', cpiLo: false, float: '−3 d' });
  });
});
