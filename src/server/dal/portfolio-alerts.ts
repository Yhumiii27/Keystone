import 'server-only';
// Inputs of the portfolio alert rules (R-130, NEW-D1-1; src/domain/portfolio-alerts.ts): the projects in execution with their
// health, EVM figures and schedule header, the contract billing (overdue invoices, late payment milestones), the shared pool's
// loads over the 8-week window from the data date, and the portfolio director's approval queue (items older than N days).
// Health thresholds from Settings (A-13). Computed at the portfolio data date.
import { businessToday } from '@/server/clock';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { weekMondayOf } from '@/domain/kpis';
import { inExecution } from '@/domain/portfolio';
import { ALERT_RULE_DEFAULTS, portfolioAlertRules, type AlertApproval, type AlertProject, type PortfolioAlert } from '@/domain/portfolio-alerts';
import { isoWeekOf } from '@/server/db/codes';
import { dataText } from '@/i18n/data-text';
import { makeT, type Lang } from '@/i18n/translate';
import { APPROVAL_PROVIDERS } from '@/server/approvals';
import type { ApprovalContext } from '@/server/approvals/types';
import { getContract } from './contract';
import { healthThresholds } from './health-thresholds';
import { getApproverIdentity } from './myapprovals-identity';
import { listScheduleSummaries } from './planning';
import { listProjects, type ProjectRow } from './projects';
import { getResourcePool } from './resources';

/** Billing of a project's contract for the rules: overdue invoices and late billable milestones; null without contract. */
async function billingOf(code: string, lang: Lang): Promise<AlertProject['billing']> {
  const c = await getContract(code);
  if (!c) return null;
  return {
    currency: c.sheet.currency,
    overdue: c.invoices.filter((i) => i.overdue).map((i) => ({ number: i.number, amountKeur: i.amountKeur, dueOn: i.dueOn })),
    late: c.milestones.filter((m) => m.late && m.contractualDue).map((m) => ({ number: m.number, label: dataText(m.label, lang), dueOn: m.contractualDue! })),
  };
}

/** People of the shared pool above the threshold in a week of the 8-week window from the data date. */
async function overAllocated(asOf: string, pct: number) {
  const pool = await getResourcePool();
  const from = weekMondayOf(asOf);
  const idx = pool.weeks.map((w, i) => [w.start, i] as const).filter(([start]) => start >= from).slice(0, 8);
  const over = pool.people.filter((p) => idx.some(([, i]) => (p.loads[i] ?? 0) > pct)).map((p) => p.name);
  const peakWeeks = idx.filter(([, i]) => pool.people.some((p) => (p.loads[i] ?? 0) > pct)).map(([start]) => isoWeekOf(start));
  return { over, peakWeeks };
}

/**
 * The portfolio director's approval queue (global kinds once, project-bound kinds for every project in execution), each item
 * with the date it has been waiting since. Items without a date are left out. A failing provider counts nothing.
 */
async function directorQueue(projects: readonly ProjectRow[], lang: Lang): Promise<AlertApproval[]> {
  const viewer = await getApproverIdentity(PERSONA_BY_ROLE.director);
  const base: ApprovalContext = { viewer, project: projects[0] ?? null, lang };
  const safe = async (p: (typeof APPROVAL_PROVIDERS)[number], ctx: ApprovalContext) => {
    try {
      return await p.items(ctx);
    } catch (e) {
      console.error(`portfolio alerts: provider "${p.kind}" failed`, e);
      return [];
    }
  };
  const items = (
    await Promise.all([
      ...APPROVAL_PROVIDERS.filter((p) => p.scope === 'global').map((p) => safe(p, base)),
      ...projects.flatMap((project) => APPROVAL_PROVIDERS.filter((p) => p.scope === 'project').map((p) => safe(p, { ...base, project }))),
    ])
  ).flat();
  const seen = new Set<string>();
  const out: AlertApproval[] = [];
  for (const i of items) {
    const key = `${i.kind}|${i.id}`;
    if (seen.has(key) || !i.whenIso) continue;
    seen.add(key);
    out.push({ id: i.id, title: dataText(i.title, lang), since: i.whenIso });
  }
  return out;
}

/**
 * "Needs attention" of the portfolio at `on` (default: the business date, R-013), every zone (the overview filters project
 * alerts by zone).
 */
export async function getPortfolioAlerts(lang: Lang, on?: string): Promise<PortfolioAlert[]> {
  const [all, sched, health, asOf] = await Promise.all([listProjects(), listScheduleSummaries(), healthThresholds(), on ?? businessToday()]);
  const t = makeT(lang);
  const rows = all.filter(inExecution);
  const projects: AlertProject[] = await Promise.all(rows.map(async (p) => {
    const s = sched[p.code];
    return {
      code: p.code, name: dataText(p.name, lang), health: p.health, budget: p.budget, actual: p.actual, progress: p.progress, spi: p.spi,
      schedule: s ? {
        floatDays: s.floatDays, finishText: t(s.finishText), baselineText: t(s.baselineText),
        lateMilestones: s.milestones.filter((m) => m.status === 'late').map((m) => dataText(m.name, lang)),
      } : null,
      billing: await billingOf(p.code, lang),
    };
  }));
  const [people, approvals] = await Promise.all([overAllocated(asOf, ALERT_RULE_DEFAULTS.overAllocatedPct), directorQueue(rows, lang)]);
  return portfolioAlertRules({ projects, people, approvals, asOf }, lang, t, { health, ...ALERT_RULE_DEFAULTS });
}
