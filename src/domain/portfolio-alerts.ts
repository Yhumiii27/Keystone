// "Needs attention" of the Portfolio overview and the director's Home, computed by rules (NEW-D1-1 answer a, R-130; A-12, A-15)
// instead of the prototype's four fixed texts. One alert per rule and project, worst first:
//   1. off track — the one health rule (A-13) with the Settings thresholds: min(CPI clamped, SPI) below "Off track below";
//   2. critical-path slip — negative float on the critical path (and the late schedule milestones);
//   3. cost overrun — CPI below the Settings "At risk below" threshold (EAC above budget by more than 1 / threshold − 1);
//   4. billing late — an invoice past its due date, or a payment milestone past its contractual date not invoiced;
//   5. over-allocation — people of the shared pool above 110 % in a week of the window (the Resources rule);
//   6. approvals waiting — decisions in the portfolio director's queue older than N days (default 5);
//   7. late milestone — a schedule milestone flagged Late while the critical path still has float.
// Project alerts follow the zone filter; the pool and approval alerts are portfolio-wide. Thresholds: the health thresholds of
// Settings (A-13); the others have no Settings entry yet (`ALERT_RULE_DEFAULTS`, to confirm with the owner). Pure; texts are
// returned in the render language (data texts — names, dates — come translated by the caller's `t`).
// Golden values: src/domain/portfolio-alerts.test.ts.
import type { ScreenId } from '@/config/screens';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { daysBetweenIso, displayOfIso } from '@/server/db/codes';
import { BASE_CURRENCY, moneyIn, type CurrencyCode } from './currency';
import { DEFAULT_HEALTH_THRESHOLDS, clampHealthCpi, type Health, type HealthThresholds } from './health';
import { OVER_ALLOCATED_PCT, weekRangesText } from './resources';

export type AlertKind = 'off_track' | 'critical_slip' | 'cost_overrun' | 'billing_late' | 'over_allocation' | 'approvals_waiting' | 'milestone_late' | 'risk_forecast';
export type AlertIcon = 'lightning' | 'coins' | 'users-three' | 'clock-countdown' | 'receipt' | 'stamp' | 'warning';

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
  target: { screen: ScreenId; code?: string };
}

/** Thresholds without a Settings entry yet (R-130 defaults, owner to confirm — NEW-D1-1 "seuils dans Paramètres"). */
export const ALERT_RULE_DEFAULTS = {
  /** An approval waiting longer than this many calendar days is an alert. */
  approvalDays: 5,
  /** A person above this weekly load (strict) is over-allocated — the Resources rule. */
  overAllocatedPct: OVER_ALLOCATED_PCT,
  /** At most this many alerts are listed (worst first). */
  maxAlerts: 8,
  /** R-208: a Monte-Carlo chance of meeting the end date below this is an alert (DRIFT_RULES.probabilityVeryLow). */
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

const RANK: Record<AlertKind, number> = {
  off_track: 0, critical_slip: 1, cost_overrun: 2, billing_late: 3, over_allocation: 4, approvals_waiting: 5, milestone_late: 6, risk_forecast: 7,
};

const dec = (v: number, lang: Lang) => (lang === 'fr' ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
const dayDate = (iso: string, t: T) => t(displayOfIso(iso));

/** The alerts of the portfolio, worst first, at most `th.maxAlerts`. `t` translates data texts (dates). */
export function portfolioAlertRules(input: AlertInput, lang: Lang, t: T, th: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): PortfolioAlert[] {
  const fr = lang === 'fr';
  const out: { alert: PortfolioAlert; weight: number; order: number }[] = [];
  const push = (alert: PortfolioAlert, weight: number, order: number) => out.push({ alert, weight, order });

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
      }, Math.min(spi ?? 9, cpi ?? 9), order);
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
      }, s.floatDays, order);
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
      }, -over, order);
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
      }, 0, order);
    }
    // 7. R-208: the latest Monte-Carlo risk analysis gives a low chance of meeting the end date.
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
      }, ra.probOnTarget, order);
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
    }, -n, 0);
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
    }, -o.age, 0);
  }

  return out
    .sort((a, b) => RANK[a.alert.kind] - RANK[b.alert.kind] || a.weight - b.weight || a.order - b.order)
    .slice(0, th.maxAlerts)
    .map((x) => x.alert);
}
