// "Needs attention" of the Portfolio overview and the director's Home, computed by rules (NEW-D1-1 answer a, R-130; A-12, A-15)
// instead of the prototype's four fixed texts. One alert per rule and project, worst first:
//   1. off track — the one health rule (A-13) with the Settings thresholds: min(CPI clamped, SPI) below "Off track below";
//   2. critical-path slip — negative float on the critical path (and the late schedule milestones);
//   3. cost overrun — CPI below the Settings "At risk below" threshold (EAC above budget by more than 1 / threshold − 1);
//   4. billing late — an invoice past its due date, or a payment milestone past its contractual date not invoiced;
//   5. over-allocation — people of the shared pool above 110 % in a week of the window (the Resources rule);
//   6. approvals waiting — decisions in the portfolio director's queue older than N days (default 5);
//   7. late milestone — a schedule milestone flagged Late while the critical path still has float;
//   8. supplier slip (S-30) — a supplier schedule (R-204) whose forecast slips at or above the Settings threshold (S-31, default 5
//      working days; the S-27 bell alerts use the same threshold);
//   9. risk forecast (R-208) — the latest Monte-Carlo run gives a low chance of meeting the end date.
// S-33 (owner, 5 Nov 2026): the list is ordered by urgency and importance (src/domain/alert-priority.ts: a class, then a magnitude),
// no longer by rule; the rule order above is only the tie-break between equal scores. The cap (8) is kept.
// Project alerts follow the zone filter; the pool and approval alerts are portfolio-wide. Thresholds: the health thresholds of
// Settings (A-13); the others have no Settings entry yet (`ALERT_RULE_DEFAULTS`, to confirm with the owner). Pure; texts are
// returned in the render language (data texts — names, dates — come translated by the caller's `t`).
// Golden values: src/domain/portfolio-alerts.test.ts.
import { screenHref, type ScreenId } from '@/config/screens';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { daysBetweenIso, displayOfIso } from '@/server/db/codes';
import { BASE_CURRENCY, moneyIn, type CurrencyCode } from './currency';
import { DEFAULT_HEALTH_THRESHOLDS, clampHealthCpi, type Health, type HealthThresholds } from './health';
import { OVER_ALLOCATED_PCT, weekRangesText } from './resources';
import { ALERT_MAGNITUDE_SCALES as SCALE, alertClass, alertScore, compareAlerts, magnitude } from './alert-priority';
import { SUPPLIER_SLIP_ALERT_DAYS, SUPPLIER_SLIP_ESCALATION_STANDARD } from './supplier-slip-alerts';

export type AlertKind =
  | 'off_track' | 'critical_slip' | 'cost_overrun' | 'billing_late' | 'over_allocation' | 'approvals_waiting' | 'milestone_late' | 'supplier_slip' | 'risk_forecast';
export type AlertIcon = 'lightning' | 'coins' | 'users-three' | 'clock-countdown' | 'receipt' | 'stamp' | 'warning' | 'truck';

/** "Needs attention" item. `target` is the screen opened by the action button. */
export interface PortfolioAlert {
  key: string;
  kind: AlertKind;
  icon: AlertIcon;
  /** Project the alert is about; alerts with a code are hidden when that project is outside the selected zone. */
  code: string | null;
  /** In the render language. */
  title: string;
  detail: string;
  /** English source (translated by the screen). */
  action: string;
  /** `params`: the screen's query (S-30: `?po=` opens the order's drawer). */
  target: { screen: ScreenId; code?: string; params?: Record<string, string> };
}

/** The link of an alert's action button. */
export function alertTargetHref(target: PortfolioAlert['target']): string {
  const href = screenHref(target.screen, { code: target.code });
  const q = new URLSearchParams(target.params ?? {}).toString();
  return q ? `${href}?${q}` : href;
}

/** Thresholds without a Settings entry yet (R-130 defaults, owner to confirm — NEW-D1-1 "seuils dans Paramètres"). */
export const ALERT_RULE_DEFAULTS = {
  /** An approval waiting longer than this many calendar days is an alert. */
  approvalDays: 5,
  /** A person above this weekly load (strict) is over-allocated — the Resources rule. */
  overAllocatedPct: OVER_ALLOCATED_PCT,
  /** At most this many alerts are listed (worst first). */
  maxAlerts: 8,
  /** R-208: a Monte-Carlo chance of meeting the end date below this is an alert — S-25: the default; Settings may change it. */
  onTimeChance: 0.2,
} as const;

export interface AlertThresholds {
  /** Settings › Project health rules (A-13). */
  health: HealthThresholds;
  approvalDays: number;
  overAllocatedPct: number;
  maxAlerts: number;
  /** R-208 (optional for callers built before it): Monte-Carlo chance of meeting the end date under which a project is listed. */
  onTimeChance?: number;
  /** S-30 / S-31 (optional; default 5): supplier schedule slip, working days, from which a project is listed. */
  supplierSlipDays?: number;
  /**
   * S-33 / S-34 (optional; default 5): a supplier slip pushing the project's forecast finish by at least this many working days
   * ranks with the alerts that hit the end date (class 1).
   */
  supplierImpactDays?: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = { health: DEFAULT_HEALTH_THRESHOLDS, ...ALERT_RULE_DEFAULTS };

export interface AlertProject {
  code: string;
  /** Display name, translated ("Harbor Line Terminal Expansion"). */
  name: string;
  health: Health | null;
  budget: number;
  actual: number;
  progress: number;
  spi: number | null;
  /** Schedule header, null without planning data. Dates as display texts, translated. */
  schedule: { floatDays: number; finishText: string; baselineText: string; lateMilestones: string[] } | null;
  /** Billing of the contract (A-5), null without one. Amounts in `currency`. */
  billing: {
    currency: CurrencyCode;
    /** Invoices awaiting payment past their due date (number, amount, ISO due date). */
    overdue: { number: string; amountKeur: number; dueOn: string }[];
    /** Planned billable milestones past their contractual date (number, label translated, ISO date). */
    late: { number: string; label: string; dueOn: string }[];
  } | null;
  /**
   * R-205 / R-208: the project's latest Monte-Carlo risk analysis (stored run, no computation here): chance of meeting the target
   * finish, P80 finish and the target (ISO). Absent or null without a run.
   */
  riskAnalysis?: { probOnTarget: number | null; p80Finish: string; target: string | null } | null;
  /**
   * S-30: the project's watched supplier schedules (R-204: order not cancelled, not all complete) and their slip in working days;
   * names as typed. Absent without a supplier schedule.
   */
  supplierSlips?: { po: string; supplier: string; slipDays: number; activity: string | null; finishImpactDays?: number | null }[];
}

export interface AlertPeople {
  /** Names of the people above the threshold in a window week, pool order. */
  over: string[];
  /** ISO week numbers in which someone is above the threshold. */
  peakWeeks: number[];
}

export interface AlertApproval {
  /** "CR-008". */
  id: string;
  /** In the render language. */
  title: string;
  /** ISO date the item has been waiting since. */
  since: string;
}

export interface AlertInput {
  projects: readonly AlertProject[];
  people: AlertPeople | null;
  approvals: readonly AlertApproval[];
  /** Data date (ISO) the approvals' age is measured at. */
  asOf: string;
}

const dec = (v: number, lang: Lang) => (lang === 'fr' ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
const dayDate = (iso: string, t: T) => t(displayOfIso(iso));

/** The alerts of the portfolio, worst first, at most `th.maxAlerts`. `t` translates data texts (dates). */
export function portfolioAlertRules(input: AlertInput, lang: Lang, t: T, th: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): PortfolioAlert[] {
  const fr = lang === 'fr';
  // S-33: each alert carries its score (class, then magnitude); `order` = the project's register order (tie-break).
  const out: { alert: PortfolioAlert; score: number; order: number }[] = [];
  const push = (alert: PortfolioAlert, score: number, order: number) => out.push({ alert, score, order });
  const lateDays = (iso: string) => Math.max(0, daysBetweenIso(iso, input.asOf));

  input.projects.forEach((p, order) => {
    const cpi = p.actual ? clampHealthCpi((p.budget * p.progress) / p.actual) : null;
    const spi = p.spi;
    // 1. Off track (A-13): the weaker index names the screen that resolves it.
    if (p.health === 'off_track') {
      const parts = [spi != null ? `SPI ${dec(spi, lang)}` : null, cpi != null ? `CPI ${dec(cpi, lang)}` : null].filter(Boolean).join(' · ');
      const scheduleSide = spi != null && (cpi == null || spi <= cpi);
      push({
        key: `off-${p.code}`, kind: 'off_track', icon: 'clock-countdown', code: p.code,
        title: fr ? `${p.name} — hors trajectoire` : `${p.name} — off track`,
        detail: fr ? `${parts} — sous le seuil « hors trajectoire » ${dec(th.health.off, lang)}.` : `${parts} — below the off-track threshold ${dec(th.health.off, lang)}.`,
        action: scheduleSide ? 'Open schedule' : 'Open budget',
        target: { screen: scheduleSide ? 'schedule' : 'budget', code: p.code },
      }, alertScore(1, magnitude(th.health.off - Math.min(spi ?? 9, cpi ?? 9), SCALE.offTrackIndexGap)), order);
    }
    // 2 / 7. Schedule: critical-path slip (negative float), else late milestones.
    const s = p.schedule;
    if (s && (s.floatDays < 0 || s.lateMilestones.length)) {
      const late = s.lateMilestones.length
        ? fr
          ? ` · ${s.lateMilestones.length > 1 ? `${s.lateMilestones.length} jalons en retard` : '1 jalon en retard'} : ${s.lateMilestones.join(', ')}`
          : ` · ${s.lateMilestones.length > 1 ? `${s.lateMilestones.length} milestones late` : '1 milestone late'}: ${s.lateMilestones.join(', ')}`
        : '';
      const slip = s.floatDays < 0;
      const float = `−${Math.abs(s.floatDays)} ${fr ? 'j' : 'd'}`;
      push({
        key: `${slip ? 'slip' : 'ms'}-${p.code}`, kind: slip ? 'critical_slip' : 'milestone_late', icon: 'lightning', code: p.code,
        title: fr ? `${p.name} — ${slip ? 'glissement du chemin critique' : 'jalon en retard'}` : `${p.name} — ${slip ? 'critical path slip' : 'milestone late'}`,
        detail: (slip
          ? fr ? `Chemin critique ${float} · fin prévue ${s.finishText} (référence ${s.baselineText})` : `Critical path ${float} · forecast finish ${s.finishText} (baseline ${s.baselineText})`
          : fr ? `Fin prévue ${s.finishText} (référence ${s.baselineText})` : `Forecast finish ${s.finishText} (baseline ${s.baselineText})`) + late + '.',
        action: 'Open schedule', target: { screen: 'schedule', code: p.code },
      }, slip
        ? alertScore(1, magnitude(-s.floatDays, SCALE.criticalSlipDays))
        : alertScore(2, magnitude(s.lateMilestones.length, SCALE.lateMilestones)), order);
    }
    // 3. Cost overrun (CPI below "At risk below"); an off-track project already shows its CPI.
    if (cpi != null && cpi < th.health.risk && p.health !== 'off_track') {
      const eac = p.budget / cpi;
      const over = eac - p.budget;
      push({
        key: `cost-${p.code}`, kind: 'cost_overrun', icon: 'coins', code: p.code,
        title: fr ? `${p.name} — dépassement de coût` : `${p.name} — cost overrun`,
        detail: fr
          ? `Prévision ${money(eac, lang)} pour un budget de ${money(p.budget, lang)} (${money(over, lang, { signed: true })}) · CPI ${dec(cpi, lang)}.`
          : `Forecast ${money(eac, lang)} vs budget ${money(p.budget, lang)} (${money(over, lang, { signed: true })}) · CPI ${dec(cpi, lang)}.`,
        action: 'Open budget', target: { screen: 'budget', code: p.code },
      }, alertScore(2, magnitude(p.budget ? over / p.budget : 0, SCALE.costOverrunShare)), order);
    }
    // 4. Billing late: overdue invoices first, else payment milestones not invoiced on time.
    const b = p.billing;
    if (b && (b.overdue.length || b.late.length)) {
      const cur = b.currency ?? BASE_CURRENCY;
      const more = (n: number) => (n > 1 ? (fr ? ` · ${n - 1} de plus` : ` · ${n - 1} more`) : '');
      const inv = b.overdue[0];
      const ms = b.late[0];
      push({
        key: `bill-${p.code}`, kind: 'billing_late', icon: 'receipt', code: p.code,
        title: inv ? (fr ? `${p.name} — facture en retard de paiement` : `${p.name} — invoice overdue`) : fr ? `${p.name} — facturation en retard` : `${p.name} — billing late`,
        detail: inv
          ? fr
            ? `${inv.number} · ${moneyIn(inv.amountKeur, cur, lang)} échue le ${dayDate(inv.dueOn, t)}${more(b.overdue.length)}.`
            : `${inv.number} · ${moneyIn(inv.amountKeur, cur, lang)} due ${dayDate(inv.dueOn, t)}${more(b.overdue.length)}.`
          : fr
            ? `${ms.number} ${ms.label} · date contractuelle ${dayDate(ms.dueOn, t)}, non facturé${more(b.late.length)}.`
            : `${ms.number} ${ms.label} · contractual date ${dayDate(ms.dueOn, t)}, not invoiced${more(b.late.length)}.`,
        action: 'Open billing', target: { screen: 'billing', code: p.code },
      }, alertScore(2, magnitude(Math.max(0, ...b.overdue.map((x) => lateDays(x.dueOn)), ...b.late.map((x) => lateDays(x.dueOn))), SCALE.billingLateDays)), order);
    }
    // 8. S-30: the supplier schedules slipping at or above the Settings threshold (S-31) — the worst one named, the others counted.
    // S-33: the schedule pushing the project's finish most is named first, then the bigger slip.
    const slipFrom = th.supplierSlipDays ?? SUPPLIER_SLIP_ALERT_DAYS;
    const impactFrom = th.supplierImpactDays ?? SUPPLIER_SLIP_ESCALATION_STANDARD.impactDays;
    const slipping = (p.supplierSlips ?? []).filter((x) => x.slipDays >= slipFrom)
      .sort((a, b) => (b.finishImpactDays ?? 0) - (a.finishImpactDays ?? 0) || b.slipDays - a.slipDays || a.po.localeCompare(b.po));
    if (slipping.length) {
      const w = slipping[0];
      const n = slipping.length;
      const more = n > 1 ? (fr ? ` · ${n - 1} de plus` : ` · ${n - 1} more`) : '';
      const act = w.activity ? ` · ${w.activity}` : '';
      const impact = w.finishImpactDays ?? 0;
      const pushes = impact > 0 ? (fr ? ` · fin du projet +${impact} jours ouvrés` : ` · project finish +${impact} working days`) : '';
      const hits = impact >= impactFrom;
      push({
        key: `supplier-${p.code}`, kind: 'supplier_slip', icon: 'truck', code: p.code,
        title: fr ? `${p.name} — planning fournisseur en glissement` : `${p.name} — supplier schedule slipping`,
        detail: fr
          ? `${w.po} · ${w.supplier} · +${w.slipDays} jours ouvrés (seuil ${slipFrom})${pushes}${act}${more}.`
          : `${w.po} · ${w.supplier} · +${w.slipDays} working days (threshold ${slipFrom})${pushes}${act}${more}.`,
        action: 'Open the order', target: { screen: 'orders', code: p.code, params: { po: w.po } },
      }, hits
        ? alertScore(alertClass('supplier_slip', { finishImpact: true }), magnitude(impact, SCALE.supplierFinishImpactDays))
        : alertScore(alertClass('supplier_slip'), magnitude(w.slipDays, SCALE.supplierSlipDays)), order);
    }
    // 9. R-208: the latest Monte-Carlo risk analysis gives a low chance of meeting the end date.
    const ra = p.riskAnalysis;
    const chance = th.onTimeChance ?? ALERT_RULE_DEFAULTS.onTimeChance;
    if (ra && ra.probOnTarget != null && ra.probOnTarget < chance) {
      const pc = `${Math.round(ra.probOnTarget * 100)} %`;
      const target = ra.target ? (fr ? ` (cible ${dayDate(ra.target, t)})` : ` (target ${dayDate(ra.target, t)})`) : '';
      push({
        key: `mc-${p.code}`, kind: 'risk_forecast', icon: 'warning', code: p.code,
        title: fr ? `${p.name} — faible probabilité de tenir la date de fin` : `${p.name} — low chance of meeting the end date`,
        detail: fr
          ? `Analyse de risques Monte-Carlo : ${pc} · fin P80 ${dayDate(ra.p80Finish, t)}${target}.`
          : `Monte-Carlo risk analysis: ${pc} · P80 finish ${dayDate(ra.p80Finish, t)}${target}.`,
        action: 'Open risk register', target: { screen: 'risks', code: p.code },
      }, alertScore(2, magnitude(chance > 0 ? (chance - ra.probOnTarget) / chance : 0, SCALE.chanceGapShare)), order);
    }
  });

  // 5. Over-allocation in the shared pool (portfolio-wide).
  const pp = input.people;
  if (pp && pp.over.length) {
    const n = pp.over.length;
    const weeks = pp.peakWeeks.length ? weekRangesText(pp.peakWeeks) : '';
    const names = pp.over.slice(0, 3).join(', ') + (n > 3 ? (fr ? ` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}` : ` and ${n - 3} more`) : '');
    push({
      key: 'people', kind: 'over_allocation', icon: 'users-three', code: null,
      title: fr ? `${n} ${n > 1 ? 'personnes' : 'personne'} au-delà de ${th.overAllocatedPct} %` : `${n} ${n > 1 ? 'people' : 'person'} over ${th.overAllocatedPct}%`,
      detail: (weeks ? (fr ? `${pp.peakWeeks.length > 1 ? 'Semaines' : 'Semaine'} ${weeks} · ` : `${pp.peakWeeks.length > 1 ? 'Weeks' : 'Week'} ${weeks} · `) : '') + `${names}.`,
      action: 'Rebalance', target: { screen: 'resources' },
    }, alertScore(3, magnitude(n, SCALE.overAllocatedPeople)), 0);
  }

  // 6. Approvals waiting more than N days (the portfolio director's queue).
  const waiting = input.approvals
    .map((a) => ({ ...a, age: daysBetweenIso(a.since, input.asOf) }))
    .filter((a) => a.age > th.approvalDays)
    .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id));
  if (waiting.length) {
    const n = waiting.length;
    const o = waiting[0];
    push({
      key: 'approvals', kind: 'approvals_waiting', icon: 'stamp', code: null,
      title: fr
        ? `${n} ${n > 1 ? 'approbations en attente' : 'approbation en attente'} depuis plus de ${th.approvalDays} jours`
        : `${n} ${n > 1 ? 'approvals' : 'approval'} waiting more than ${th.approvalDays} days`,
      detail: fr
        ? `La plus ancienne : ${o.id} · ${o.title} · depuis le ${dayDate(o.since, t)} (${o.age} j).`
        : `Oldest: ${o.id} · ${o.title} · since ${dayDate(o.since, t)} (${o.age} d).`,
      action: 'Open my approvals', target: { screen: 'myapprovals' },
    }, alertScore(3, magnitude(o.age, SCALE.approvalDays)), 0);
  }

  return out
    .sort((a, b) => compareAlerts({ ...a.alert, score: a.score, order: a.order }, { ...b.alert, score: b.score, order: b.order }))
    .slice(0, th.maxAlerts)
    .map((x) => x.alert);
}
