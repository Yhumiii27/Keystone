import 'server-only';
// R-015 (X-6a « les événements clés, aux personnes concernées ») — the key events delivery 8 left without a notice, addressed to
// persons (their active user accounts), never to a whole role, the actor never told:
// - SAT planned → the client contacts of the project (the SAT invitation, R-036: e-mailed at once like every client notice);
// - deliverable submitted to the client → the client contacts (the acceptance awaits them); the client's decision → the
//   deliverable's R (RACI) and the project's leads;
// - inspection (ITP) failed → the project's leads and its quality / engineering referents (the NCR itself is reported in Vigie);
// - indicator alert (R-130 rules) → the project's leads and the directors (pool and approvals alerts: the directors), once per
//   alert while it lasts (job "indicator-alerts").
// Client notices respect the decision of 25 Oct 2026 (R-190): a group subsidiary (internal client) follows its projects in the
// CAPEX application, so its contacts receive nothing from Keystone; the portal and its notices are for external clients only.
// Sent after the writer's transaction committed, best effort (a failure is logged, never undoes the write). Titles are fixed
// English templates the bell translates (t()); typed text stays in the sub-line (fieldsText, R-148).
import { and, arrayOverlaps, eq, inArray, like, or } from 'drizzle-orm';
import type { PortfolioAlert } from '@/domain/portfolio-alerts';
import { sendKeyText } from '@/domain/reminders';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { displayOfIso } from '@/server/db/codes';
import { clients, deliverableRaci, deliverables, persons, projects, reminderSends, users } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { logError } from '@/server/log';
import { notifyPersonIds, personIdsWithRoles, projectLeadIds, projectReferentIds } from './person-notices';

type Q = DB | Tx;

/** Fixed EN titles (FR in src/i18n/extra/d9-notification-mail.json; the reference after " · " stays as is). */
export const EVENT_NOTICE = {
  sat: 'SAT invitation',
  deliverableToAccept: (n: string) => `Deliverable to accept · ${n}`,
  deliverableAccepted: (n: string) => `Deliverable accepted by the client · ${n}`,
  deliverableRejected: (n: string) => `Deliverable rejected by the client · ${n}`,
  inspectionFailed: (n: string) => `Inspection failed · ${n}`,
} as const;

/**
 * The client contacts to notify on a project: active accounts holding the client role of the project's client organisation
 * (the account's or the person's organisation). None when the client is a group subsidiary (internal client, R-190) or the
 * project has no client.
 */
export async function clientContactIds(q: Q, projectCode: string): Promise<string[]> {
  const [p] = await q.select({ clientId: projects.clientId, internal: clients.isInternal }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.code, projectCode));
  if (!p?.clientId || p.internal) return [];
  const rows = await q.select({ id: users.personId }).from(users).innerJoin(persons, eq(persons.id, users.personId))
    .where(and(eq(users.active, true), arrayOverlaps(users.roles, ['client']), or(eq(users.clientId, p.clientId), eq(persons.clientId, p.clientId))));
  return [...new Set(rows.map((r) => r.id))];
}

async function safely(where: string, run: () => Promise<string[]>, fields: Record<string, unknown>): Promise<string[]> {
  try {
    return await run();
  } catch (e) {
    logError(where, e, fields);
    return [];
  }
}

/** "Plan SAT": the invitation to the project's client contacts (portal). Returns the persons notified. */
export async function notifySatPlanned(
  projectCode: string, sat: { system: string; date: string; witnesses?: string | null }, actorPersonId: string | null,
): Promise<string[]> {
  return safely('notifySatPlanned', async () => {
    const db = await getDb();
    const to = await clientContactIds(db, projectCode);
    const sub = [sat.system, displayOfIso(sat.date), sat.witnesses?.trim() || null].filter(Boolean).join(' · ');
    return notifyPersonIds({ kind: 'request', title: EVENT_NOTICE.sat, sub, screen: 'client', params: {}, projectCode }, to, actorPersonId);
  }, { projectCode });
}

/** "Submit to client": the client contacts are asked to accept (My approvals / Quality's register). */
export async function notifyDeliverableSubmitted(projectCode: string, d: { number: string; title: string }, actorPersonId: string | null): Promise<string[]> {
  return safely('notifyDeliverableSubmitted', async () => {
    const db = await getDb();
    const to = await clientContactIds(db, projectCode);
    return notifyPersonIds(
      { kind: 'approval', title: EVENT_NOTICE.deliverableToAccept(d.number), sub: d.title, screen: 'quality', params: { qTab: 'dlv', dlv: d.number }, projectCode },
      to, actorPersonId,
    );
  }, { projectCode, number: d.number });
}

/** The client's acceptance or rejection: the deliverable's R (RACI) and the project's leads. */
export async function notifyDeliverableDecided(
  projectCode: string, d: { number: string; title: string }, decision: 'accepted' | 'rejected', actorPersonId: string | null,
): Promise<string[]> {
  return safely('notifyDeliverableDecided', async () => {
    const db = await getDb();
    const r = await db.select({ id: deliverableRaci.personId }).from(deliverableRaci).innerJoin(deliverables, eq(deliverables.id, deliverableRaci.deliverableId))
      .innerJoin(projects, eq(projects.id, deliverables.projectId))
      .where(and(eq(projects.code, projectCode), eq(deliverables.number, d.number), eq(deliverableRaci.role, 'R')));
    const to = [...r.map((x) => x.id).filter((x): x is string => !!x), ...(await projectLeadIds(db, projectCode))];
    const accepted = decision === 'accepted';
    return notifyPersonIds({
      kind: accepted ? 'approval' : 'quality', title: accepted ? EVENT_NOTICE.deliverableAccepted(d.number) : EVENT_NOTICE.deliverableRejected(d.number), sub: d.title,
      screen: 'quality', params: { qTab: 'dlv', dlv: d.number }, projectCode,
    }, to, actorPersonId);
  }, { projectCode, number: d.number });
}

/** An inspection recorded Failed: the project's leads and its quality / engineering referents. */
export async function notifyInspectionFailed(
  projectCode: string, i: { number: string; name: string; comment?: string | null }, actorPersonId: string | null,
): Promise<string[]> {
  return safely('notifyInspectionFailed', async () => {
    const db = await getDb();
    const [leads, referents] = await Promise.all([projectLeadIds(db, projectCode), projectReferentIds(db, projectCode, ['quality', 'englead'])]);
    const sub = [i.name, i.comment?.trim() || null].filter(Boolean).join(' · ');
    return notifyPersonIds(
      { kind: 'quality', title: EVENT_NOTICE.inspectionFailed(i.number), sub, screen: 'itp', params: {}, projectCode }, [...leads, ...referents], actorPersonId,
    );
  }, { projectCode, number: i.number });
}

// ── Indicator alerts (R-130 rules → notices) ─────────────────────────────────────────────────────────────────────────

/** EN label of each alert rule (the notice's title: "Indicator alert · Off track"). */
export const ALERT_KIND_TITLE: Record<PortfolioAlert['kind'], string> = {
  off_track: 'Indicator alert · Off track',
  critical_slip: 'Indicator alert · Critical path slip',
  cost_overrun: 'Indicator alert · Cost overrun',
  billing_late: 'Indicator alert · Billing late',
  over_allocation: 'Indicator alert · Over-allocation',
  approvals_waiting: 'Indicator alert · Approvals waiting',
  milestone_late: 'Indicator alert · Late milestone',
  risk_forecast: 'Indicator alert · Low chance of meeting the end date',
};

/** The send-log key of an alert while it lasts; a cleared alert's rows are renamed `cleared:<date>` so it can be raised again. */
const ALERT_SLOT = 'raised';
const ALERT_OPEN = 'open';
const alertItemKey = (a: Pick<PortfolioAlert, 'key'>) => `alert:${a.key}`;

export interface IndicatorAlertRun {
  today: string;
  /** Alerts the rules give today. */
  alerts: number;
  /** Alerts new for at least one recipient. */
  raised: number;
  /** Persons notified (one notice per person and alert). */
  notified: number;
  /** Alerts that were open and are gone (they may be raised again). */
  cleared: number;
}

/**
 * The indicator alerts (job "indicator-alerts", at the reminders hour): the portfolio alert rules at the business date (`on`:
 * tests), in French; each alert told once to each of its recipients while it lasts (`reminder_sends`, kind "alert"), again if it clears
 * and comes back. Internal recipients only (the alerts carry costs and margins).
 */
export async function runIndicatorAlerts(on?: string): Promise<IndicatorAlertRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const { getPortfolioAlerts } = await import('./portfolio-alerts');
  const { claimSends } = await import('./reminders');
  // In French, the default language (the sub-line is shown as computed, like the e-mails).
  const alerts = await getPortfolioAlerts('fr', today);
  const run: IndicatorAlertRun = { today, alerts: alerts.length, raised: 0, notified: 0, cleared: 0 };
  // Alerts that cleared: their open rows are renamed, so the alert is told again when it comes back.
  const live = new Set(alerts.map(alertItemKey));
  const open = await db.selectDistinct({ itemKey: reminderSends.itemKey }).from(reminderSends)
    .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, ALERT_OPEN), like(reminderSends.itemKey, 'alert:%')));
  const gone = open.map((o) => o.itemKey).filter((k) => !live.has(k));
  if (gone.length) {
    await db.update(reminderSends).set({ occurrence: `cleared:${today}` })
      .where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.occurrence, ALERT_OPEN), inArray(reminderSends.itemKey, gone)));
    run.cleared = gone.length;
  }
  if (!alerts.length) return run;
  const directors = await personIdsWithRoles(db, ['director']);
  const internal = new Set((await db.select({ p: users.personId, roles: users.roles }).from(users).where(eq(users.active, true)))
    .filter((u) => u.roles.some((r) => r !== 'client')).map((u) => u.p));
  for (const a of alerts) {
    try {
      const leads = a.code ? await projectLeadIds(db, a.code) : [];
      const to = [...new Set([...leads, ...directors])].filter((id) => internal.has(id));
      if (!to.length) continue;
      const got = await claimSends(to.map((personId) => ({ personId, itemKey: alertItemKey(a), slot: ALERT_SLOT, occurrence: ALERT_OPEN })), 'alert', today);
      const fresh = to.filter((personId) => got.has(sendKeyText({ personId, itemKey: alertItemKey(a), slot: ALERT_SLOT, occurrence: ALERT_OPEN })));
      if (!fresh.length) continue;
      run.raised++;
      // The sub-line: the rule's own title, as computed (the bell shows it as typed; the e-mail and the screen give the detail).
      const sent = await notifyPersonIds({
        kind: 'alert', title: ALERT_KIND_TITLE[a.kind], sub: a.code ? `${a.code} · ${a.title}` : a.title, screen: a.target.screen, params: {},
        projectCode: a.target.code ?? a.code ?? null,
      }, fresh, null);
      run.notified += sent.length;
    } catch (e) {
      logError('runIndicatorAlerts', e, { alert: a.key });
    }
  }
  return run;
}
