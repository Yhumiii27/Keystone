// S-21 — check 1 (logic) on a multi-equipment project (demo NDC-031: five open chain ends, one per work package): each equipment
// line may end on its own open end; a one-line project keeps the single network end.
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, projectEquipments, projects } from '@/server/db/schema';
import { getScheduleQuality } from './schedule-quality';

const logicOffenders = async () =>
  (await getScheduleQuality('NDC-031', {}, { forensic: false }))!.report.checks.find((c) => c.id === 'logic')!.offenders.map((o) => (o.kind === 'activity' ? o.id : ''));

beforeAll(async () => setDb(await openDatabase()), 120_000);

describe('schedule quality on a multi-equipment project (S-21)', () => {
  it('one open end per equipment line is tolerated', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
    const lines = await db.select().from(projectEquipments).where(eq(projectEquipments.projectId, p.id));
    expect(lines).toHaveLength(1);
    const setLine = (code: string, equipmentId: string) =>
      db.update(activities).set({ equipmentId }).where(and(eq(activities.projectId, p.id), eq(activities.code, code)));
    await setLine('A3240', lines[0].id);
    // One line: the rule is still a single end for the whole network.
    expect(await logicOffenders()).toEqual(['A3240', 'A3340', 'A3440', 'A3540', 'A3640']);
    const [second] = await db.insert(projectEquipments)
      .values({ projectId: p.id, ref: 'EQ-02', machineTypeCode: lines[0].machineTypeCode, quantity: 2, position: 1 }).returning();
    await setLine('A3340', second.id);
    // Two lines: A3240 ends EQ-01, A3340 ends EQ-02; the three common ends are still listed.
    expect(await logicOffenders()).toEqual(['A3440', 'A3540', 'A3640']);
    // Two open ends on the same line: both listed.
    await setLine('A3440', second.id);
    expect(await logicOffenders()).toEqual(['A3340', 'A3440', 'A3540', 'A3640']);
  }, 120_000);
});
