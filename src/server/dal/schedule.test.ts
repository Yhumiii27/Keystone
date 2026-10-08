// Integration test: the Schedule DAL (in-memory PGlite, seeded) yields the same screen model as the
// prototype's projectData() for the 6 projects with data, and null for a project without data.
import { beforeAll, describe, expect, it } from 'vitest';
import { scheduleView } from '@/domain/schedule-gantt';
import type { MilestoneStatus } from '@/server/db/codes';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { PROTO_GEN } from '@/server/prototype';
import { getScheduleData } from './schedule';

const STATUS: Record<string, MilestoneStatus> = { Done: 'done', Late: 'late', 'At risk': 'at_risk', 'On track': 'on_track' };

describe('getScheduleData', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(Object.keys(PROTO_GEN.projectData))('%s matches the prototype projectData()', async (code) => {
    const pd = PROTO_GEN.projectData[code];
    const d = await getScheduleData(code);
    expect(d).not.toBeNull();
    const want = scheduleView({
      header: {
        start: pd.start, tNow: pd.tNow, floatDays: pd.floatDays, finishText: pd.finishText, baselineText: pd.baselineText,
        floatText: pd.floatText, critText: pd.critText, milesText: pd.milesText, milesSub: pd.milesSub,
        chartMonths: pd.chartMonths, ganttMonths: pd.ganttMonths,
      },
      bars: (pd.TASKS as [string, string, number, number, number, number, number, boolean][]).map(([name, owner, bs, be, as, ae, p, crit]) => ({
        name, owner, baselineStart: bs, baselineEnd: be, forecastStart: as, forecastEnd: ae, pct: p, critical: crit,
      })),
      milestones: (pd.MILES as [string, number, number, string][]).map(([name, b, fc, st]) => ({ name, baselineMonth: b, forecastMonth: fc, status: STATUS[st], statusLabel: st })),
      pv: pd.PV, ev: pd.EV, bac: pd.BAC,
    });
    expect(scheduleView(d!)).toEqual(want);
  });

  it('HLT-026 header', async () => {
    const d = await getScheduleData('HLT-026');
    expect([d?.bac, d?.pv.length, d?.ev.length, d?.header.tNow, d?.header.floatDays, d?.control.baselineSet]).toEqual([4800, 12, 9, 8.8, -27, '12 Mar 2026']);
  });

  it('returns null for a project without planning data', async () => {
    expect(await getScheduleData('ALP-021')).toBeNull();
    expect(await getScheduleData('NOPE-1')).toBeNull();
  });
});
