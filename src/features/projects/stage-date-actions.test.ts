// L-4c = a (Delivery 7, R-055): the effective date of a stage change entered in the Projects register — today (the
// project's data date) by default, refused before the previous change or after today (in the Server Function and again
// in the writer's transaction); the history row carries the effective date, the audit trail the time of entry.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'pm' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { and, desc, eq } from 'drizzle-orm';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { transitionsOf } from '@/domain/lifecycle';
import { getDb, setDb } from '@/server/db/client';
import { activityEvents, auditEntries, projects, stageTransitions } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { StageChangeError, getStageChangeBounds, getStageHistory, recordStageChange } from '@/server/dal/lifecycle';
import { listProjects } from '@/server/dal/projects';
import { moveStageAction } from './actions';

/** A project of `pm` (short name) that can still move, and another PM's one. */
async function pick(pm: string) {
  const all = (await listProjects()).filter((p) => p.stage !== 'clos' && p.stage !== 'annule');
  const mine = all.find((p) => p.pm === pm)!;
  const other = all.find((p) => p.pm !== pm)!;
  return { mine, other };
}

const forced = (code: string, to: string, effectiveOn?: unknown) =>
  moveStageAction({ code, to, mode: 'forced', reason: 'FAT report signed yesterday', effectiveOn: effectiveOn as string });

describe('moveStageAction: effective date (L-4c)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'pm';
  });

  it('records the entered date on the history row; the audit keeps the time of entry; the feed says so', async () => {
    const { mine } = await pick(PERSONA_BY_ROLE.pm.short);
    const bounds = (await getStageChangeBounds(mine.code))!;
    expect(bounds.today).toBe('2026-09-25');
    const to = transitionsOf(mine.stage)[0];
    const before = Date.now();
    expect(await forced(mine.code, to, '2026-09-24')).toEqual({ ok: true });
    const hist = await getStageHistory(mine.code);
    expect(hist.at(-1)).toMatchObject({ stage: to, dateIso: '2026-09-24', date: '24 Sep 2026', mode: 'forced' });
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, mine.code));
    const [a] = await db.select().from(auditEntries).where(and(eq(auditEntries.projectId, p.id), eq(auditEntries.area, 'Lifecycle'))).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(a.change).toMatch(/· forced · effective 24 Sep 2026 — FAT report signed yesterday$/);
    expect(a.actorName).toBe(PERSONA_BY_ROLE.pm.name);
    expect(a.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [ev] = await db.select().from(activityEvents).where(eq(activityEvents.projectId, p.id)).orderBy(desc(activityEvents.occurredAt)).limit(1);
    expect(ev.text).toMatch(new RegExp(`^Forced stage change · ${mine.code} → .+ · 24 Sep 2026$`));
  });

  it('refuses a date after today, before the previous change, or malformed — nothing is written', async () => {
    const { mine } = await pick(PERSONA_BY_ROLE.pm.short);
    const fresh = (await listProjects()).find((p) => p.code === mine.code)!;
    const to = transitionsOf(fresh.stage)[0];
    const n = (await getStageHistory(mine.code)).length;
    expect(await forced(mine.code, to, '2026-09-26')).toEqual({ ok: false, error: 'The effective date cannot be after today' });
    expect(await forced(mine.code, to, '2026-09-23')).toEqual({ ok: false, error: 'The effective date cannot be before the previous stage change' });
    expect(await forced(mine.code, to, '24/09/2026')).toEqual({ ok: false, error: 'Enter a valid effective date' });
    expect(await forced(mine.code, to, 20260924)).toEqual({ ok: false, error: 'Enter a valid effective date' });
    expect((await getStageHistory(mine.code)).length).toBe(n);
  });

  it('without a date, the change is dated today (the project data date); the same day as the previous change is accepted', async () => {
    const { mine } = await pick(PERSONA_BY_ROLE.pm.short);
    let fresh = (await listProjects()).find((p) => p.code === mine.code)!;
    if (!transitionsOf(fresh.stage).length) return;
    expect(await forced(mine.code, transitionsOf(fresh.stage)[0])).toEqual({ ok: true });
    expect((await getStageHistory(mine.code)).at(-1)!.dateIso).toBe('2026-09-25');
    fresh = (await listProjects()).find((p) => p.code === mine.code)!;
    const next = transitionsOf(fresh.stage)[0];
    if (next) expect(await forced(mine.code, next, '2026-09-25')).toEqual({ ok: true });
  });

  it('rights: another PM’s project and a member are refused; the director may date a move', async () => {
    const { other } = await pick(PERSONA_BY_ROLE.pm.short);
    const to = transitionsOf(other.stage)[0];
    expect(await forced(other.code, to, '2026-09-24')).toEqual({ ok: false, error: 'Read-only — you cannot change the project lifecycle' });
    session.role = 'member';
    expect(await forced(other.code, to, '2026-09-24')).toEqual({ ok: false, error: 'Read-only — you cannot change the project lifecycle' });
    // R-042 (P-1): the Projects register is outside the client's workspace — the client is sent home.
    session.role = 'client';
    await expect(forced(other.code, to, '2026-09-24')).rejects.toThrow('NEXT_REDIRECT');
    session.role = 'director';
    const prev = (await getStageHistory(other.code)).at(-1)?.dateIso ?? null;
    const date = prev && prev > '2026-09-20' ? prev : '2026-09-20';
    expect(await forced(other.code, to, date)).toEqual({ ok: true });
    expect((await getStageHistory(other.code)).at(-1)!.dateIso).toBe(date);
  });

  it('the writer re-checks the bounds and the stage the caller saw (concurrent moves)', async () => {
    const all = (await listProjects()).filter((p) => p.stage !== 'clos' && p.stage !== 'annule');
    const p = all.at(-1)!;
    const to = transitionsOf(p.stage)[0];
    await expect(recordStageChange(p.code, to, 'auto', { effectiveOn: '2027-01-01' })).rejects.toBeInstanceOf(StageChangeError);
    const other = p.stage === 'initiative' ? 'aps' : 'initiative';
    await expect(recordStageChange(p.code, to, 'auto', { from: other })).rejects.toMatchObject({ code: 'stale' });
    const db = await getDb();
    const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, p.code));
    const n = (await db.select().from(stageTransitions).where(eq(stageTransitions.projectId, row.id))).length;
    expect((await getStageHistory(p.code)).length).toBe(n);
  });
});
