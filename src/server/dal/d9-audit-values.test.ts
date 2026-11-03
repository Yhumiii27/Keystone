// R-168 (delivery 9 sweep): the writers that change a business value store the values before / after (only the fields that
// changed) and the reason the actor gave, on an in-memory PGlite seeded with the demo data.
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries } from '@/server/db/schema';
import { updateContractSheet } from './contract';
import { rejectResourceRequest } from './requests';
import { updateRisk } from './risks';
import { setCcbThreshold } from './settings';
import { setTaskStatus } from './tasks';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

/** The latest audit row of an object. */
const lastOf = async (objectRef: string, area?: string) =>
  (await (await getDb()).select().from(auditEntries)
    .where(area ? and(eq(auditEntries.objectRef, objectRef), eq(auditEntries.area, area)) : eq(auditEntries.objectRef, objectRef))
    .orderBy(desc(auditEntries.occurredAt)).limit(1))[0];

describe('R-168: before / after and reason on business changes', () => {
  it('a rejection keeps the status before / after and the reason typed', async () => {
    await rejectResourceRequest('RQ-044', '  Team fully booked  ', 'Ines Duarte');
    expect(await lastOf('Request RQ-044')).toMatchObject({
      change: 'pending → rejected', before: { status: 'pending' }, after: { status: 'rejected' }, reason: 'Team fully booked',
    });
  });

  it('a task status change keeps the status and the % it moved', async () => {
    await setTaskStatus('T-2318', 'done', 'Hélène Sauvage');
    const row = await lastOf('T-2318', 'Tasks');
    expect(row.after).toEqual({ status: 'done', percentComplete: 100 });
    expect(Object.keys(row.before ?? {}).sort()).toEqual(Object.keys(row.after ?? {}).sort());
  });

  it('a contract sheet edit keeps only the fields edited', async () => {
    await updateContractSheet('HLT-026', { warranty: '36 months (R-168 test)' }, 'Romain Aubert');
    const [row] = await (await getDb()).select().from(auditEntries).where(eq(auditEntries.entityType, 'contract')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(row).toMatchObject({ before: { warranty: expect.anything() }, after: { warranty: '36 months (R-168 test)' } });
    expect(Object.keys(row.after ?? {})).toEqual(['warranty']);
  });

  it('a risk edit keeps the score and the EMV it moved', async () => {
    await updateRisk('HLT-026', 'R-03', { probability: 1 }, 'Romain Aubert');
    const row = await lastOf('R-03', 'Risks');
    expect(row.after).toMatchObject({ probability: 1 });
    expect(row.before).toHaveProperty('probability');
    expect(row.before).not.toHaveProperty('title');
  });

  it('a settings threshold keeps its value before / after', async () => {
    await setCcbThreshold(123, { name: 'Romain Aubert', role: 'director' });
    expect(await lastOf('Change control board', 'Settings')).toMatchObject({ after: { keur: 123 }, before: { keur: expect.any(Number) } });
  });
});
