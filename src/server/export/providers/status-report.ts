// Weekly status report (PDF, chapter 4 exports) adapted to its audience (C-5 answer a, R-131) — one builder for the Trends
// screen and the client portal:
// - steering committee: everything — progress and EVM indices, float, risk exposure, the margin at completion (contract − EAC,
//   C-10b; shown to the roles that see margins, director and PM), the contract and billing position, milestones, snapshot
//   history, top risks, open changes and deliverables waiting for the client;
// - internal: the steering content plus the resources assigned to the project (team, average and peak load);
// - client: progress, milestones, change requests (waiting and decided), deliverables, invoices and the contract summary in the
//   contract's currency, decisions waiting and open issues — no internal cost figure (no EAC, CPI, budget or margin).
// A client viewer always gets the client report, whatever the URL or the last recorded report asks. `sections` trims the
// report as the "Generate status report" form does (full / summary + KPIs / KPIs only).
import { withDerivedStatus } from '@/domain/change-control';
import { contractFigures } from '@/domain/contract';
import { moneyIn } from '@/domain/currency';
import { paymentTermsText } from '@/domain/payment-terms';
import { canSeeMargins } from '@/domain/portfolio-finance';
import { projectEacKeur } from '@/domain/kpis';
import { clientScreenView } from '@/features/rexclient/model';
import { getBillingPlan, marginAtCompletion } from '@/server/dal/cashflow';
import { getChangeControl } from '@/server/dal/changes';
import { getClientPortal } from '@/server/dal/client';
import { getContract } from '@/server/dal/contract';
import { listDeliverables } from '@/server/dal/quality';
import { getProjectTeam } from '@/server/dal/resources';
import { getRiskScreen } from '@/server/dal/risks-screen';
import { getScheduleData } from '@/server/dal/schedule';
import { getTrends } from '@/server/dal/trends';
import { reportAudience, reportPeriod, reportSections, type ReportAudience, type ReportPeriod, type ReportSections } from '@/server/db/codes';
import { scheduleView } from '@/domain/schedule-gantt';
import type { ExportContext, PdfBlock, PdfDocument } from '../types';
import { col, daysText, monthIso, param, projectRef, ratioText, sheet, todayIso } from './common';
import { dataText } from '@/i18n/data-text';

export interface StatusReportOptions {
  audience: ReportAudience;
  period: ReportPeriod;
  sections: ReportSections;
  /** Manager note of a recorded report (internal audiences only). */
  note?: string | null;
}

/** Options from the export URL (`?audience=&period=&sections=`), with the screen's defaults. */
export function statusReportOptions(ctx: ExportContext, audience: ReportAudience): StatusReportOptions {
  const p = param(ctx, 'period');
  const s = param(ctx, 'sections');
  const a = param(ctx, 'audience');
  return {
    // The client portal always reports to the client.
    audience: audience === 'client' ? 'client' : a && reportAudience.isCode(a) && a !== 'client' ? a : audience,
    period: p && reportPeriod.isCode(p) ? p : 'month',
    sections: s && reportSections.isCode(s) ? s : 'full',
  };
}

/** C-5: the audience actually reported to — a client viewer always gets the client report. */
export const effectiveAudience = (ctx: Pick<ExportContext, 'viewer'>, audience: ReportAudience): ReportAudience =>
  ctx.viewer.role === 'client' ? 'client' : audience;

const fmtK = (v: number, lang: string) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(v) + ' k€';

export async function statusReportDocument(ctx: ExportContext, options: StatusReportOptions): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const { t, lang } = ctx;
  const o: StatusReportOptions = { ...options, audience: effectiveAudience(ctx, options.audience) };
  const code = ctx.project.code;
  const [trends, schedule] = await Promise.all([getTrends(code), getScheduleData(code)]);
  if (!trends && !schedule) return null;
  const blocks: PdfBlock[] = [];
  if (o.note && o.audience !== 'client') blocks.push({ kind: 'paragraph', text: `${t('Manager note')}: ${o.note}` });
  const sv = schedule ? scheduleView(schedule) : null;
  const milestones = schedule && sv
    ? sheet(t('Milestones'), [col('name', t('Milestone'), 'text', 30), col('baseline', t('Baseline'), 'date', 12), col('forecast', t('Forecast'), 'date', 12), col('slip', t('Slip (d)'), 'integer', 8), col('status', t('Status'), 'text', 12)],
      schedule.milestones.map((m, i) => ({
        name: dataText(m.name, ctx.lang), baseline: monthIso(schedule.header.start + m.baselineMonth), forecast: monthIso(schedule.header.start + m.forecastMonth), slip: sv.milestones[i]?.slip ?? null, status: t(m.statusLabel),
      })))
    : null;

  if (o.audience === 'client') {
    const [portal, billing, dlvs] = await Promise.all([getClientPortal(code), getBillingPlan(code), listDeliverables(code)]);
    const view = clientScreenView({
      code, tab: 'progress', portal, billing: billing ? { internal: billing.internal } : null,
      schedule: schedule && { header: schedule.header, milestones: schedule.milestones, pv: schedule.pv, ev: schedule.ev, bac: schedule.bac },
    }, t, lang);
    blocks.push({ kind: 'kpis', items: view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub || undefined })) });
    if (o.sections !== 'kpis') {
      if (milestones) blocks.push({ kind: 'heading', text: t('Progress & milestones') }, { kind: 'table', sheet: milestones });
      blocks.push({ kind: 'heading', text: t('Decisions waiting for you') });
      blocks.push(view.decisions.length
        ? { kind: 'table', sheet: sheet(t('Decisions'), [col('id', t('Reference'), 'text', 10), col('kind', t('Type'), 'text', 14), col('title', t('Title'), 'text', 40), col('when', t('Since'), 'text', 12)],
          view.decisions.map((d) => ({ id: d.id, kind: d.kindLabel, title: d.title, when: d.when }))) }
        : { kind: 'paragraph', text: t('Nothing waiting for your decision'), muted: true });
      if (o.sections === 'full') {
        // C-5: the changes (waiting for the client and decided), the deliverables and the invoices.
        const changes = [
          ...view.decisions.filter((d) => d.kind === 'change_request').map((d) => ({ id: d.id, title: d.title, detail: d.sub, state: t('Waiting for you') })),
          ...view.decided.filter((d) => portal.decided.find((x) => x.id === d.id)?.kind === 'change_request').map((d) => ({ id: d.id, title: d.title, detail: '', state: `${d.state} · ${d.when}` })),
        ];
        blocks.push({ kind: 'heading', text: t('Changes') });
        blocks.push(changes.length
          ? { kind: 'table', sheet: sheet(t('Changes'), [col('id', t('Change'), 'text', 8), col('title', t('Title'), 'text', 40), col('detail', t('Impact'), 'text', 26), col('state', t('Status'), 'text', 18)], changes) }
          : { kind: 'paragraph', text: t('No change request for this project'), muted: true });
        blocks.push({ kind: 'heading', text: t('Deliverables') });
        blocks.push(dlvs.length
          ? { kind: 'table', sheet: sheet(t('Deliverables'), [col('number', t('Deliverable'), 'text', 8), col('title', t('Title'), 'text', 40), col('due', t('Due'), 'date', 12), col('status', t('Status'), 'text', 14), col('acceptance', t('Acceptance'), 'text', 22)],
            dlvs.map((d) => ({ number: d.number, title: t(d.title), due: d.dueOn, status: t(d.statusLabel), acceptance: t(d.acceptanceText) }))) }
          : { kind: 'paragraph', text: t('No deliverable registered yet'), muted: true });
        blocks.push({ kind: 'heading', text: t('Invoices') });
        blocks.push(view.invoices.length
          ? { kind: 'table', sheet: sheet(t('Invoices'), [col('no', t('Invoice'), 'text', 14), col('name', t('Milestone'), 'text', 36), col('amount', t('Amount'), 'text', 12), col('status', t('Status'), 'text', 12), col('payment', t('Payment'), 'text', 16)],
            view.invoices.map((i) => ({ no: i.no, name: i.name, amount: i.amount, status: i.status, payment: i.payment }))) }
          : { kind: 'paragraph', text: view.invoicesEmpty ?? t('No invoice issued yet'), muted: true });
        const open = view.issues.filter((_, i) => portal.issues[i]?.status !== 'closed');
        if (open.length) blocks.push({ kind: 'heading', text: t('Open issues') }, { kind: 'table', sheet: sheet(t('Issues'), [col('id', t('Issue'), 'text', 8), col('title', t('Title'), 'text', 40), col('when', t('Raised'), 'text', 12), col('status', t('Status'), 'text', 12), col('response', t('Response'), 'text', 36)], open.map((x) => ({ id: x.id, title: x.title, when: x.when, status: x.status, response: x.response }))) });
        if (view.summary) blocks.push({ kind: 'heading', text: t('Contract summary') }, { kind: 'fields', columns: 2, items: view.summary.map((r) => [r.k, r.v] as [string, string]) });
      }
    }
  } else {
    const last = trends?.snapshots.at(-1) ?? null;
    // C-5 / C-10b: the steering and internal reports show the margin at completion to the roles that see margins.
    const [plan, contract] = await Promise.all([getBillingPlan(code), getContract(code)]);
    const margin = canSeeMargins(ctx.viewer.role) ? marginAtCompletion(plan, ctx.project) : null;
    const marginKpi = margin != null && plan
      ? [{ label: t('Margin at completion'), value: `${margin}%`, sub: `${t('Contract')} ${fmtK(plan.contractValueKeur * plan.eurRate, lang)} · EAC ${fmtK(projectEacKeur(ctx.project), lang)}` }]
      : [];
    if (last) {
      blocks.push({ kind: 'kpis', items: [
        { label: t('Progress'), value: `${schedule?.control.pct ?? Math.round(ctx.project.progress * 100)}%` }, { label: 'SPI', value: ratioText(last.spi, lang) }, { label: 'CPI', value: ratioText(last.cpi, lang) },
        { label: 'EAC', value: fmtK(last.eac, lang), sub: trends ? `BAC ${fmtK(trends.bac, lang)}` : undefined }, { label: t('Critical path float'), value: daysText(last.float, lang) },
        { label: t('Open risk exposure'), value: fmtK(last.risk, lang) }, ...marginKpi,
      ] });
    } else if (sv) blocks.push({ kind: 'kpis', items: [...sv.kpis.map((k) => ({ label: t(k.label), value: k.key === 'spi' && k.value !== '—' ? ratioText(parseFloat(k.value), lang) : t(k.value), sub: t(k.sub) })), ...marginKpi] });
    if (o.sections !== 'kpis') {
      if (schedule) blocks.push({ kind: 'fields', columns: 3, items: [[t('Forecast finish'), t(schedule.header.finishText)], [t('Baseline'), t(schedule.header.baselineText)], [t('Float'), t(schedule.header.floatText)]] });
      if (milestones) blocks.push({ kind: 'heading', text: t('Milestones') }, { kind: 'table', sheet: milestones });
      if (contract) {
        // The contract and billing position (in the contract's currency).
        const fig = contractFigures(contract);
        const m = (k: number) => moneyIn(k, fig.currency, lang);
        blocks.push({ kind: 'heading', text: t('Contract & billing') }, { kind: 'fields', columns: 3, items: [
          [t('Contract value'), m(fig.valueKeur)], [t('Invoiced'), m(fig.invoicedKeur)], [t('Collected'), m(fig.paidKeur)],
          [t('Overdue receivables'), m(fig.overdueKeur)], [t('Amendments pending'), String(fig.pending.count)],
          [t('Payment terms'), paymentTermsText({ rule: contract.sheet.paymentRule, days: contract.sheet.paymentDays }, lang)],
        ] });
      }
      if (o.sections === 'full') {
        if (trends?.snapshots.length) {
          blocks.push({ kind: 'heading', text: t('Snapshot history') }, { kind: 'table', sheet: sheet(t('Snapshots'), [
            col('week', t('Week'), 'text', 8), col('date', t('Date'), 'date', 12), col('cpi', 'CPI', 'number', 8, { decimals: 2 }), col('spi', 'SPI', 'number', 8, { decimals: 2 }),
            col('eac', 'EAC', 'money_keur', 12), col('float', t('Float (d)'), 'integer', 8), col('risk', t('Risk EMV'), 'money_keur', 12), col('slip', t('Slip (d)'), 'integer', 8),
          ], trends.snapshots.slice(-6).reverse().map((s) => ({ week: s.week, date: s.statusDate, cpi: s.cpi, spi: s.spi, eac: s.eac, float: s.float, risk: s.risk, slip: s.slip }))) });
        }
        const [risks, cc, dlvs, team] = await Promise.all([
          getRiskScreen(code), getChangeControl(code), listDeliverables(code), o.audience === 'internal' ? getProjectTeam(code) : Promise.resolve([]),
        ]);
        const top = (risks?.register.risks ?? []).filter((r) => r.status === 'open').sort((a, b) => b.score - a.score).slice(0, 5);
        if (top.length) blocks.push({ kind: 'heading', text: t('Top risks') }, { kind: 'table', sheet: sheet(t('Risk register'), [col('id', t('Risk'), 'text', 7), col('title', t('Title'), 'text', 40), col('score', t('Score'), 'integer', 7), col('owner', t('Owner'), 'text', 16), col('emv', 'EMV', 'money_keur', 10)],
          top.map((r) => ({ id: r.id, title: dataText(r.title, ctx.lang), score: r.score, owner: r.owner ?? '', emv: r.emv || null }))) });
        const open = cc ? withDerivedStatus(cc.changeRequests).filter((c) => c.status === 'in_review' || c.status === 'draft') : [];
        if (open.length) blocks.push({ kind: 'heading', text: t('Open change requests') }, { kind: 'table', sheet: sheet(t('Changes'), [col('id', t('Change'), 'text', 8), col('title', t('Title'), 'text', 40), col('amount', t('Amount'), 'money_keur', 10), col('days', t('Days'), 'integer', 7), col('status', t('Status'), 'text', 12)],
          open.map((c) => ({ id: c.id, title: dataText(c.title, ctx.lang), amount: c.amount, days: c.days, status: t(c.status === 'draft' ? 'Draft' : 'In review') }))) });
        const waiting = dlvs.filter((d) => d.status === 'submitted' || d.status === 'rejected');
        if (waiting.length) blocks.push({ kind: 'heading', text: t('Deliverables awaiting the client') }, { kind: 'table', sheet: sheet(t('Deliverables'), [col('number', t('Deliverable'), 'text', 8), col('title', t('Title'), 'text', 40), col('status', t('Status'), 'text', 14), col('due', t('Acceptance due'), 'date', 12)],
          waiting.map((d) => ({ number: d.number, title: dataText(d.title, ctx.lang), status: t(d.statusLabel), due: d.acceptanceDueOn }))) });
        // C-5: the internal report adds the resources assigned to the project.
        if (o.audience === 'internal') {
          blocks.push({ kind: 'heading', text: t('Assigned resources') });
          blocks.push(team.length
            ? { kind: 'table', sheet: sheet(t('Team'), [col('name', t('Person'), 'text', 24), col('role', t('Role'), 'text', 26), col('dept', t('Department'), 'text', 18), col('avg', t('Average load'), 'percent', 10), col('peak', t('Peak load'), 'percent', 10)],
              team.map((p) => ({ name: p.name, role: p.jobTitle ? t(p.jobTitle) : '', dept: p.department ? t(p.department) : '', avg: p.avg / 100, peak: p.max / 100 }))) }
            : { kind: 'paragraph', text: t('No one is assigned to this project yet'), muted: true });
        }
      }
    }
  }
  return {
    title: t('Status report'),
    subtitle: `${t(reportPeriod.label(o.period))} · ${t(reportAudience.label(o.audience))} · ${t(reportSections.label(o.sections))}`,
    project: projectRef(ctx),
    reference: trends?.snapshots.at(-1)?.week ?? ctx.project.code,
    date: todayIso(ctx),
    blocks,
    footnote: o.audience === 'client'
      ? t('Figures at the project data date, from the live registers of Keystone.')
      : t('Figures at the project data date, from the weekly snapshots and the live registers of Keystone.'),
  };
}

/**
 * Options of the Trends report: the last report recorded with "Generate status report" (`?report=latest` — its period,
 * audience, sections and manager note, so that the note never travels in the URL), else the URL's options. A client viewer
 * gets the client audience either way (`effectiveAudience`).
 */
export async function trendsReportOptions(ctx: ExportContext): Promise<StatusReportOptions> {
  if (param(ctx, 'report') === 'latest' && ctx.project) {
    const last = (await getTrends(ctx.project.code))?.reports[0];
    if (last) return { audience: effectiveAudience(ctx, last.audience), period: last.period, sections: last.sections, note: ctx.viewer.role === 'client' ? null : last.note };
  }
  const o = statusReportOptions(ctx, 'steering');
  return { ...o, audience: effectiveAudience(ctx, o.audience) };
}
