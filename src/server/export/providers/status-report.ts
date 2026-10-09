// Weekly status report (PDF, chapter 4 exports): one builder for the Trends screen (steering / internal audience — EVM
// indices, float, risk exposure, milestones, top risks, open changes, deliverables waiting) and for the client portal
// (client audience — progress, milestones, decisions waiting for the client, open issues, invoices; no internal cost
// performance). `sections` trims the report as the "Generate status report" form does (full / summary + KPIs / KPIs only).
import { withDerivedStatus } from '@/domain/change-control';
import { clientScreenView } from '@/features/rexclient/model';
import { getBillingPlan } from '@/server/dal/cashflow';
import { getChangeControl } from '@/server/dal/changes';
import { getClientPortal } from '@/server/dal/client';
import { listDeliverables } from '@/server/dal/quality';
import { getRiskScreen } from '@/server/dal/risks-screen';
import { getScheduleData } from '@/server/dal/schedule';
import { getTrends } from '@/server/dal/trends';
import { reportAudience, reportPeriod, reportSections, type ReportAudience, type ReportPeriod, type ReportSections } from '@/server/db/codes';
import { scheduleView } from '@/domain/schedule-gantt';
import type { ExportContext, PdfBlock, PdfDocument } from '../types';
import { col, monthIso, param, projectRef, sheet, todayIso } from './common';

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

const fmtK = (v: number, lang: string) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(v) + ' k€';

export async function statusReportDocument(ctx: ExportContext, o: StatusReportOptions): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const { t, lang } = ctx;
  const code = ctx.project.code;
  const [trends, schedule] = await Promise.all([getTrends(code), getScheduleData(code)]);
  if (!trends && !schedule) return null;
  const blocks: PdfBlock[] = [];
  if (o.note && o.audience !== 'client') blocks.push({ kind: 'paragraph', text: `${t('Manager note')}: ${o.note}` });
  const sv = schedule ? scheduleView(schedule) : null;
  const milestones = schedule && sv
    ? sheet(t('Milestones'), [col('name', t('Milestone'), 'text', 30), col('baseline', t('Baseline'), 'date', 12), col('forecast', t('Forecast'), 'date', 12), col('slip', t('Slip (d)'), 'integer', 8), col('status', t('Status'), 'text', 12)],
      schedule.milestones.map((m, i) => ({
        name: t(m.name), baseline: monthIso(schedule.header.start + m.baselineMonth), forecast: monthIso(schedule.header.start + m.forecastMonth), slip: sv.milestones[i]?.slip ?? null, status: t(m.statusLabel),
      })))
    : null;

  if (o.audience === 'client') {
    const [portal, billing] = await Promise.all([getClientPortal(code), getBillingPlan(code)]);
    const view = clientScreenView({
      code, tab: 'progress', portal, billing: billing ? { internal: billing.internal } : null,
      schedule: schedule && { header: schedule.header, milestones: schedule.milestones, pv: schedule.pv, ev: schedule.ev, bac: schedule.bac },
    }, t, lang);
    blocks.push({ kind: 'kpis', items: view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub || undefined })) });
    if (o.sections !== 'kpis') {
      if (milestones) blocks.push({ kind: 'heading', text: t('Progress & milestones') }, { kind: 'table', sheet: milestones });
      if (o.sections === 'full') {
        blocks.push({ kind: 'heading', text: t('Decisions waiting for you') });
        blocks.push(view.decisions.length
          ? { kind: 'table', sheet: sheet(t('Decisions'), [col('id', t('Reference'), 'text', 10), col('kind', t('Type'), 'text', 14), col('title', t('Title'), 'text', 40), col('when', t('Since'), 'text', 12)],
            view.decisions.map((d) => ({ id: d.id, kind: d.kindLabel, title: d.title, when: d.when }))) }
          : { kind: 'paragraph', text: t('Nothing waiting for your decision'), muted: true });
        const open = view.issues.filter((_, i) => portal.issues[i]?.status !== 'closed');
        if (open.length) blocks.push({ kind: 'heading', text: t('Open issues') }, { kind: 'table', sheet: sheet(t('Issues'), [col('id', t('Issue'), 'text', 8), col('title', t('Title'), 'text', 40), col('when', t('Raised'), 'text', 12), col('status', t('Status'), 'text', 12), col('response', t('Response'), 'text', 36)], open.map((x) => ({ id: x.id, title: x.title, when: x.when, status: x.status, response: x.response }))) });
        if (view.summary) blocks.push({ kind: 'heading', text: t('Contract summary') }, { kind: 'fields', columns: 2, items: view.summary.map((r) => [r.k, r.v] as [string, string]) });
      }
    }
  } else {
    const last = trends?.snapshots.at(-1) ?? null;
    if (last) {
      blocks.push({ kind: 'kpis', items: [
        { label: t('Progress'), value: `${schedule?.control.pct ?? Math.round(ctx.project.progress * 100)}%` }, { label: 'SPI', value: last.spi.toFixed(2) }, { label: 'CPI', value: last.cpi.toFixed(2) },
        { label: 'EAC', value: fmtK(last.eac, lang), sub: trends ? `BAC ${fmtK(trends.bac, lang)}` : undefined }, { label: t('Critical path float'), value: `${last.float} ${t('d')}` },
        { label: t('Open risk exposure'), value: fmtK(last.risk, lang) },
      ] });
    } else if (sv) blocks.push({ kind: 'kpis', items: sv.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub) })) });
    if (o.sections !== 'kpis') {
      if (schedule) blocks.push({ kind: 'fields', columns: 3, items: [[t('Forecast finish'), t(schedule.header.finishText)], [t('Baseline'), t(schedule.header.baselineText)], [t('Float'), t(schedule.header.floatText)]] });
      if (milestones) blocks.push({ kind: 'heading', text: t('Milestones') }, { kind: 'table', sheet: milestones });
      if (o.sections === 'full') {
        if (trends?.snapshots.length) {
          blocks.push({ kind: 'heading', text: t('Snapshot history') }, { kind: 'table', sheet: sheet(t('Snapshots'), [
            col('week', t('Week'), 'text', 8), col('date', t('Date'), 'date', 12), col('cpi', 'CPI', 'number', 8, { decimals: 2 }), col('spi', 'SPI', 'number', 8, { decimals: 2 }),
            col('eac', 'EAC', 'money_keur', 12), col('float', t('Float (d)'), 'integer', 8), col('risk', t('Risk EMV'), 'money_keur', 12), col('slip', t('Slip (d)'), 'integer', 8),
          ], trends.snapshots.slice(-6).reverse().map((s) => ({ week: s.week, date: s.statusDate, cpi: s.cpi, spi: s.spi, eac: s.eac, float: s.float, risk: s.risk, slip: s.slip }))) });
        }
        const [risks, cc, dlvs] = await Promise.all([getRiskScreen(code), getChangeControl(code), listDeliverables(code)]);
        const top = (risks?.register.risks ?? []).filter((r) => r.status === 'open').sort((a, b) => b.score - a.score).slice(0, 5);
        if (top.length) blocks.push({ kind: 'heading', text: t('Top risks') }, { kind: 'table', sheet: sheet(t('Risk register'), [col('id', t('Risk'), 'text', 7), col('title', t('Title'), 'text', 40), col('score', t('Score'), 'integer', 7), col('owner', t('Owner'), 'text', 16), col('emv', 'EMV', 'money_keur', 10)],
          top.map((r) => ({ id: r.id, title: t(r.title), score: r.score, owner: r.owner ?? '', emv: r.emv || null }))) });
        const open = cc ? withDerivedStatus(cc.changeRequests).filter((c) => c.status === 'in_review' || c.status === 'draft') : [];
        if (open.length) blocks.push({ kind: 'heading', text: t('Open change requests') }, { kind: 'table', sheet: sheet(t('Changes'), [col('id', t('Change'), 'text', 8), col('title', t('Title'), 'text', 40), col('amount', t('Amount'), 'money_keur', 10), col('days', t('Days'), 'integer', 7), col('status', t('Status'), 'text', 12)],
          open.map((c) => ({ id: c.id, title: t(c.title), amount: c.amount, days: c.days, status: t(c.status === 'draft' ? 'Draft' : 'In review') }))) });
        const waiting = dlvs.filter((d) => d.status === 'submitted' || d.status === 'rejected');
        if (waiting.length) blocks.push({ kind: 'heading', text: t('Deliverables awaiting the client') }, { kind: 'table', sheet: sheet(t('Deliverables'), [col('number', t('Deliverable'), 'text', 8), col('title', t('Title'), 'text', 40), col('status', t('Status'), 'text', 14), col('due', t('Acceptance due'), 'date', 12)],
          waiting.map((d) => ({ number: d.number, title: t(d.title), status: t(d.statusLabel), due: d.acceptanceDueOn }))) });
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
    footnote: t('Figures at the project data date, from the weekly snapshots and the live registers of Keystone.'),
  };
}

/**
 * Options of the Trends report: the last report recorded with "Generate status report" (`?report=latest` — its period,
 * audience, sections and manager note, so that the note never travels in the URL), else the URL's options.
 */
export async function trendsReportOptions(ctx: ExportContext): Promise<StatusReportOptions> {
  if (param(ctx, 'report') === 'latest' && ctx.project) {
    const last = (await getTrends(ctx.project.code))?.reports[0];
    if (last) return { audience: last.audience, period: last.period, sections: last.sections, note: last.note };
  }
  return statusReportOptions(ctx, 'steering');
}
