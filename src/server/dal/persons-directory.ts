import 'server-only';
// Cursus staff directory → Keystone persons (R-027, NEW-CURSUS-2 "a"): the writer applies the pure plan of
// src/domain/directory.ts in one transaction — matches by matricule, then work e-mail; creates the missing EPC2i persons;
// never deletes, never creates a user account or a role (Microsoft Entra ID gives them at sign-in, R-038), never touches an
// external contact. Dormant until CURSUS_DIRECTORY=on (Cursus has no directory endpoint yet): `runDirectoryImport` is what
// the daily job "cursus-directory" and the Cursus row's "Sync now" call. After an import, the Cursus events left unresolved
// for want of a matricule are replayed (src/server/integrations/cursus/inbox.ts).
import { eq, inArray, sql } from 'drizzle-orm';
import { planDirectoryImport, type DirectoryEntry, type DirectoryPlan } from '@/domain/directory';
import { getDb } from '@/server/db/client';
import { recordActivity, writeAudit } from '@/server/db/helpers';
import { departments, persons } from '@/server/db/schema';
import { CURSUS_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { cursusConnectorMode, cursusDirectoryOn } from '@/server/integrations/cursus/connection';
import { getCursusConnector } from '@/server/integrations/cursus/connector';
import { replayUnresolvedCursusEvents } from '@/server/integrations/cursus/inbox';
import { log } from '@/server/log';

/** Who the audit trail and the activity feed name for what Cursus sends (a system, like "IT · configuration file"). */
export const CURSUS_ACTOR = 'Cursus';

export interface DirectoryImportResult {
  matched: number;
  updated: number;
  created: number;
  reported: number;
  invalid: number;
  unmatchedTeams: string[];
}

/**
 * Imports Cursus's staff directory into persons (one transaction; returns the counts). Each created or changed person gets an
 * audit row (actor "Cursus", area "Integrations"); one activity event sums the run up. Reports and teams without a
 * department are logged (matricules only, no name or e-mail).
 */
export async function importStaffDirectory(entries: readonly DirectoryEntry[], opts: { invalid?: number; at?: Date } = {}): Promise<DirectoryImportResult> {
  const db = await getDb();
  const at = opts.at ?? new Date();
  const plan: DirectoryPlan = await db.transaction(async (tx) => {
    const [people, depts] = await Promise.all([
      tx.select({
        id: persons.id, fullName: persons.fullName, shortName: persons.shortName, email: persons.email, matricule: persons.matricule, clientId: persons.clientId,
        departmentId: persons.departmentId, directoryTeam: persons.directoryTeam,
      }).from(persons),
      tx.select({ id: departments.id, name: departments.name }).from(departments),
    ]);
    const p = planDirectoryImport(entries, people, depts);
    for (const u of p.updates) {
      await tx.update(persons).set({ ...u.set, directorySyncedAt: at, updatedAt: at }).where(eq(persons.id, u.personId));
      const fields = Object.keys(u.set).map((k) => (k === 'matricule' ? `matricule ${u.set.matricule}` : k === 'departmentId' ? 'department' : k === 'directoryTeam' ? 'team' : k));
      await writeAudit(tx, {
        actorName: CURSUS_ACTOR, objectRef: `Person ${people.find((x) => x.id === u.personId)?.shortName ?? ''}`.trim(), change: `staff directory · ${fields.join(', ')}`,
        area: 'Integrations', entityType: 'person', entityId: u.personId, occurredAt: at,
      });
    }
    const untouched = p.matched.filter((m) => !p.updates.some((u) => u.personId === m.personId)).map((m) => m.personId);
    if (untouched.length) await tx.update(persons).set({ directorySyncedAt: at }).where(inArray(persons.id, untouched));
    if (p.creates.length) {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${persons.sortOrder}), 0)::int + 1` }).from(persons);
      const rows = await tx.insert(persons).values(p.creates.map((c, i) => ({
        fullName: c.fullName, shortName: c.shortName, initials: c.initials, email: c.email, matricule: c.matricule, departmentId: c.departmentId,
        directoryTeam: c.directoryTeam, directorySyncedAt: at, sortOrder: next + i,
      }))).returning({ id: persons.id, shortName: persons.shortName, matricule: persons.matricule });
      for (const r of rows)
        await writeAudit(tx, {
          actorName: CURSUS_ACTOR, objectRef: `Person ${r.shortName}`, change: `created from the staff directory · matricule ${r.matricule}`, area: 'Integrations',
          entityType: 'person', entityId: r.id, occurredAt: at,
        });
    }
    if (p.matched.length || p.creates.length)
      await recordActivity(tx, {
        actorName: CURSUS_ACTOR, kind: 'sync', occurredAt: at,
        text: `Staff directory imported from Cursus · ${p.matched.length} matched · ${p.creates.length} created${p.reports.length ? ` · ${p.reports.length} to check` : ''}`,
      });
    return p;
  });
  for (const r of plan.reports) log.warn('Cursus staff directory: entry not imported', { component: 'cursus', matricule: r.matricule, reason: r.reason });
  if (plan.unmatchedTeams.length) log.info('Cursus staff directory: teams without a department of that name (kept as text)', { component: 'cursus', teams: plan.unmatchedTeams.length });
  if (opts.invalid) log.warn('Cursus staff directory: rows without a matricule or a name were skipped', { component: 'cursus', count: opts.invalid });
  return {
    matched: plan.matched.length, updated: plan.updates.length, created: plan.creates.length, reported: plan.reports.length, invalid: opts.invalid ?? 0,
    unmatchedTeams: plan.unmatchedTeams,
  };
}

export type DirectoryRun =
  | { state: 'off' | 'disabled' | 'mock' }
  | { state: 'done'; result: DirectoryImportResult; replayed: { received: number; unresolved: number; error: number } };

/**
 * One directory import from Cursus (job "cursus-directory", "Sync now" of the Cursus row): nothing while CURSUS_DIRECTORY is
 * off, while IT disabled the Cursus connector (D-7a) or with the mock connector (no directory); else fetch, import, and
 * replay the events left unresolved. Throws when Cursus is unreachable or answers something unexpected.
 */
export async function runDirectoryImport(): Promise<DirectoryRun> {
  if (!cursusDirectoryOn()) return { state: 'off' };
  if (!(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return { state: 'disabled' };
  if (cursusConnectorMode() !== 'http') return { state: 'mock' };
  const payload = await getCursusConnector().listDirectory();
  if (!payload) return { state: 'mock' };
  const result = await importStaffDirectory(payload.entries, { invalid: payload.invalid });
  const replayed = await replayUnresolvedCursusEvents();
  return { state: 'done', result, replayed };
}

/** "412 matched · 3 created · 1 to check · 2 events resolved" — EN summary of a run (job log, Sync now volume). */
export function directoryRunSummary(run: DirectoryRun): string {
  if (run.state === 'off') return 'staff directory import off (CURSUS_DIRECTORY)';
  if (run.state === 'disabled') return 'Cursus connector disabled by IT';
  if (run.state !== 'done') return 'mock connector · no staff directory';
  const r = run.result;
  return `${r.matched} matched · ${r.created} created · ${r.reported + r.invalid} to check · ${run.replayed.received} events resolved`;
}
