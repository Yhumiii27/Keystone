import 'server-only';
// R-121 (owner's decision D-4 'a' ★ "Notification et proposition de risque"): client prerequisites still unconfirmed at J-15.
// - `alertLatePrerequisites` (daily job `site-prerequisite-alerts`): every prerequisite late at the business date and not yet
//   alerted for its need date is claimed (alerted_needed_by, a conditional update — two workers never alert it twice), then its
//   project's PM of record gets a bell notice linking to the prerequisite on the Site screen (sent after the claim commits;
//   a PM without an active account is counted, nobody else is told).
// - `raisePrerequisiteRisk` ("Raise as a risk" on the row of any pending prerequisite, late or not — owner, 17 Oct 2026, second
//   round; "Raise a new risk" on a late one that already has a risk — third round): the existing "New risk" values, confirmed by a lead
//   of the project, registered with the prerequisite's activity and its cause as trigger, linked to the prerequisite; audit
//   rows (risk created, prerequisite) and an activity line. Rules: src/domain/prerequisite-alerts.ts.
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import {
  PREREQUISITE_ALERT_TITLE, PREREQ_RISK_LEADS_ONLY, prerequisiteAlertSub, prerequisiteRiskRefusal, prerequisitesToAlert,
} from '@/domain/prerequisite-alerts';
import { isPrerequisiteLate } from '@/domain/site';
import { SITE_LINE_CHANGED, prerequisiteStamp } from '@/domain/site-sheet';
import { systemMessage } from '@/domain/system-messages';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { shortDateOfIso } from '@/server/db/codes';
import { projects, risks, sitePrerequisites } from '@/server/db/schema';
import { logError } from '@/server/log';
import { managesProject, projectOf, trace, whoIs, type Actor } from './ops-common';
import { notifyPersonIds } from './person-notices';
import { createRisk, type NewRiskInput } from './risks';

export interface PrerequisiteAlertRun {
  /** Business date of the run. */
  today: string;
  /** Pending prerequisites looked at. */
  pending: number;
  /** Prerequisites alerted by this run (claimed). */
  alerted: number;
  /** Alerts whose PM of record received the notice. */
  notified: number;
  /** Alerts nobody received (no PM of record, or no active account). */
  unaddressed: number;
}

/**
 * The bell notice of a late prerequisite: fixed English title; the prerequisite as typed · its activity · its need date, and its
 * linked risk with its status when one was raised already (owner, 17 Oct 2026, third round: the notice still goes out).
 */
export const prerequisiteAlertNotice = (
  p: { title: string; activityCode: string; neededBy: string; position: number; risk: { number: string; status: 'open' | 'closed' } | null },
  projectCode: string,
) => ({
  kind: 'alert' as const,
  title: PREREQUISITE_ALERT_TITLE,
  sub: prerequisiteAlertSub(p, shortDateOfIso(p.neededBy)),
  // `?prereq=` marks the row on the Site screen (Readiness & go) and opens "Raise as a risk" for a lead.
  screen: 'site',
  params: { prereq: p.position },
  projectCode,
});

/**
 * One run of the daily job at the business date (`on`, tests). Idempotent: a prerequisite is alerted once per need date; a second
 * run the same day (or a racing worker) alerts nothing.
 */
export async function alertLatePrerequisites(on?: string): Promise<PrerequisiteAlertRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const rows = await db
    .select({
      id: sitePrerequisites.id, title: sitePrerequisites.title, activityCode: sitePrerequisites.activityCode, neededBy: sitePrerequisites.neededBy,
      status: sitePrerequisites.status, position: sitePrerequisites.position, alertedNeededBy: sitePrerequisites.alertedNeededBy,
      code: projects.code, stage: projects.stage, pm: projects.pmPersonId, riskNumber: risks.number, riskStatus: risks.status,
    })
    .from(sitePrerequisites)
    .innerJoin(projects, eq(projects.id, sitePrerequisites.projectId))
    // A linked risk does not stop the alert (owner, 17 Oct 2026, third round): the notice names it.
    .leftJoin(risks, eq(risks.id, sitePrerequisites.riskId))
    .where(eq(sitePrerequisites.status, 'pending'));
  const due = prerequisitesToAlert(rows, today);
  const run: PrerequisiteAlertRun = { today, pending: rows.length, alerted: 0, notified: 0, unaddressed: 0 };
  for (const p of due) {
    // The claim: only while still pending, at the need date read, and not alerted for it (a racing run claims nothing).
    const claimed = await db
      .update(sitePrerequisites)
      .set({ alertedNeededBy: p.neededBy, alertedAt: new Date() })
      .where(and(
        eq(sitePrerequisites.id, p.id), eq(sitePrerequisites.status, 'pending'), eq(sitePrerequisites.neededBy, p.neededBy),
        or(isNull(sitePrerequisites.alertedNeededBy), ne(sitePrerequisites.alertedNeededBy, p.neededBy)),
      ))
      .returning({ id: sitePrerequisites.id });
    if (!claimed.length) continue;
    run.alerted++;
    let to: string[] = [];
    try {
      const risk = p.riskNumber && p.riskStatus ? { number: p.riskNumber, status: p.riskStatus } : null;
      to = p.pm ? await notifyPersonIds(prerequisiteAlertNotice({ ...p, risk }, p.code), [p.pm], null) : [];
    } catch (e) {
      logError('alertLatePrerequisites', e, { projectCode: p.code, position: p.position });
    }
    if (to.length) run.notified++;
    else run.unaddressed++;
  }
  return run;
}

/** "Raise as a risk": the "New risk" values a lead confirmed (the trigger and the activity come from the prerequisite). */
export type PrerequisiteRiskInput = Omit<NewRiskInput, 'trigger' | 'activityCode'>;

/**
 * Registers the risk proposed for a pending prerequisite (late at J-15 or not yet — owner, 17 Oct 2026, second round), as the
 * page showed the line (`stamp`): a lead of the project only (PM of record, co-PM, deputy, the director — re-checked here), the
 * prerequisite still pending (not confirmed, not signed), and no risk raised from it yet unless it is late at J-15 at the business
 * date (owner, 17 Oct 2026, third round): then the new risk becomes the prerequisite's linked risk, the previous one stays in the
 * register and the audit row names both ("risk raised · R-22 (after R-21)"). Returns the risk's number ("R-21"). Errors:
 * SITE_LINE_CHANGED, PREREQ_RISK_* (English source strings).
 */
export async function raisePrerequisiteRisk(
  projectCode: string, position: number, stamp: string, input: PrerequisiteRiskInput, trigger: string, actor: Actor, on?: string,
): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const today = on ?? (await businessToday(tx));
    const p = await projectOf(tx, projectCode);
    if (!(await managesProject(tx, actor, p))) throw new Error(PREREQ_RISK_LEADS_ONLY);
    const [x] = await tx.select().from(sitePrerequisites).where(and(eq(sitePrerequisites.projectId, p.id), eq(sitePrerequisites.position, position)));
    if (!x) throw new Error(`Unknown prerequisite ${position} on ${projectCode}`);
    if (prerequisiteStamp(x) !== stamp) throw new Error(SITE_LINE_CHANGED);
    // Late at J-15 at the business date, or still pending before J-15: the activity line's wording, and whether a second risk may be raised.
    const late = isPrerequisiteLate(x, today);
    const [prev] = x.riskId ? await tx.select({ number: risks.number }).from(risks).where(eq(risks.id, x.riskId)) : [];
    const refusal = prerequisiteRiskRefusal({ status: x.status, riskNumber: prev?.number ?? null, late });
    if (refusal) throw new Error(refusal);
    const number = await createRisk(projectCode, { ...input, trigger, activityCode: x.activityCode }, actor.name, tx);
    const [r] = await tx.select({ id: risks.id }).from(risks).where(and(eq(risks.projectId, p.id), eq(risks.number, number)));
    // The line's stamp does not read the link: the page's other forms on this line stay valid.
    await tx.update(sitePrerequisites).set({ riskId: r.id }).where(eq(sitePrerequisites.id, x.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Prerequisite · ${x.title}`, change: prev ? `risk raised · ${number} (after ${prev.number})` : `risk raised · ${number}`, area: 'Site',
      entityType: 'site_prerequisite', entityId: x.id, projectId: p.id,
      ...(prev ? { before: { risk: prev.number } } : {}),
      after: { risk: number },
      activity: {
        kind: 'change',
        message: prev
          ? systemMessage('site.prerequisiteRiskRaisedAgain', { risk: number, previous: prev.number, prerequisite: x.title })
          : systemMessage(late ? 'site.prerequisiteRiskRaised' : 'site.pendingPrerequisiteRiskRaised', { risk: number, prerequisite: x.title }),
      },
    });
    return number;
  });
}
