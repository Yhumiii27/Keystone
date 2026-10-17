// R-121 (owner's decision D-4 'a' ★ "Notification et proposition de risque"): automatic actions on a client prerequisite still
// unconfirmed at J-15 of its need date — the same rule as the Site screen's red date (`isPrerequisiteLate`).
//
// - A daily job (`site-prerequisite-alerts`, src/server/jobs) notifies the project's PM of record once per lateness episode and
//   links to the prerequisite on the Site screen.
// - The proposal is the existing "New risk" form, pre-filled from the prerequisite (`prerequisiteRiskDraft`), which a lead of the
//   project confirms (or corrects) from the prerequisite's row: no new risk status, nothing is registered without that click.
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

/** "Raise as a risk" is offered: the prerequisite is late at `today` and no risk was raised from it yet. */
export const canRaisePrerequisiteRisk = (p: { status: ConfirmStatus; neededBy: string; riskNumber: string | null }, today: string) =>
  isPrerequisiteLate(p, today) && !p.riskNumber;

/** Category proposed for the risk (the client owes the prerequisite); falls back to the first category offered when inactive. */
export const PREREQUISITE_RISK_CATEGORY = 'contractual_client';
/** Response proposed: mitigate (chase the client, re-plan the activity). */
export const PREREQUISITE_RISK_RESPONSE = 'mitigate';

/** English source strings of the proposal (translated by the caller's `t`). */
export const PREREQUISITE_RISK_TITLE_PREFIX = 'Late client prerequisite';
export const PREREQUISITE_RISK_CAUSE = 'Client prerequisite not confirmed 15 days before its need date';

/**
 * The "New risk" form values proposed for a late prerequisite (field ids of `riskFormDef`): title "Late client prerequisite —
 * {title}", category Contractual / client (else the first offered), owner the PM of record when they are on the owner list (else
 * the form's first option), response Mitigate; P and I keep the form's defaults (3), the cost and the plan are left to the PM.
 * `t` translates Keystone's own words; the prerequisite's title stays as typed.
 */
export function prerequisiteRiskDraft(
  p: { title: string },
  ctx: { pmName: string | null; owners: readonly string[]; categories: readonly string[] },
  t: (english: string) => string,
): Record<string, string> {
  const cat = ctx.categories.includes(PREREQUISITE_RISK_CATEGORY) ? PREREQUISITE_RISK_CATEGORY : (ctx.categories[0] ?? PREREQUISITE_RISK_CATEGORY);
  const owner = ctx.pmName && ctx.owners.includes(ctx.pmName) ? ctx.pmName : (ctx.owners[0] ?? '');
  return { title: `${t(PREREQUISITE_RISK_TITLE_PREFIX)} — ${p.title}`, cat, owner, resp: PREREQUISITE_RISK_RESPONSE };
}

/**
 * The risk's trigger (its cause, stored with the risk): "{cause} · {prerequisite} · {activity} · {need date text}". Built in the
 * language of the lead who raises it (typed data from then on, like any trigger).
 */
export const prerequisiteRiskTrigger = (p: { title: string; activityCode: string }, neededText: string, t: (english: string) => string) =>
  [t(PREREQUISITE_RISK_CAUSE), p.title, p.activityCode, neededText].join(' · ');

// ── Messages (English source, translated by the feature) ────────────────────────────────────────────
export const PREREQ_RISK_LEADS_ONLY = 'Only the project’s leads raise a risk from a client prerequisite';
export const PREREQ_RISK_NOT_LATE = 'This prerequisite is not late any more';
export const PREREQ_RISK_RAISED = 'A risk was already raised from this prerequisite';
