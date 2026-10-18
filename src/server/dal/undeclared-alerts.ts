import 'server-only';
// R-084 (owner answer 17 Oct 2026, third round, B: « si pas de déclaration du tout alors il faut faire une alerte »): an activity
// that needs work (not a milestone, not complete) and declares no resource at all — no assignment, no owner — puts its load
// nowhere. The daily job `undeclared-resource-alerts` (morning reminders, src/domain/jobs.ts) sends the PM of record of its
// project ONE bell notice per activity, linking to it on the Plan (`?act=`); Project resources lists them in a card meanwhile.
// Deduplication without a migration: an activity already alerted is one with a notice of this title on its project for its
// code (`notifications.target_params.sel`); the job runs under its lease (one worker at a time), so the check and the notice
// are not raced. A PM without an active account receives nothing: counted "without recipient", tried again the next morning.
import { and, eq, sql } from 'drizzle-orm';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { notifications, projects } from '@/server/db/schema';
import { logError } from '@/server/log';
import { notifyPersonIds } from './person-notices';
import { listUndeclaredActivities, type UndeclaredActivity } from './planning-load';

/** Fixed English title of the notice (translated by the bell). */
export const UNDECLARED_ALERT_TITLE = 'Activity without a declared resource';

/** The bell notice: activity code · name as typed; opens the activity on the Plan. */
export const undeclaredAlertNotice = (a: UndeclaredActivity) => ({
  kind: 'alert' as const,
  title: UNDECLARED_ALERT_TITLE,
  sub: `${a.code} · ${a.name}`,
  screen: 'plan',
  params: { sel: a.code },
  projectCode: a.projectCode,
});

export interface UndeclaredAlertRun {
  today: string;
  /** Activities without any declared resource. */
  undeclared: number;
  /** Notices sent by this run. */
  alerted: number;
  /** Already alerted before (not sent again). */
  already: number;
  /** Nobody could receive the notice (no PM of record, no active account). */
  unaddressed: number;
}

/** One run of the daily job. Idempotent: an activity is alerted once; a second run alerts nothing more. */
export async function alertUndeclaredActivities(on?: string): Promise<UndeclaredAlertRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const rows = await listUndeclaredActivities();
  const run: UndeclaredAlertRun = { today, undeclared: rows.length, alerted: 0, already: 0, unaddressed: 0 };
  if (!rows.length) return run;
  const [sent, pms] = await Promise.all([
    db
      .select({ code: projects.code, act: sql<string>`${notifications.targetParams}->>'sel'` })
      .from(notifications)
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .where(and(eq(notifications.title, UNDECLARED_ALERT_TITLE), eq(notifications.targetScreen, 'plan'))),
    db.select({ code: projects.code, pm: projects.pmPersonId }).from(projects),
  ]);
  const done = new Set(sent.map((s) => `${s.code}|${s.act}`));
  const pmOf = new Map(pms.map((p) => [p.code, p.pm]));
  for (const a of rows) {
    if (done.has(`${a.projectCode}|${a.code}`)) {
      run.already++;
      continue;
    }
    const pm = pmOf.get(a.projectCode);
    let to: string[] = [];
    try {
      to = pm ? await notifyPersonIds(undeclaredAlertNotice(a), [pm], null) : [];
    } catch (e) {
      logError('alertUndeclaredActivities', e, { projectCode: a.projectCode, activity: a.code });
    }
    if (to.length) run.alerted++;
    else run.unaddressed++;
  }
  return run;
}
