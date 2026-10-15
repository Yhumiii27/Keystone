import 'server-only';
// The scheduled jobs (R-006) and what each run does. Schedules and rules: src/domain/jobs.ts. Each run returns an EN summary
// for the log and the job_locks row, and whether something needs attention (a delivery that failed).
import { JOB_SCHEDULES, ORPHAN_FILE_GRACE_MS, type JobName, type JobSchedule } from '@/domain/jobs';
import { purgeExpiredPlanTrash } from '@/server/dal/plan-trash';
import { refreshCodexIndex } from '@/server/dal/documents';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { redeliverCodexOutbox } from '@/server/integrations/codex/connector';
import { redeliverCursusOutbox } from '@/server/integrations/cursus/connector';
import { purgeOldCursusEvents } from '@/server/integrations/cursus/inbox';
import { directoryRunSummary, runDirectoryImport } from '@/server/dal/persons-directory';
import { redeliverEcoOutbox } from '@/server/integrations/vigie/eco-connector';
import { redeliverNcrOutbox } from '@/server/integrations/vigie/quality-connector';
import { pruneOrphanFiles } from '@/server/storage/files';

export interface JobOutcome {
  summary: string;
  /** Counts written to the log line. */
  counts: Record<string, number>;
  /** A delivery failed: the run is logged as a warning (the connector shows it on Activity & integrations). */
  warn?: boolean;
}

export interface JobDefinition extends JobSchedule {
  run: () => Promise<JobOutcome>;
}

type Delivery = { mode: 'mock' | 'http'; delivered: number; failed: number; pending: number };

/** "mock connector · nothing sent · 2 waiting" or "3 delivered · 0 failed · 0 pending". */
function outboxOutcome(system: string, parts: Delivery[]): JobOutcome {
  const sum = (k: 'delivered' | 'failed' | 'pending') => parts.reduce((n, p) => n + p[k], 0);
  const [delivered, failed, pending] = [sum('delivered'), sum('failed'), sum('pending')];
  const counts = { delivered, failed, pending };
  if (parts.every((p) => p.mode === 'mock')) return { summary: `${system} mock connector · nothing sent · ${pending} waiting`, counts };
  return { summary: `${system} · ${delivered} delivered · ${failed} failed · ${pending} pending`, counts, warn: failed > 0 };
}

const RUNS: Record<JobName, () => Promise<JobOutcome>> = {
  // ECO and NCR progress recorded in Keystone, sent to Vigie (one at a time: both outboxes share the connection).
  'vigie-outbox': async () => {
    const eco = await redeliverEcoOutbox();
    const ncr = await redeliverNcrOutbox();
    return outboxOutcome('Vigie', [eco, ncr]);
  },
  // Travel requests (and reminders, which stay pending: no Cursus endpoint) sent to Cursus.
  'cursus-outbox': async () => outboxOutcome('Cursus', [await redeliverCursusOutbox()]),
  // Document approval decisions and engineering circuit starts sent to Codex (R-124).
  'codex-outbox': async () => outboxOutcome('Codex', [await redeliverCodexOutbox()]),
  'plan-trash-purge': async () => {
    const r = await purgeExpiredPlanTrash();
    return { summary: `${r.entries} trash entries purged on ${r.projects} projects · ${r.files} files deleted`, counts: r };
  },
  'orphan-files-prune': async () => {
    const removed = await pruneOrphanFiles({ graceMs: ORPHAN_FILE_GRACE_MS });
    return { summary: `${removed} orphan files removed`, counts: { removed } };
  },
  // ── Delivery 8 · platform-ops jobs ──
  // Snapshot of the database and the stored files when due (R-004; nothing while KEYSTONE_BACKUP_DIR is unset). The modules
  // are imported here (not at the top) so this lot's lines stay under its marker.
  backup: async () => (await import('@/server/backup/job')).runBackupJob(),
  // Antivirus rescan of the stored files, purge of expired quarantine copies (R-175).
  'files-rescan': async () => {
    const r = await (await import('@/server/storage/rescan')).rescanStoredFiles();
    const counts = { scanned: r.scanned, flagged: r.flagged, released: r.released, missing: r.missing, purged: r.purged };
    if (r.state === 'off') return { summary: `antivirus off · nothing rescanned · ${r.purged} quarantine entries purged`, counts };
    const summary = `${r.scanned} files rescanned · ${r.flagged} blocked · ${r.released} released · ${r.missing} missing · ${r.purged} quarantine entries purged`;
    return { summary: r.state === 'stopped' ? `antivirus unavailable · stopped after ${summary}` : summary, counts, warn: r.state === 'stopped' || r.flagged > 0 };
  },
  // ── Delivery 8 · connectors jobs ──
  // R-027 (NEW-CURSUS-2): Cursus's staff directory → persons, then the events left unresolved replayed. Nothing while
  // CURSUS_DIRECTORY is off, the connector disabled by IT or simulated.
  'cursus-directory': async (): Promise<JobOutcome> => {
    const run = await runDirectoryImport();
    const summary = `Cursus staff directory · ${directoryRunSummary(run)}`;
    if (run.state !== 'done') return { summary, counts: {} };
    const r = run.result;
    return {
      summary, counts: { matched: r.matched, created: r.created, reported: r.reported + r.invalid, resolved: run.replayed.received }, warn: r.reported + r.invalid > 0,
    };
  },
  // R-029 (NEW-CURSUS-7): events Cursus pushed, kept 13 months.
  'cursus-events-purge': async () => {
    const removed = await purgeOldCursusEvents();
    return { summary: `${removed} Cursus events older than 13 months purged`, counts: { removed } };
  },
  // ── Delivery 8 · docs-client-portfolio jobs ──
  // Codex's index read by the HTTP connector (R-033): records changed since the last read; the mock reads nothing (A-15:
  // production without Codex keeps an empty index). A Codex that does not answer fails the run (logged, retried next hour).
  'codex-index': async (): Promise<JobOutcome> => {
    if (codexConnectorMode() !== 'http') return { summary: 'Codex mock connector · index not read', counts: { applied: 0 } };
    const r = await refreshCodexIndex(null);
    if (!r.read) return { summary: 'Codex connector disabled · index not read', counts: { applied: 0 } };
    return {
      summary: `Codex index read · ${r.applied} records applied · ${r.created} new · ${r.skipped} skipped · ${r.records} in the index`,
      counts: { applied: r.applied, created: r.created, skipped: r.skipped, records: r.records }, warn: r.skipped > 0,
    };
  },
};

export const JOB_DEFINITIONS: readonly JobDefinition[] = JOB_SCHEDULES.map((s) => ({ ...s, run: RUNS[s.name] }));

export const jobDefinition = (name: JobName): JobDefinition => JOB_DEFINITIONS.find((d) => d.name === name)!;
