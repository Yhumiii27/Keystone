// Integration test: in-memory PGlite, migrations from ./drizzle, seed, then golden values through the DAL.
import { beforeAll, describe, expect, it } from 'vitest';
import { getCostControl } from '@/server/dal/cost';
import { getStageHistory } from '@/server/dal/lifecycle';
import { getProject, getProjectData, listProjects } from '@/server/dal/projects';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { D7_ACTUAL, D7_PROGRESS_PCT } from '@/test/d7-cost-control';
import { setDb } from './client';
import { openDatabase } from './open';

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
/* eslint-disable @typescript-eslint/no-explicit-any */
const omit = (o: any, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
/**
 * Delivery 7 (lot cost-control) computes these parts of projectData() from Keystone data instead of reading the seeded values:
 * PV / EV / AC and pct (R-073, C-2a), the categories' and work packages' actual / committed / forecast and the reconciliation
 * (R-070, A-8: the contingency register; R-068, A-4: the change register), the change list (the register) and the generated
 * note (A-12: it quotes the computed CPI). They are tested in src/server/dal/cost-control.test.ts.
 */
const D7_KEYS = ['PV', 'EV', 'AC', 'pct', 'CATS', 'WPS', 'CRS', 'recon', 'note'];

describe('database seed and DAL', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('has the 17 projects of initialProjects(), 6 with data', async () => {
    const list = await listProjects();
    expect(list.map((p) => [p.code, p.status, p.pm, p.client, p.budget])).toEqual(PROTO_GEN.initialProjects.map((p) => [p.code, p.status, p.pm, p.client, p.budget]));
    // Delivery 7 (R-073, C-2a): progress, actual cost and SPI of the six projects with activities are computed from them; the others
    // keep the seeded figures.
    expect(list.filter((p) => !D7_ACTUAL[p.code]).map((p) => [p.code, p.actual, p.progress, p.spi])).toEqual(
      PROTO_GEN.initialProjects.filter((p) => !D7_ACTUAL[p.code as string]).map((p) => [p.code, p.actual, p.progress, p.spi]),
    );
    expect(Object.fromEntries(list.filter((p) => D7_ACTUAL[p.code]).map((p) => [p.code, [p.actual, Math.round(p.progress * 100)]]))).toEqual(
      Object.fromEntries(Object.keys(D7_ACTUAL).map((c) => [c, [D7_ACTUAL[c], D7_PROGRESS_PCT[c]]])),
    );
    expect(list.filter((p) => p.hasData).map((p) => p.code)).toEqual(Object.keys(PROTO_GEN.projectData));
  });

  it('HLT-026 golden values', async () => {
    const p = await getProject('HLT-026');
    // Delivery 7 (R-073, C-2a): progress 0.64 → 0.63 and SPI 0.90 → 0.82 computed from the activities and BL1 — off track (was at risk).
    expect(p).toMatchObject({ budget: 4800, actual: 3360, displayId: '#026', health: 'off_track', zone: 'euna' });
    expect([Math.round(p!.progress * 100), Math.round(p!.spi! * 100) / 100]).toEqual([63, 0.82]);
    const cc = await getCostControl('HLT-026');
    // EV at the data date 3080 → 3006 (= progress × BAC); PV reaches the BAC at BL1's finish (18 Dec 2026), AC unchanged.
    expect([cc?.bac, cc?.pv.at(-1), cc?.ev.at(-1), cc?.ac.at(-1)]).toEqual([4800, 4800, 3006, 3360]);
  });

  it.each(Object.keys(PROTO_GEN.projectData))('reproduces projectData(%s)', async (code) => {
    const got = plain(await getProjectData(code));
    const want = PROTO_GEN.projectData[code] as any;
    expect(omit(got, D7_KEYS)).toEqual(omit(want, D7_KEYS));
    // What delivery 7 still reads as seeded: category names and budgets, work packages and their original budgets, the original
    // budget and the contingency line of the reconciliation, the series lengths (12 months of PV, EV / AC up to the data date).
    expect(got.CATS.map((c: any[]) => c.slice(0, 2))).toEqual(want.CATS.map((c: any[]) => c.slice(0, 2)));
    expect(got.WPS.map((w: any[]) => w.slice(0, 3))).toEqual(want.WPS.map((w: any[]) => w.slice(0, 3)));
    expect([got.recon.orig, got.recon.cont, got.PV.length, got.EV.length, got.AC.length]).toEqual([want.recon.orig, want.recon.cont, 12, want.EV.length, want.AC.length]);
  });

  it('returns null projectData for projects without data', async () => {
    expect(await getProjectData('SCP-033')).toBeNull();
  });

  it('reproduces STAGE_HISTORY', async () => {
    for (const code of Object.keys(PROTO.STAGE_HISTORY))
      expect((await getStageHistory(code)).map((e) => [e.label, e.date, e.mode, e.reason])).toEqual(PROTO.STAGE_HISTORY[code]);
  });
});
