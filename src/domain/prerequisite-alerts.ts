// R-121 (owner's decision D-4 'a' ★ "Notification et proposition de risque"): automatic actions on a client prerequisite still
// unconfirmed at J-15 of its need date — the same rule as the Site screen's red date (`isPrerequisiteLate`).
//
// - A daily job (`site-prerequisite-alerts`, src/server/jobs; every morning at the reminders hour, 07:00 Paris by default — owner,
//   17 Oct 2026) notifies the project's PM of record only (owner, 17 Oct 2026) once per lateness episode and links to the
//   prerequisite on the Site screen.
// - The proposal is the existing "New risk" form, pre-filled from the prerequisite (`prerequisiteRiskDraft`), which a lead of the
//   project confirms (or corrects) from the prerequisite's row: no new risk status, nothing is registered without that click.
//   Offered on every pending prerequisite without a risk, before J-15 too (owner, 17 Oct 2026, second round); once late at J-15,
//   also when a risk was already raised — a new risk, the notice going out all the same (owner, 17 Oct 2026, third round).
//
// Episode (default, owner to confirm): a prerequisite is alerted once for a given need date. A prerequisite only moves forward
// (Pending → Confirmed → Signed), so it cannot become late again after a confirmation; it is alerted again only when its need date
// is changed while it is still pending and it becomes late at the new date (a new line at the same position is a new record).
import type { ConfirmStatus, StageCode } from '@/server/db/codes';
import { isPrerequisiteLate } from './site';
import { siteSheetOpen } from './site-sheet';

export interface PrerequisiteAlertFacts {
  status: ConfirmStatus;
  /** ISO need date. */
  neededBy: string;
  /** Need date the prerequisite was last alerted for (null = never alerted). */
  alertedNeededBy: string | null;
}

/** The prerequisite is late at `today` and has not been alerted for its current need date. */
export const prerequisiteNeedsAlert = (p: PrerequisiteAlertFacts, today: string) => isPrerequisiteLate(p, today) && p.alertedNeededBy !== p.neededBy;

/**
 * The prerequisites the daily job alerts at `today` (the business date): late, not alerted for their need date, on a project
 * whose site sheet is still open (Études … Mise en service & SAT — not at Garantie, Clos, Annulé).
 */
export function prerequisitesToAlert<P extends PrerequisiteAlertFacts & { stage: StageCode }>(rows: readonly P[], today: string): P[] {
  return rows.filter((p) => siteSheetOpen(p.stage) && prerequisiteNeedsAlert(p, today));
}

/** The bell notice's title (fixed English template, translated by the bell). */
export const PREREQUISITE_ALERT_TITLE = 'Client prerequisite unconfirmed at J-15 — raise a risk?';

/**
 * "Raise as a risk" is offered while the prerequisite is pending (not confirmed, not signed) — late or not (owner, 17 Oct 2026,
 * second round: « Risque avant J-15 : oui on peut l'ouvrir ») — and either no risk was raised from it yet, or it is late at J-15
 * (`late`, `isPrerequisiteLate` at the business date) although a risk was raised: the owner, 17 Oct 2026, third round: « Si l'alerte
 * a déjà un risque ouvert [il faut quand même alerter] car c'est soit que le risque n'a pas été maîtrisé, soit qu'il faudra en
 * ouvrir un nouveau ». Before J-15 a prerequisite carries one risk (the row links to it, no second one); once late, a lead may
 * raise a new one ("Raise a new risk"), which becomes the prerequisite's linked risk (the previous one stays in the register).
 */
export const canRaisePrerequisiteRisk = (p: { status: ConfirmStatus; riskNumber: string | null; late: boolean }) =>
  prerequisiteRiskRefusal(p) === null;

/** Why "Raise as a risk" is refused (English source string), or null when allowed — the rule of `canRaisePrerequisiteRisk`. */
export function prerequisiteRiskRefusal(p: { status: ConfirmStatus; riskNumber: string | null; late: boolean }): string | null {
  if (p.status !== 'pending') return PREREQ_RISK_NOT_PENDING;
  if (p.riskNumber && !p.late) return PREREQ_RISK_RAISED;
  return null;
}

/**
 * The J-15 notice's sub-line: "{prerequisite} · {activity} · {need date}", and when a risk is already linked to the prerequisite
 * (raised before J-15, or at an earlier J-15) "· R-21 · linked risk open" (or "closed") — the notice still goes out (owner, 17 Oct
 * 2026, third round) and tells the PM that the risk did not prevent the delay. Each " · " field is shown by the bell as typed, or
 * through its exact FR entry (`fieldsText`).
 */
export const PREREQUISITE_ALERT_RISK_OPEN = 'linked risk open';
export const PREREQUISITE_ALERT_RISK_CLOSED = 'linked risk closed';
export const prerequisiteAlertSub = (
  p: { title: string; activityCode: string; risk: { number: string; status: 'open' | 'closed' } | null },
  neededText: string,
) =>
  [p.title, p.activityCode, neededText, ...(p.risk ? [p.risk.number, p.risk.status === 'open' ? PREREQUISITE_ALERT_RISK_OPEN : PREREQUISITE_ALERT_RISK_CLOSED] : [])].join(' · ');

/** Category proposed for the risk (the client owes the prerequisite); falls back to the first category offered when inactive. */
export const PREREQUISITE_RISK_CATEGORY = 'contractual_client';
/** Response proposed: mitigate (chase the client, re-plan the activity). */
export const PREREQUISITE_RISK_RESPONSE = 'mitigate';

/** English source strings of the proposal (translated by the caller's `t`): late at J-15, or still pending before J-15. */
export const PREREQUISITE_RISK_TITLE_PREFIX = 'Late client prerequisite';
export const PREREQUISITE_RISK_TITLE_PREFIX_PENDING = 'Client prerequisite at risk';
export const PREREQUISITE_RISK_CAUSE = 'Client prerequisite not confirmed 15 days before its need date';
export const PREREQUISITE_RISK_CAUSE_PENDING = 'Client prerequisite not confirmed yet';

/**
 * The "New risk" form values proposed for a pending prerequisite (field ids of `riskFormDef`): title "Late client prerequisite —
 * {title}" when it is late at J-15 (`late`, `isPrerequisiteLate` at the business date), else "Client prerequisite at risk —
 * {title}", category Contractual / client (else the first offered), owner the PM of record when they are on the owner list (they
 * are since the owner's answer of 17 Oct 2026, `riskOwnersWithPm`; else the form's first option), response Mitigate; P and I keep the form's defaults (3), the cost and the plan are left to the PM.
 * `t` translates Keystone's own words; the prerequisite's title stays as typed.
 */
export function prerequisiteRiskDraft(
  p: { title: string; late: boolean },
  ctx: { pmName: string | null; owners: readonly string[]; categories: readonly string[] },
  t: (english: string) => string,
): Record<string, string> {
  const cat = ctx.categories.includes(PREREQUISITE_RISK_CATEGORY) ? PREREQUISITE_RISK_CATEGORY : (ctx.categories[0] ?? PREREQUISITE_RISK_CATEGORY);
  const owner = ctx.pmName && ctx.owners.includes(ctx.pmName) ? ctx.pmName : (ctx.owners[0] ?? '');
  const prefix = p.late ? PREREQUISITE_RISK_TITLE_PREFIX : PREREQUISITE_RISK_TITLE_PREFIX_PENDING;
  return { title: `${t(prefix)} — ${p.title}`, cat, owner, resp: PREREQUISITE_RISK_RESPONSE };
}

/**
 * The risk's trigger (its cause, stored with the risk): "{cause} · {prerequisite} · {activity} · {need date text}" — the cause
 * "not confirmed 15 days before its need date" when late, "not confirmed yet" before J-15. Built in the language of the lead who
 * raises it (typed data from then on, like any trigger).
 */
export const prerequisiteRiskTrigger = (p: { title: string; activityCode: string; late: boolean }, neededText: string, t: (english: string) => string) =>
  [t(p.late ? PREREQUISITE_RISK_CAUSE : PREREQUISITE_RISK_CAUSE_PENDING), p.title, p.activityCode, neededText].join(' · ');

// ── Messages (English source, translated by the feature) ────────────────────────────────────────────
export const PREREQ_RISK_LEADS_ONLY = 'Only the project’s leads raise a risk from a client prerequisite';
export const PREREQ_RISK_NOT_PENDING = 'This prerequisite is not pending any more';
export const PREREQ_RISK_RAISED = 'A risk was already raised from this prerequisite';
