import 'server-only';
// The scheduled jobs (R-006) and what each run does. Schedules and rules: src/domain/jobs.ts. Each run returns an EN summary
// for the log and the job_locks row, and whether something needs attention (a delivery that failed).
import { JOB_SCHEDULES, ORPHAN_FILE_GRACE_MS, type JobName, type JobSchedule } from '@/domain/jobs';
import { purgeExpiredPlanTrash } from '@/server/dal/plan-trash';
import { redeliverCodexOutbox } from '@/server/integrations/codex/connector';
import { redeliverCursusOutbox } from '@/server/integrations/cursus/connector';
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
};

export const JOB_DEFINITIONS: readonly JobDefinition[] = JOB_SCHEDULES.map((s) => ({ ...s, run: RUNS[s.name] }));

export const jobDefinition = (name: JobName): JobDefinition => JOB_DEFINITIONS.find((d) => d.name === name)!;
