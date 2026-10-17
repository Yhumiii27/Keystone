// R-084 test fixture (not a test file): the demo data set names one person on a schedule — Julien Wagner on HLT-026 A1250,
// 40 h a week until Fri 9 Oct 2026 — so, with the load drawn from the schedules (owner answer 17 Oct 2026, third round), nobody
// is above 100 % and the what-if derives no relief lever. The what-if flow tests (relief lever, "Protect people" auto-level,
// requests drafted from it) put Julien Wagner on a second assignment elsewhere: an NDC-031 activity "TST-LOAD" from Mon 28 Sep
// to Fri 16 Oct 2026 at 1 × 4 h/d → +20 h a week, i.e. 150 % in the weeks of 28 Sep and 5 Oct (60 h / 40 h), 50 % in the
// week of 12 Oct. HLT-026's own plan (its network) is unchanged.
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { activities, activityAssignments, persons, projects } from '@/server/db/schema';

export const OVERLOAD_ACTIVITY = 'TST-LOAD';

/** The default window and rate above; a test may put the extra hours elsewhere (another code, dates, hours per day). */
export async function overloadJulienWagner(at: { code?: string; from?: string; to?: string; hoursPerDay?: number } = {}): Promise<void> {
  const { code = OVERLOAD_ACTIVITY, from = '2026-09-28', to = '2026-10-16', hoursPerDay = 4 } = at;
  const db = await getDb();
  const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
  const [ndc] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
  const [{ id: _source, ...copy }] = await db.select().from(activities).where(eq(activities.projectId, ndc.id)).limit(1);
  void _source;
  const [added] = await db
    .insert(activities)
    .values({ ...copy, code, position: 9998, startDate: from, finishDate: to, calendarCode: null, percentComplete: 0, durationDays: 15 })
    .returning({ id: activities.id });
  await db.insert(activityAssignments).values({
    activityId: added.id, position: 0, resource: 'Julien Wagner', personId: julien.id, detail: '', units: `1 × ${hoursPerDay} h/d`, progressText: '', resourceCount: 1, hoursPerDay,
  });
}
