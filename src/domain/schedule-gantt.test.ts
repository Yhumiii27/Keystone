// Golden values of the Schedule screen (docs/spec/05 §1.4) + a verbatim port of the prototype logic
// (design lines 3848–3864, 5180) used as an oracle for the 6 projects with data.
import { describe, expect, it } from 'vitest';
import { PROTO_GEN } from '@/server/prototype';
import type { MilestoneStatus } from '@/server/db/codes';
import { ganttPos, ganttTask, scheduleMilestone, scheduleView, slipDays, type ScheduleInput } from './schedule-gantt';

type Tuple = [string, string, number, number, number, number, number, boolean];
type Mile = [string, number, number, string];

const STATUS: Record<string, MilestoneStatus> = { Done: 'done', Late: 'late', 'At risk': 'at_risk', 'On track': 'on_track' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inputOf(pd: any): ScheduleInput {
  return {
    header: {
      start: pd.start, tNow: pd.tNow, floatDays: pd.floatDays, finishText: pd.finishText, baselineText: pd.baselineText,
      floatText: pd.floatText, critText: pd.critText, milesText: pd.milesText, milesSub: pd.milesSub,
      chartMonths: pd.chartMonths, ganttMonths: pd.ganttMonths,
    },
    bars: (pd.TASKS as Tuple[]).map(([name, owner, bs, be, as, ae, p, crit]) => ({
      name, owner, baselineStart: bs, baselineEnd: be, forecastStart: as, forecastEnd: ae, pct: p, critical: crit,
    })),
    milestones: (pd.MILES as Mile[]).map(([name, b, fc, st]) => ({ name, baselineMonth: b, forecastMonth: fc, status: STATUS[st], statusLabel: st })),
    pv: pd.PV, ev: pd.EV, bac: pd.BAC,
  };
}

// ── Oracle: the prototype code, transcribed ────────────────────────────────────────────────────────────
const LO = 'LO', OK = 'OK';
const pct = (v: number) => Math.round(v * 1000) / 10 + '%';
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (m: number) => {
  const y = m >= 12 ? 2027 : 2026, mm = Math.floor(m % 12), d = Math.max(1, Math.round((m - Math.floor(m)) * 30));
  return d + ' ' + MO[mm] + (y === 2027 ? ' ’27' : '');
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prototype(PD: any) {
  const { PV, EV, BAC, TASKS, MILES } = PD;
  const EVn = EV.length, ev = EV[EVn - 1], pv = PV[EVn - 1], spi = ev / pv;
  const S = 13, pos = (m: number) => pct(m / S);
  const tasks = (TASKS as Tuple[]).map(([name, owner, bs, be, as, ae, p, crit]) => {
    const slip = Math.round((ae - be) * 30);
    return { name, owner, critical: crit, pctText: p + '%', slipText: slip > 0 ? '+' + slip + 'd' : '—', slipColor: slip > 14 ? LO : 'n300', bL: pos(bs), bW: pos(be - bs), aL: pos(as), aW: pos(ae - as) };
  });
  const milestones = (MILES as Mile[]).map(([name, b, fc, st]) => {
    const slip = Math.round((fc - b) * 30);
    return { name, bL: pos(b), fL: pos(fc), done: st === 'Done', baseDate: dateOf(b + PD.start), fcDate: dateOf(fc + PD.start), slipText: '+' + slip + 'd', slipColor: slip > 14 ? LO : 'n300', status: st };
  });
  const progression = (PD.chartMonths as string[]).map((l, i) => {
    const pl = PV[i] / BAC, a = EV[i] != null ? EV[i] / BAC : null, s = a != null ? EV[i] / PV[i] : null;
    return { label: l, planH: pct(pl), actH: a != null ? pct(a) : '0%', spiText: s != null ? s.toFixed(2) : '', spiColor: s != null && s < 0.93 ? LO : 'n400' };
  });
  const scheduleKpis = [
    { label: 'SPI', value: spi.toFixed(2), sub: 'Earning ' + Math.round(spi * 100) + '¢ of planned work per $1', color: spi < 0.97 ? LO : OK },
    { label: 'Complete', value: Math.round((ev / BAC) * 100) + '%', sub: 'Planned ' + Math.round((pv / BAC) * 100) + '% by today', color: OK },
    { label: 'Forecast finish', value: PD.finishText, sub: 'Baseline ' + PD.baselineText, color: PD.floatDays < 0 ? LO : OK },
    { label: 'Critical path float', value: PD.floatText, sub: PD.critText, color: PD.floatDays < 0 ? LO : OK },
    { label: 'Milestones', value: PD.milesText, sub: PD.milesSub, color: OK },
  ];
  return { tasks, milestones, progression, scheduleKpis, todayL: pos(PD.tNow), ganttMonths: PD.ganttMonths };
}

describe('schedule domain — HLT-026 golden values (docs/spec/05 §1.4)', () => {
  const v = scheduleView(inputOf(PROTO_GEN.projectData['HLT-026']));

  it('KPI tiles', () => {
    expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.alert])).toEqual([
      ['SPI', '0.90', 'Earning 90¢ of planned work per $1', true],
      ['Complete', '64%', 'Planned 71% by today', false],
      ['Forecast finish', '14 Jan 2027', 'Baseline 18 Dec 2026', true],
      ['Critical path float', '−27 days', '4 of 8 packages critical', true],
      ['Milestones', '2 of 6', 'Complete · 0 on baseline date', false],
    ]);
  });

  it('today line and month axis', () => {
    expect(v.todayL).toBe('67.7%');
    expect(v.ganttMonths).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan ’27']);
  });

  it('package bars: done, slip, critical', () => {
    expect(v.tasks.map((t) => [t.name, t.owner, t.pctText, t.slipText, t.slipAlert, t.critical])).toEqual([
      ['Design & permits', 'R. Aubert', '100%', '+15d', true, false],
      ['Site preparation', 'A. Ollivier', '100%', '+24d', true, false],
      ['Foundations', 'J. Wagner', '100%', '+36d', true, true],
      ['Steel structure', 'J. Wagner', '72%', '+39d', true, true],
      ['Crane installation', 'T. Kerbrat', '55%', '+33d', true, true],
      ['MEP systems', 'P. Noguès', '40%', '+15d', true, false],
      ['Paving & yard', 'A. Ollivier', '10%', '+18d', true, false],
      ['Commissioning & handover', 'H. Sauvage', '0%', '+25d', true, true],
    ]);
  });

  it('package bar geometry (pos = pct(m/13))', () => {
    const steel = v.tasks[3];
    expect([steel.bL, steel.bW, steel.aL, steel.aW]).toEqual(['42.3%', '23.1%', '53.8%', '21.5%']);
    const design = v.tasks[0];
    expect([design.bL, design.bW, design.aL, design.aW]).toEqual(['0%', '19.2%', '0%', '23.1%']);
    expect(ganttPos(12.45)).toBe('95.8%');
  });

  it('milestones: dates, slip, status', () => {
    expect(v.milestones.map((m) => [m.name, m.baseDate, m.fcDate, m.slipText, m.slipAlert, m.statusLabel, m.done])).toEqual([
      ['Permits approved', '15 Mar', '1 Apr', '+15d', true, 'Done', true],
      ['Foundations complete', '1 Jul', '6 Aug', '+36d', true, 'Done', true],
      ['Structure topped out', '15 Sep', '24 Oct', '+39d', true, 'Late', false],
      ['Cranes operational', '1 Oct', '3 Nov', '+33d', true, 'Late', false],
      ['Systems energised', '15 Nov', '1 Dec', '+15d', true, 'At risk', false],
      ['Handover', '18 Dec', '13 Jan ’27', '+25d', true, 'At risk', false],
    ]);
  });

  it('progression: Jan 3.4%/3.5% SPI 1.05 … Sep 71.3%/64.2% SPI 0.90, Oct–Dec planned only', () => {
    expect(v.progression[0]).toMatchObject({ label: 'Jan', planH: '3.4%', actH: '3.5%', spiText: '1.05', spiAlert: false });
    expect(v.progression[8]).toMatchObject({ label: 'Sep', planH: '71.3%', actH: '64.2%', spiText: '0.90', spiAlert: true });
    expect(v.progression.slice(9).map((p) => [p.label, p.actH, p.spiText, p.spiAlert])).toEqual([
      ['Oct', '0%', '', false],
      ['Nov', '0%', '', false],
      ['Dec', '0%', '', false],
    ]);
    expect(v.progression[11].planH).toBe('100%');
  });

  it('slip in 30-day months', () => {
    expect(slipDays(11.6, 12.45)).toBe(25);
    expect(slipDays(5.5, 5.5)).toBe(0);
  });
});

describe('schedule domain — prototype parity for every project with data', () => {
  it.each(Object.keys(PROTO_GEN.projectData))('%s', (code) => {
    const pd = PROTO_GEN.projectData[code];
    const want = prototype(pd);
    const got = scheduleView(inputOf(pd));
    expect(got.todayL).toBe(want.todayL);
    expect(got.ganttMonths).toEqual(want.ganttMonths);
    expect(got.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.alert ? LO : OK }))).toEqual(want.scheduleKpis);
    expect(
      got.tasks.map((t) => ({ name: t.name, owner: t.owner, critical: t.critical, pctText: t.pctText, slipText: t.slipText, slipColor: t.slipAlert ? LO : 'n300', bL: t.bL, bW: t.bW, aL: t.aL, aW: t.aW })),
    ).toEqual(want.tasks);
    expect(
      got.milestones.map((m) => ({ name: m.name, bL: m.bL, fL: m.fL, done: m.done, baseDate: m.baseDate, fcDate: m.fcDate, slipText: m.slipText, slipColor: m.slipAlert ? LO : 'n300', status: m.statusLabel })),
    ).toEqual(want.milestones);
    expect(got.progression.map((p) => ({ label: p.label, planH: p.planH, actH: p.actH, spiText: p.spiText, spiColor: p.spiAlert ? LO : 'n400' }))).toEqual(want.progression);
  });

  it('ERP-202 is on schedule: positive float, no slip, KPIs not in alert', () => {
    const v = scheduleView(inputOf(PROTO_GEN.projectData['ERP-202']));
    expect(v.kpis.find((k) => k.key === 'float')).toMatchObject({ value: '+2 days', alert: false });
    expect(v.tasks.every((t) => t.slipText === '—')).toBe(true);
    expect(v.milestones.map((m) => m.slipText)).toEqual(['+0d', '+0d', '+0d']);
  });

  it('early milestone forecast reads "−Nd" (not the prototype\'s "+-Nd"); early package shows "—"', () => {
    const m = scheduleMilestone({ name: 'Early', baselineMonth: 6, forecastMonth: 5.5, status: 'on_track', statusLabel: 'On track' }, 0);
    expect([m.slip, m.slipText, m.slipAlert]).toEqual([-15, '−15d', false]);
    const t = ganttTask({ name: 'Early', owner: 'R. Aubert', baselineStart: 0, baselineEnd: 6, forecastStart: 0, forecastEnd: 5.5, pct: 50, critical: false });
    expect([t.slip, t.slipText, t.slipAlert]).toEqual([-15, '—', false]);
  });

  it('no earned value yet → SPI and % complete show "—"', () => {
    const input = inputOf(PROTO_GEN.projectData['WSA-044']);
    const v = scheduleView({ ...input, ev: [] });
    expect(v.kpis.slice(0, 2).map((k) => [k.value, k.sub, k.alert])).toEqual([['—', '', false], ['—', '', false]]);
    expect(v.progression.every((p) => p.actH === '0%' && p.spiText === '')).toBe(true);
  });

  it('incomplete series never render NaN / Infinity (missing PV month, BAC 0)', () => {
    const input = inputOf(PROTO_GEN.projectData['HLT-026']);
    const short = scheduleView({ ...input, pv: input.pv.slice(0, 10) });
    expect(short.progression.slice(10).map((p) => [p.planH, p.actH, p.spiText])).toEqual([['0%', '0%', ''], ['0%', '0%', '']]);
    const zero = scheduleView({ ...input, bac: 0 });
    expect(zero.progression.every((p) => p.planH === '0%' && p.actH === '0%')).toBe(true);
    expect(zero.kpis[1]).toMatchObject({ value: '—', sub: '' });
  });
});
