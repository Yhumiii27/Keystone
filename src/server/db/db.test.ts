// Integration test: in-memory PGlite, migrations from ./drizzle, seed, then golden values through the DAL.
import { beforeAll, describe, expect, it } from 'vitest';
import { getCostControl } from '@/server/dal/cost';
import { getStageHistory } from '@/server/dal/lifecycle';
import { getProject, getProjectData, listProjects } from '@/server/dal/projects';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { setDb } from './client';
import { openDatabase } from './open';

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('database seed and DAL', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('has the 17 projects of initialProjects(), 6 with data', async () => {
    const list = await listProjects();
    expect(list.map((p) => [p.code, p.status, p.pm, p.client, p.budget, p.actual, p.progress, p.spi])).toEqual(
      PROTO_GEN.initialProjects.map((p) => [p.code, p.status, p.pm, p.client, p.budget, p.actual, p.progress, p.spi]),
    );
    expect(list.filter((p) => p.hasData).map((p) => p.code)).toEqual(Object.keys(PROTO_GEN.projectData));
  });

  it('HLT-026 golden values', async () => {
    const p = await getProject('HLT-026');
    expect(p).toMatchObject({ budget: 4800, actual: 3360, progress: 0.64, spi: 0.9, displayId: '#026', health: 'at_risk', zone: 'euna' });
    const cc = await getCostControl('HLT-026');
    expect([cc?.bac, cc?.pv.at(-1), cc?.ev.at(-1), cc?.ac.at(-1)]).toEqual([4800, 4800, 3080, 3360]);
  });

  it.each(Object.keys(PROTO_GEN.projectData))('reproduces projectData(%s)', async (code) => {
    expect(plain(await getProjectData(code))).toEqual(PROTO_GEN.projectData[code]);
  });

  it('returns null projectData for projects without data', async () => {
    expect(await getProjectData('SCP-033')).toBeNull();
  });

  it('reproduces STAGE_HISTORY', async () => {
    for (const code of Object.keys(PROTO.STAGE_HISTORY))
      expect((await getStageHistory(code)).map((e) => [e.label, e.date, e.mode, e.reason])).toEqual(PROTO.STAGE_HISTORY[code]);
  });
});
