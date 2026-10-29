// R-010 — optimistic locking in the database: the version trigger of the edited records, and the writers' check (a save on a
// record changed meanwhile by someone else is refused with who and when; the saver's own changes and saves without a token pass;
// two simultaneous saves read on the same version → one saved, one refused).
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, contracts, costCategories, paymentMilestones, projects, risks, warrantyClaims } from '@/server/db/schema';
import { StaleRecordError, assertRecordFresh, bumpVersion, tokenOf } from './record-version';
import { listRisks, updateRisk } from './risks';

const riskRow = async (number: string) => {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
  const [r] = await db.select().from(risks).where(and(eq(risks.projectId, p.id), eq(risks.number, number)));
  return r;
};
const tokenOfRisk = async (number: string) => (await listRisks('HLT-026')).find((r) => r.id === number)!.version;

describe('row version trigger', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('counts a change of content, not a rewrite of the same values, of updated_at or of a derived column', async () => {
    const db = await getDb();
    const r = await riskRow('R-09');
    expect(r.version).toBe(1);
    await db.update(risks).set({ title: r.title, updatedAt: new Date() }).where(eq(risks.id, r.id));
    await db.update(risks).set({ sortOrder: r.sortOrder + 100 }).where(eq(risks.id, r.id));
    expect((await riskRow('R-09')).version).toBe(1);
    await db.update(risks).set({ title: `${r.title} (rev.)` }).where(eq(risks.id, r.id));
    expect((await riskRow('R-09')).version).toBe(2);
    // A writer that bumps the version itself keeps its value (no double count).
    await db.update(risks).set({ version: bumpVersion(risks.version), probability: r.probability === 5 ? 4 : 5 }).where(eq(risks.id, r.id));
    expect((await riskRow('R-09')).version).toBe(3);
  });

  it('activities: a Reschedule (CPM dates, floats) or a re-order is not a change; a name or a duration is', async () => {
    const db = await getDb();
    const [a] = await db.select().from(activities).limit(1);
    await db.update(activities).set({ earlyStartDate: '2026-01-05', totalFloatDays: 99, position: a.position + 1000, startText: '5 Jan', scheduledAt: new Date() }).where(eq(activities.id, a.id));
    expect((await db.select({ v: activities.version }).from(activities).where(eq(activities.id, a.id)))[0].v).toBe(a.version);
    await db.update(activities).set({ durationDays: a.durationDays + 1 }).where(eq(activities.id, a.id));
    expect((await db.select({ v: activities.version }).from(activities).where(eq(activities.id, a.id)))[0].v).toBe(a.version + 1);
  });

  it('every versioned table has the trigger', async () => {
    const db = await getDb();
    const r = await db.execute<{ t: string }>(sql`select event_object_table as t from information_schema.triggers where trigger_name like '%_row_version' order by 1`);
    expect([...new Set(r.rows.map((x) => x.t))]).toEqual(['activities', 'contracts', 'cost_categories', 'payment_milestones', 'risks', 'warranty_claims']);
    // The tables named here are the ones the writers check (VersionedTable): keep both lists in step.
    for (const t of [activities, contracts, costCategories, paymentMilestones, risks, warrantyClaims]) expect(t.version.name).toBe('version');
  });
});

describe('writers refuse a record changed meanwhile by someone else', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('Romain saves on what he read; Léa\'s save, read before it, is refused with Romain and when', async () => {
    const token = await tokenOfRisk('R-03');
    await updateRisk('HLT-026', 'R-03', { probability: 2 }, 'Romain Aubert', { version: token });
    const err = await updateRisk('HLT-026', 'R-03', { impact: 1 }, 'Léa Marchand', { version: token }).catch((e) => e);
    expect(err).toBeInstanceOf(StaleRecordError);
    expect(err.by).toBe('Romain Aubert');
    expect(err.at).toBeInstanceOf(Date);
    const r = await riskRow('R-03');
    expect([r.probability, r.impact]).toEqual([2, 4]); // Léa's impact was never written
  });

  it('the saver\'s own second edit on the same token is saved; a save without a token is not checked', async () => {
    const token = await tokenOfRisk('R-11');
    await updateRisk('HLT-026', 'R-11', { probability: 1 }, 'Romain Aubert', { version: token });
    await updateRisk('HLT-026', 'R-11', { impact: 1 }, 'Romain Aubert', { version: token });
    await updateRisk('HLT-026', 'R-11', { response: 'accept' }, 'Léa Marchand');
    const r = await riskRow('R-11');
    expect([r.probability, r.impact, r.response]).toEqual([1, 1, 'accept']);
  });

  it('a malformed token is refused (never a silent overwrite)', async () => {
    await expect(updateRisk('HLT-026', 'R-12', { probability: 1 }, 'Romain Aubert', { version: 'not-a-token' })).rejects.toBeInstanceOf(StaleRecordError);
  });

  it('a version moved by a writer that kept no audit entry: refused without a name', async () => {
    const db = await getDb();
    const r = await riskRow('R-12');
    const token = tokenOf(r.version, new Date());
    await db.update(risks).set({ trigger: 'Changed by a script' }).where(eq(risks.id, r.id));
    const err = await db.transaction((tx) => assertRecordFresh(tx, { table: risks, id: risks.id, version: risks.version, entityType: 'risk' }, r.id, token, { name: 'Romain Aubert', personId: null })).catch((e) => e);
    expect(err).toBeInstanceOf(StaleRecordError);
    expect([err.by, err.at]).toEqual([null, null]);
  });

  it('two saves sent at once on the same version: one saved, the other refused', async () => {
    const token = await tokenOfRisk('R-07');
    const results = await Promise.allSettled([
      updateRisk('HLT-026', 'R-07', { probability: 1 }, 'Romain Aubert', { version: token }),
      updateRisk('HLT-026', 'R-07', { probability: 5 }, 'Léa Marchand', { version: token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(StaleRecordError);
    const winner = results[0].status === 'fulfilled' ? 1 : 5;
    expect((await riskRow('R-07')).probability).toBe(winner);
  });
});
