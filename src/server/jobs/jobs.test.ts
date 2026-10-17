// R-006 — the scheduled jobs against an in-memory database: leases (one runner per job, expiry, gap between scheduled runs),
// one run's outcome recorded and logged, and what each job does — outbox redelivery to Vigie and Cursus (mock: nothing sent;
// HTTP: the pending entries delivered once), the plan-trash purge of every project (expired and beyond 20, attachment files
// deleted) and the orphan-file prune (old files without a record only). Every job run twice changes nothing more.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { dailySlotOn } from '@/domain/jobs';
import { connectors, cursusRequests, jobLocks, planTrash, projects, vigieEcoProgress } from '@/server/db/schema';
import { recordEcoProgress } from '@/server/dal/eco';
import { acquireJobLock, listJobLocks, releaseJobLock } from '@/server/dal/job-locks';
import { listPlanTrash, trashPlanRow } from '@/server/dal/plan-trash';
import { mockCursusConnector } from '@/server/integrations/cursus/connector';
import { getStoredFile, setFilesRoot, storeFile } from '@/server/storage/files';
import { JOB_DEFINITIONS, jobDefinition, type JobDefinition } from './definitions';
import { jobDailyAt, runJob, scheduledEntries } from './runner';

const day = 86_400_000;
let dir: string;
const run = (name: Parameters<typeof jobDefinition>[0]) => jobDefinition(name).run();
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r006-'));
  setFilesRoot(dir);
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('leases (job_locks)', () => {
  it('one holder at a time; only the holder releases; the outcome is recorded', async () => {
    expect(await acquireJobLock('t1', 'A', 60_000)).toBe(true);
    expect(await acquireJobLock('t1', 'B', 60_000)).toBe(false);
    expect(await releaseJobLock('t1', 'B', { ok: true })).toBe(false);
    expect(await releaseJobLock('t1', 'A', { ok: true, summary: '3 delivered' })).toBe(true);
    const [row] = (await listJobLocks()).filter((r) => r.job === 't1');
    expect([row.holder, row.lockedUntil, row.lastOk, row.lastSummary, row.runCount, !!row.lastStartedAt, !!row.lastFinishedAt]).toEqual(['A', null, true, '3 delivered', 1, true, true]);
  });

  it('a scheduled run waits for the gap since the last start; a manual run (gap 0) does not', async () => {
    expect(await acquireJobLock('t2', 'A', 60_000)).toBe(true);
    await releaseJobLock('t2', 'A', { ok: true });
    expect(await acquireJobLock('t2', 'B', 60_000, 3_600_000)).toBe(false);
    expect(await acquireJobLock('t2', 'B', 60_000, 0)).toBe(true);
  });

  it('an expired lease (crashed worker) is taken over; the late release of the old holder changes nothing', async () => {
    expect(await acquireJobLock('t3', 'A', 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(await acquireJobLock('t3', 'B', 60_000)).toBe(true);
    expect(await releaseJobLock('t3', 'A', { ok: false, error: 'late' })).toBe(false);
    const [row] = (await listJobLocks()).filter((r) => r.job === 't3');
    expect([row.holder, row.lastError, row.runCount, row.lockedUntil !== null]).toEqual(['B', null, 0, true]);
  });

  it('workers racing for the same lease: exactly one wins', async () => {
    const won = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((h) => acquireJobLock('t4', h, 60_000)));
    expect(won.filter(Boolean)).toHaveLength(1);
  });
});

describe('one run', () => {
  const job = (run: () => Promise<{ summary: string; counts: Record<string, number> }>): JobDefinition =>
    ({ name: 'test-job' as never, everyMs: 60_000, leaseMs: 60_000, firstDelayMs: 0, run });

  it('ok: recorded and logged as one JSON line; skipped while another holder runs it; failure recorded, never thrown', async () => {
    // The server logger (R-009) writes JSON in production; LOG_FORMAT forces it here.
    vi.stubEnv('LOG_FORMAT', 'json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runJob(job(async () => ({ summary: '2 done', counts: { done: 2 } })), 'W1');
    expect(r).toMatchObject({ status: 'ok', summary: '2 done' });
    const finished = log.mock.calls.map((c) => JSON.parse(String(c[0]))).find((l) => l.msg === 'Job finished');
    expect(finished).toMatchObject({ level: 'info', component: 'jobs', job: 'test-job', holder: 'W1', summary: '2 done', done: 2 });
    // A scheduled run right after: skipped (ran recently), logged.
    expect(await runJob(job(async () => ({ summary: 'again', counts: {} })), 'W2')).toEqual({ status: 'skipped' });
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])).msg)).toContain('Job skipped');
    // Manual run that fails: recorded with its error.
    const failed = await runJob(job(async () => { throw new Error('Vigie unreachable\nretry later'); }), 'W2', { force: true });
    expect(failed).toMatchObject({ status: 'failed', error: 'Vigie unreachable retry later' });
    expect(JSON.parse(String(err.mock.calls.at(-1)![0]))).toMatchObject({ level: 'error', msg: 'Job failed', job: 'test-job', error: 'Vigie unreachable retry later' });
    const [row] = (await listJobLocks()).filter((x) => x.job === 'test-job');
    expect([row.lastOk, row.lastError, row.runCount, row.lockedUntil]).toEqual([false, 'Vigie unreachable retry later', 2, null]);
  });
});

// Owner's answer of 17 Oct 2026 to R-121: reminder jobs run once a day in the morning (07:00 Paris by default,
// KEYSTONE_REMINDERS_AT). The lease's "not started since today's slot" makes the day's run happen once, whatever the restarts
// and the workers; a manual run (--once) ignores the hour.
describe('reminder jobs: once per morning', () => {
  const paris = (iso: string, hhmm: string) => dailySlotOn(iso, hhmm);
  const setLastStart = async (job: string, at: Date) => {
    const db = await getDb();
    await db.update(jobLocks).set({ lastStartedAt: at }).where(eq(jobLocks.job, job));
  };

  it('runs after the hour only, once a day: a restart or a second worker the same day sends nothing more', async () => {
    quiet();
    let n = 0;
    const job: JobDefinition = { name: 'test-reminders' as never, everyMs: day, leaseMs: 60_000, firstDelayMs: 0, daily: 'reminders', run: async () => ({ summary: `run ${++n}`, counts: {} }) };
    // Worker started at 10:00 on a day whose 07:00 run was missed: runs at once.
    const startedAt = paris('2030-01-10', '10:00');
    expect(await runJob(job, 'W1', { at: startedAt })).toMatchObject({ status: 'ok', summary: 'run 1' });
    await setLastStart('test-reminders', startedAt);
    // Restarted at noon the same day: today's run already happened.
    expect(await runJob(job, 'W2', { at: paris('2030-01-10', '12:00') })).toEqual({ status: 'skipped' });
    // Next day before 07:00: not yet (no lease taken).
    expect(await runJob(job, 'W2', { at: paris('2030-01-11', '06:59') })).toEqual({ status: 'skipped' });
    // 07:00: the day's run; a second worker a few minutes later skips it.
    expect(await runJob(job, 'W2', { at: paris('2030-01-11', '07:00') })).toMatchObject({ status: 'ok', summary: 'run 2' });
    await setLastStart('test-reminders', paris('2030-01-11', '07:00'));
    expect(await runJob(job, 'W3', { at: paris('2030-01-11', '07:05') })).toEqual({ status: 'skipped' });
    // A manual run (npm run worker -- --once) runs whatever the hour (its gap 0 compares with the database clock: the last
    // start is put back to a real past instant).
    await setLastStart('test-reminders', new Date(Date.now() - day));
    expect(await runJob(job, 'W3', { at: paris('2030-01-11', '07:06'), force: true })).toMatchObject({ status: 'ok', summary: 'run 3' });
    expect(n).toBe(3);
  });

  it('the J-15 alerts are a reminder job at KEYSTONE_REMINDERS_AT (07:00 by default); technical jobs keep their intervals', () => {
    expect(jobDailyAt(jobDefinition('site-prerequisite-alerts'))).toBe('07:00');
    vi.stubEnv('KEYSTONE_REMINDERS_AT', '06:30');
    expect(jobDailyAt(jobDefinition('site-prerequisite-alerts'))).toBe('06:30');
    const entries = scheduledEntries(JOB_DEFINITIONS, 'W');
    expect(entries.filter((e) => e.dailyAt).map((e) => [e.name, e.dailyAt])).toEqual([['site-prerequisite-alerts', '06:30']]);
    expect(entries.find((e) => e.name === 'vigie-outbox')).toMatchObject({ everyMs: 300_000, dailyAt: null });
  });
});

describe('outbox redelivery', () => {
  it('Vigie mock: nothing is sent, the waiting entries are reported', async () => {
    await recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, { name: 'Romain Aubert', role: 'pm' });
    const db = await getDb();
    const waiting = (await db.select().from(vigieEcoProgress)).filter((e) => e.syncStatus !== 'sent').length;
    expect(waiting).toBeGreaterThan(0);
    expect(await run('vigie-outbox')).toEqual({ summary: `Vigie mock connector · nothing sent · ${waiting} waiting`, counts: { delivered: 0, failed: 0, pending: waiting } });
  });

  it('Vigie HTTP: every entry not yet sent is delivered once; a second run sends nothing', async () => {
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test');
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') throw new Error('no read expected');
      posted.push(String(url));
      return new Response(JSON.stringify({ id: `V-${posted.length}` }), { status: 200 });
    }));
    const db = await getDb();
    const waiting = (await db.select().from(vigieEcoProgress)).filter((e) => e.syncStatus !== 'sent').length;
    expect(await run('vigie-outbox')).toEqual({ summary: `Vigie · ${waiting} delivered · 0 failed · 0 pending`, counts: { delivered: waiting, failed: 0, pending: 0 }, warn: false });
    expect(posted).toHaveLength(waiting);
    expect(await run('vigie-outbox')).toMatchObject({ summary: 'Vigie · 0 delivered · 0 failed · 0 pending' });
    expect(posted).toHaveLength(waiting);
  });

  it('D-7a: a connector IT disabled sends nothing — its entries stay pending and go once it is enabled again', async () => {
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test');
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      posted.push(String(url));
      return new Response(JSON.stringify({ id: 'V-x' }), { status: 200 });
    }));
    const db = await getDb();
    const [entry] = await db.select({ id: vigieEcoProgress.id }).from(vigieEcoProgress).limit(1);
    await db.update(vigieEcoProgress).set({ syncStatus: 'pending', sentAt: null }).where(eq(vigieEcoProgress.id, entry.id));
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Vigie'));
    expect(await run('vigie-outbox')).toMatchObject({ counts: { delivered: 0, failed: 0, pending: 1 } });
    expect(posted).toEqual([]);
    await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Vigie'));
    expect(await run('vigie-outbox')).toMatchObject({ counts: { delivered: 1, failed: 0, pending: 0 } });
    expect(posted).toHaveLength(1);
  });

  it('Codex (R-124): the mock reports what waits; nothing is sent', async () => {
    expect(await run('codex-outbox')).toMatchObject({ summary: expect.stringMatching(/^Codex mock connector · nothing sent · \d+ waiting$/) });
  });

  it('Cursus: mock reports; HTTP delivers the travel request once, a failure is a warning retried at the next run', async () => {
    const actor = { name: 'Romain Aubert', role: 'pm' as const };
    const r = await mockCursusConnector.requestTravel('HLT-026', { personName: 'Thomas Kerbrat', destination: 'FR', depart: '2026-10-26', retour: '2026-11-27' }, actor);
    const db = await getDb();
    const waiting = (await db.select().from(cursusRequests)).filter((e) => e.syncStatus !== 'sent').length;
    expect(await run('cursus-outbox')).toMatchObject({ summary: `Cursus mock connector · nothing sent · ${waiting} waiting` });
    vi.stubEnv('CURSUS_API_URL', 'http://cursus.test');
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 77 }), { status: 201 });
    }));
    // The seeded people have no Cursus matricule yet: the delivery fails, the entry stays for the next run.
    const reminders = (await db.select().from(cursusRequests)).filter((e) => e.syncStatus !== 'sent' && e.kind === 'reminder').length;
    expect(await run('cursus-outbox')).toEqual({ summary: `Cursus · 0 delivered · 1 failed · ${waiting} pending`, counts: { delivered: 0, failed: 1, pending: waiting }, warn: true });
    // Once the person has a matricule and the site its Cursus site id, the next run delivers it.
    await db.update(cursusRequests).set({ matricule: 'EMP-0018' }).where(eq(cursusRequests.id, r.id));
    await db.execute(sql`update site_sheets set cursus_chantier_id = 'K-2614'`);
    expect(await run('cursus-outbox')).toEqual({ summary: `Cursus · 1 delivered · 0 failed · ${reminders} pending`, counts: { delivered: 1, failed: 0, pending: reminders }, warn: false });
    expect(bodies.at(-1)).toEqual({ matricule: 'EMP-0018', chantier: 'K-2614', destination: 'FR', depart: '2026-10-26', retour: '2026-11-27' });
    expect(await run('cursus-outbox')).toMatchObject({ counts: { delivered: 0, failed: 0, pending: reminders } });
  });
});

describe('plan-trash purge (every project)', () => {
  it('removals older than 30 days leave "Recently deleted"; recent ones stay; a second run purges nothing', async () => {
    const now = Date.now();
    expect(await trashPlanRow('HLT-026', 'act', 'A1510', 'Romain Aubert', new Date(now - day))).toBeTruthy();
    expect(await trashPlanRow('HLT-026', 'act', 'A1520', 'Romain Aubert', new Date(now - 40 * day))).toBeTruthy();
    expect((await listPlanTrash('HLT-026', { limit: 10, now: new Date(now - 40 * day) })).map((e) => e.code)).toContain('A1520');
    expect(await run('plan-trash-purge')).toEqual({ summary: '1 trash entries purged on 1 projects · 0 files deleted', counts: { entries: 1, files: 0, projects: 1 } });
    expect((await listPlanTrash('HLT-026', { limit: 10 })).map((e) => e.code)).toEqual(['A1510']);
    expect(await run('plan-trash-purge')).toMatchObject({ counts: { entries: 0, files: 0, projects: 0 } });
  });

  it('keeps the 20 newest per project; the attachment files of purged entries are deleted', async () => {
    const db = await getDb();
    const [ndc] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
    const file = await storeFile({ purpose: 'attachment', name: 'note.txt', data: new TextEncoder().encode('trashed note'), actor: { name: 'Romain Aubert' } });
    const payload = (fileId: string | null) => ({ v: 1, tables: fileId ? [{ table: 'task_attachments', rows: [{ id: 'x', fileId }] }] : [], refs: [] });
    const now = Date.now();
    const rows = Array.from({ length: 22 }, (_, i) => ({
      projectId: ndc.id, kind: 'act' as const, code: `Z${i}`, name: `Removed ${i}`, activityCount: 1, payload: payload(i === 21 ? file.id : null),
      deletedAt: new Date(now - i * 60_000), deletedByName: 'Romain Aubert',
    }));
    await db.insert(planTrash).values(rows);
    expect(await run('plan-trash-purge')).toEqual({ summary: '2 trash entries purged on 1 projects · 1 files deleted', counts: { entries: 2, files: 1, projects: 1 } });
    const left = await db.select({ code: planTrash.code }).from(planTrash).where(and(eq(planTrash.projectId, ndc.id), inArray(planTrash.code, ['Z19', 'Z20', 'Z21'])));
    expect(left.map((r) => r.code)).toEqual(['Z19']);
    expect(await getStoredFile(file.id)).toBeNull();
    expect(fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.txt'))).toEqual([]);
  });
});

describe('orphan-file prune', () => {
  it('removes files without a record older than 24 h; keeps recorded files and recent uploads', async () => {
    const stored = await storeFile({ purpose: 'attachment', name: 'kept.pdf', data: new TextEncoder().encode('%PDF-1.4 kept'), actor: { name: 'Romain Aubert' } });
    const sub = path.join(dir, '2026', '10');
    fs.mkdirSync(sub, { recursive: true });
    const old = path.join(sub, 'orphan-old.txt');
    const fresh = path.join(sub, 'orphan-new.txt.part');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(fresh, 'y');
    const twoDaysAgo = new Date(Date.now() - 2 * day);
    fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
    const keptAbs = fs.readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith('.pdf'))!;
    fs.utimesSync(path.join(dir, keptAbs), twoDaysAgo, twoDaysAgo);
    expect(await run('orphan-files-prune')).toEqual({ summary: '1 orphan files removed', counts: { removed: 1 } });
    expect([fs.existsSync(old), fs.existsSync(fresh), !!(await getStoredFile(stored.id)), fs.existsSync(path.join(dir, keptAbs))]).toEqual([false, true, true, true]);
    expect(await run('orphan-files-prune')).toMatchObject({ counts: { removed: 0 } });
  });

  it('through the runner: logged with its counts', async () => {
    quiet();
    expect(await runJob(jobDefinition('orphan-files-prune'), 'W9', { force: true })).toMatchObject({ status: 'ok', summary: '0 orphan files removed' });
    const [row] = (await listJobLocks()).filter((r) => r.job === 'orphan-files-prune');
    expect([row.lastOk, row.lastSummary, row.holder]).toEqual([true, '0 orphan files removed', 'W9']);
  });
});
