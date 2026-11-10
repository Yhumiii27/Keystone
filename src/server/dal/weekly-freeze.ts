import 'server-only';
// Project data date and the Friday weekly freeze (R-060; owner's answers D9-09 and D9-10 of 10 Nov 2026; rules in
// src/domain/data-date.ts).
// - `setProjectDataDate`: the PM (project leads) or the director advances the data date from the Plan (« Data date » chip) —
//   audited with its before / after and recorded in the activity feed. Keystone never writes it on its own.
// - `runFridayFreeze` (job `friday-freeze`, every morning at the reminders hour): for the week's status date (the latest Friday
//   up to the business date) it (1) freezes one snapshot per active project with planning data — CPI, SPI, EAC, margin, open
//   risks (number and exposure), progress, plus the critical float and the milestone slip the Trends screen already charts —
//   never overwriting a frozen week, and (2) proposes that Friday as the data date to the PM of record (a bell notice, once per
//   project and Friday) while the stored data date is older or unset. A worker stopped on Friday catches the week up on the
//   next morning's run; an earlier missed Friday is not rebuilt (its figures are gone).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { criticalFloatDays, dataDateError, fridayOnOrBefore, frozenIndex, frozenKeur, milestoneSlipDays, proposedDataDate } from '@/domain/data-date';
import { clampHealthCpi } from '@/domain/health';
import { projectEacKeur } from '@/domain/kpis';
import { systemMessage } from '@/domain/system-messages';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { isoWeekOf } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, notifications, projects, statusSnapshots } from '@/server/db/schema';
import { logError } from '@/server/log';
import { listEurBillingPlans, marginAtCompletion } from './cashflow';
import { listProjectEvms } from './evm';
import { notifyPersonIds } from './person-notices';
import { listProjects, type ProjectRow } from './projects';
import { listOpenRiskTotals } from './risks';

/** Label of an unset data date in the audit message (the business date applies). */
export const UNSET_DATA_DATE = 'Business date';

export class DataDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDateError';
  }
}

/**
 * D9-09: sets the project's data date (the caller checked the viewer's right: the project's leads or the director). Refused
 * (DataDateError with an EN message of DATA_DATE_ERRORS, src/domain/data-date.ts) after the business date, backwards or unchanged.
 */
export async function setProjectDataDate(code: string, next: string, actorName: string): Promise<{ from: string | null; to: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const [row] = await tx.select({ dataDate: projects.dataDate }).from(projects).where(eq(projects.id, p.id)).for('update');
    const from = row?.dataDate ?? null;
    const err = dataDateError(next, from, await businessToday(tx));
    if (err) throw new DataDateError(err);
    await tx.update(projects).set({ dataDate: next, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const message = systemMessage('plan.dataDateSet', { from: from ?? UNSET_DATA_DATE, to: next });
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: `${code} data date`, message, area: 'Planning', entityType: 'project', entityId: p.id, projectId: p.id,
      before: { dataDate: from }, after: { dataDate: next },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, message, kind: 'snapshot', projectId: p.id });
    return { from, to: next };
  });
}

/** Fixed English title of the Friday proposal (translated by the bell). */
export const DATA_DATE_PROPOSAL_TITLE = 'Advance the data date';

/** The bell notice proposing `friday` as the data date of a project; opens its Plan (`?dataDate=` presets the dialog). */
export const dataDateProposalNotice = (projectCode: string, friday: string) => ({
  kind: 'alert' as const,
  title: DATA_DATE_PROPOSAL_TITLE,
  sub: `${projectCode} · ${friday}`,
  screen: 'plan',
  params: { dataDate: friday },
  projectCode,
});

export interface FridayFreezeRun {
  today: string;
  /** The week's status date (latest Friday up to today). */
  friday: string;
  /** Projects considered (planning data, not closed or cancelled). */
  projects: number;
  /** Snapshots frozen by this run. */
  frozen: number;
  /** Weeks already frozen (kept as they were). */
  kept: number;
  /** Data date proposals sent by this run. */
  proposed: number;
  /** Proposals already sent for that Friday. */
  alreadyProposed: number;
  /** Proposals nobody could receive (no PM of record, no active account). */
  unaddressed: number;
}

/** Projects the freeze covers: with planning data, not closed or cancelled. */
const frozenProject = (p: ProjectRow) => p.hasData && p.stage !== 'clos' && p.stage !== 'annule';

/** One run of the job at the business date (`on`, tests). Idempotent: a week is frozen once, a Friday proposed once. */
export async function runFridayFreeze(on?: string): Promise<FridayFreezeRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const friday = fridayOnOrBefore(today);
  const all = (await listProjects()).filter(frozenProject);
  const run: FridayFreezeRun = { today, friday, projects: all.length, frozen: 0, kept: 0, proposed: 0, alreadyProposed: 0, unaddressed: 0 };
  if (!all.length) return run;
  const codes = all.map((p) => p.code);
  const [heads, evms, plans, frozen] = await Promise.all([
    db.select({ id: projects.id, code: projects.code, dataDate: projects.dataDate }).from(projects).where(inArray(projects.code, codes)),
    listProjectEvms(),
    listEurBillingPlans(),
    db.select({ projectId: statusSnapshots.projectId }).from(statusSnapshots).where(eq(statusSnapshots.statusDate, friday)),
  ]);
  const headOf = new Map(heads.map((h) => [h.code, h]));
  const done = new Set(frozen.map((f) => f.projectId));
  const ids = heads.map((h) => h.id);
  const [risks, acts] = await Promise.all([
    listOpenRiskTotals(db),
    db
      .select({
        projectId: activities.projectId, finish: activities.finishDate, baselineFinish: activities.baselineFinishDate, duration: activities.durationDays,
        pct: activities.percentComplete, float: activities.totalFloatDays, finished: activities.finishActual,
      })
      .from(activities)
      .where(inArray(activities.projectId, ids)),
  ]);
  const actsOf = new Map<string, typeof acts>();
  for (const a of acts) actsOf.set(a.projectId, [...(actsOf.get(a.projectId) ?? []), a]);

  // (1) The freeze.
  for (const p of all) {
    const h = headOf.get(p.code);
    if (!h) continue;
    if (done.has(h.id)) {
      run.kept++;
      continue;
    }
    const evm = evms.get(p.code);
    const own = actsOf.get(h.id) ?? [];
    const risk = risks.get(h.id) ?? { count: 0, emv: 0 };
    const cpi = evm?.cpi ?? (p.actual ? clampHealthCpi((p.budget * p.progress) / p.actual) : null);
    const figures = {
      cpi: frozenIndex(cpi), spi: frozenIndex(p.spi), eacKeur: frozenKeur(projectEacKeur(p)),
      floatDays: criticalFloatDays(own.map((a) => ({ totalFloatDays: a.float, finished: a.finished }))), riskEmvKeur: risk.emv, riskCount: risk.count,
      milestoneSlipDays: milestoneSlipDays(own.filter((a) => a.duration === 0).map((a) => ({ finish: a.finish, baselineFinish: a.baselineFinish, done: a.pct >= 100 }))),
      progressPct: Math.round(p.progress * 1000) / 10, marginPct: marginAtCompletion(plans[p.code], p),
    };
    const week = `W${isoWeekOf(friday)}`;
    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(statusSnapshots)
        .values({ projectId: h.id, weekCode: week, statusDate: friday, ...figures, frozenAt: new Date() })
        .onConflictDoNothing({ target: [statusSnapshots.projectId, statusSnapshots.statusDate] })
        .returning({ id: statusSnapshots.id });
      if (!row) return false;
      await writeAudit(tx, {
        actorName: 'Keystone', objectRef: `${p.code} ${week}`, message: systemMessage('trends.weekFrozen', { week, date: friday }),
        area: 'Trends', entityType: 'status_snapshot', entityId: row.id, projectId: h.id, after: { statusDate: friday, ...figures },
      });
      return true;
    });
    if (inserted) run.frozen++;
    else run.kept++;
  }

  // (2) The data date proposal (D9-09): never written, only proposed to the PM of record.
  const pending = all.filter((p) => proposedDataDate(headOf.get(p.code)?.dataDate ?? null, today) === friday);
  if (!pending.length) return run;
  const sent = await db
    .select({ projectId: notifications.projectId })
    .from(notifications)
    .where(and(eq(notifications.title, DATA_DATE_PROPOSAL_TITLE), sql`${notifications.targetParams}->>'dataDate' = ${friday}`));
  const already = new Set(sent.map((s) => s.projectId));
  for (const p of pending) {
    const h = headOf.get(p.code)!;
    if (already.has(h.id)) {
      run.alreadyProposed++;
      continue;
    }
    let to: string[] = [];
    try {
      to = p.pmPersonId ? await notifyPersonIds(dataDateProposalNotice(p.code, friday), [p.pmPersonId], null) : [];
    } catch (e) {
      logError('runFridayFreeze', e, { projectCode: p.code });
    }
    if (to.length) run.proposed++;
    else run.unaddressed++;
  }
  return run;
}
