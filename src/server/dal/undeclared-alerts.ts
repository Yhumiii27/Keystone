import 'server-only';
// Morning alerts on activities nobody is assigned to — one daily job, `undeclared-resource-alerts` (morning reminders,
// src/domain/jobs.ts), two distinct notices to the PM of record of the activity's project, each once per activity, linking to it
// on the Plan (`?act=`); Project resources lists both kinds in cards meanwhile.
// - R-084 (owner answer 17 Oct 2026, third round, B: « si pas de déclaration du tout alors il faut faire une alerte »): an activity
//   that needs work (not a milestone, not complete) and declares no resource at all — no assignment, no owner — whatever its
//   dates: "Activity without a declared resource".
// - Owner answer 18 Oct 2026, fourth round (« à 15 jours d'une activité sans affectation préviens le chef de projet »): an activity
//   that needs work, has an owner but no labour assignment (owner only, equipment / material only) and starts within 15 days of
//   the business date — or has already started — "Activity without an assignment at J-15" (rule `unassignedActivitiesAt`).
// Deduplication without a migration: an activity already alerted is one with a notice of that title on its project for its code
// (`notifications.target_params.sel`); the job runs under its lease (one worker at a time), so the check and the notice are not
// raced. Once per activity: not again if it loses its assignment after having one. A PM without an active account receives
// nothing: counted "without recipient", tried again the next morning.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { shortDateOfIso } from '@/server/db/codes';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { notifications, projects } from '@/server/db/schema';
import { logError } from '@/server/log';
import { notifyPersonIds } from './person-notices';
import { listUnassignedActivities, listUndeclaredActivities, type UndeclaredActivity } from './planning-load';

/** Fixed English titles of the notices (translated by the bell). */
export const UNDECLARED_ALERT_TITLE = 'Activity without a declared resource';
export const UNASSIGNED_ALERT_TITLE = 'Activity without an assignment at J-15';

/** The bell notice of an undeclared activity: activity code · name as typed; opens the activity on the Plan. */
export const undeclaredAlertNotice = (a: UndeclaredActivity) => ({
  kind: 'alert' as const,
  title: UNDECLARED_ALERT_TITLE,
  sub: `${a.code} · ${a.name}`,
  screen: 'plan',
  params: { sel: a.code },
  projectCode: a.projectCode,
});

/** The J-15 notice: activity code · name as typed · its start ("5 Oct"); opens the activity on the Plan. */
export const unassignedAlertNotice = (a: UndeclaredActivity) => ({
  kind: 'alert' as const,
  title: UNASSIGNED_ALERT_TITLE,
  sub: [a.code, a.name, ...(a.start ? [shortDateOfIso(a.start)] : [])].join(' · '),
  screen: 'plan',
  params: { sel: a.code },
  projectCode: a.projectCode,
});

export interface UndeclaredAlertRun {
  today: string;
  /** Activities without any declared resource. */
  undeclared: number;
  /** Activities with an owner but no assignment, starting within 15 days (or started). */
  unassigned: number;
  /** Notices sent by this run (both kinds). */
  alerted: number;
  /** Already alerted before (not sent again). */
  already: number;
  /** Nobody could receive the notice (no PM of record, no active account). */
  unaddressed: number;
}

/** One run of the daily job at the business date (`on`, tests). Idempotent: an activity is alerted once per kind of notice. */
export async function alertUndeclaredActivities(on?: string): Promise<UndeclaredAlertRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const [undeclared, unassigned] = await Promise.all([listUndeclaredActivities(), listUnassignedActivities(today)]);
  const run: UndeclaredAlertRun = { today, undeclared: undeclared.length, unassigned: unassigned.length, alerted: 0, already: 0, unaddressed: 0 };
  if (!undeclared.length && !unassigned.length) return run;
  const [sent, pms] = await Promise.all([
    db
      .select({ title: notifications.title, code: projects.code, act: sql<string>`${notifications.targetParams}->>'sel'` })
      .from(notifications)
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .where(and(inArray(notifications.title, [UNDECLARED_ALERT_TITLE, UNASSIGNED_ALERT_TITLE]), eq(notifications.targetScreen, 'plan'))),
    db.select({ code: projects.code, pm: projects.pmPersonId }).from(projects),
  ]);
  const done = new Set(sent.map((s) => `${s.title}|${s.code}|${s.act}`));
  const pmOf = new Map(pms.map((p) => [p.code, p.pm]));
  const alert = async (a: UndeclaredActivity, notice: ReturnType<typeof undeclaredAlertNotice>) => {
    if (done.has(`${notice.title}|${a.projectCode}|${a.code}`)) {
      run.already++;
      return;
    }
    const pm = pmOf.get(a.projectCode);
    let to: string[] = [];
    try {
      to = pm ? await notifyPersonIds(notice, [pm], null) : [];
    } catch (e) {
      logError('alertUndeclaredActivities', e, { projectCode: a.projectCode, activity: a.code });
    }
    if (to.length) run.alerted++;
    else run.unaddressed++;
  };
  for (const a of undeclared) await alert(a, undeclaredAlertNotice(a));
  for (const a of unassigned) await alert(a, unassignedAlertNotice(a));
  return run;
}
