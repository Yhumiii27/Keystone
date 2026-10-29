// Export providers — Portfolio (zone screens): Overview, Portfolio schedule, Projects map, Prioritisation & capacity, Cash
// flow & billing. Rows follow the zone bar (`ctx.zone`), the screen's own filters (`?filter=` stage group, `?tab=`
// score / capacity, `?project=` candidate) and the viewer's rights (margins masked as on screen; a client exports only
// their organisation's projects).
import { HEALTH_LABEL } from '@/domain/health';
import { isPgFilter, parseWindowParam, portfolioScheduleModel, windowLabel } from '@/domain/pfplan';
import { portfolioKpis, portfolioTotals } from '@/domain/portfolio';
import { billingRollup, cashBars, rankByScore } from '@/domain/portfolio-finance';
import { mapKpis } from '@/domain/worldmap';
import { pfT } from '@/features/pfinance/i18n';
import { cashView, parsePfTab, prioritisationView, capacityView } from '@/features/pfinance/model';
import { MO } from '@/lib/format';
import { getProjectsMap } from '@/server/dal/geo';
import { getCapacityScreen, getCashScreen, getPrioritisationScreen } from '@/server/dal/pfinance';
import { getPortfolioSchedule } from '@/server/dal/pipeline';
import { healthThresholds } from '@/server/dal/health-thresholds';
import { getPortfolioOverview } from '@/server/dal/portfolio';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, compact, filterLine, kpiSheet, monthIso, monthOfText, param, pctNum, sheet } from './common';
import { projectFilter } from './scope';
import { dataText } from '@/i18n/data-text';

const zoneLine = (ctx: ExportContext) => filterLine(ctx.t('Zone'), ctx.zone?.toUpperCase());

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function overviewWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang } = ctx;
  const [data, visible, th] = await Promise.all([getPortfolioOverview(ctx.zone, lang), projectFilter(ctx), healthThresholds()]);
  const rows = data.rows.filter((p) => visible(p.code));
  // The rows already carry their metrics with the Settings thresholds (A-13); a client's subset recomputes the totals only.
  const kpis = rows.length === data.rows.length ? data.kpis : portfolioKpis(portfolioTotals(rows), lang, th);
  return {
    title: t('Portfolio overview'),
    filters: compact([zoneLine(ctx)]),
    sheets: [
      sheet(t('Active projects'), [
        col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('pm', t('Project manager'), 'text', 14), col('finish', t('Finish'), 'month', 10),
        col('health', t('Health'), 'text', 12), col('progress', t('Progress'), 'percent'), col('budget', t('Budget'), 'money_keur'), col('actual', t('Actual cost'), 'money_keur'),
        col('earned', t('Earned value'), 'money_keur'), col('cpi', 'CPI', 'number', 8, { decimals: 2 }), col('spi', 'SPI', 'number', 8, { decimals: 2 }),
        col('eac', 'EAC', 'money_keur'), col('variance', t('Variance'), 'money_keur'),
      ], rows.map((p) => ({
        code: p.code, name: dataText(p.name, ctx.lang), pm: p.pm, finish: monthOfText(p.finish), health: p.metrics.health ? t(HEALTH_LABEL[p.metrics.health]) : '—', progress: p.progress, budget: p.budget, actual: p.actual,
        earned: Math.round(p.metrics.earned), cpi: p.metrics.cpi, spi: p.metrics.spi, eac: Math.round(p.metrics.eac), variance: Math.round(p.metrics.variance),
      }))),
      kpiSheet(ctx, kpis.map((k) => ({ label: t(k.label), value: k.value, sub: t(k.sub) }))),
      sheet(t('Needs attention'), [col('project', t('Project'), 'text', 10), col('title', t('Alert'), 'text', 44), col('detail', t('Details'), 'text', 60), col('action', t('Action'), 'text', 20)],
        // The alert texts are written in the export's language, typed names as typed (R-130, R-148): not translated again.
        data.alerts.filter((a) => visible(a.code)).map((a) => ({ project: a.code ?? '', title: a.title, detail: a.detail, action: t(a.action) }))),
    ],
  };
}

// ── Portfolio schedule ───────────────────────────────────────────────────────────────────────────────────────────────
const WINDOW_LABEL: Record<string, string> = { initiative: 'Initiative', board: 'Group board', aps: 'APS', apd: 'APD' };
const monthText = (m: number) => `${MO[((Math.floor(m) % 12) + 12) % 12]} ${2026 + Math.floor(Math.floor(m) / 12)}`;

async function pfplanWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang } = ctx;
  const f = param(ctx, 'filter');
  const filter = isPgFilter(f) ? f : 'all';
  const [input, visible] = await Promise.all([getPortfolioSchedule(ctx.zone), projectFilter(ctx)]);
  const scoped = { ...input, rows: input.rows.filter((r) => visible(r.project.code)) };
  // L-8 (R-136): the window of the screen (`?from=`); the sheets list every row whatever the window.
  const model = portfolioScheduleModel(scoped, { filter, lang, from: parseWindowParam(param(ctx, 'from')) });
  const byCode = new Map(scoped.rows.map((r) => [r.project.code, r]));
  const shown = model.groups.flatMap((g) => g.rows.map((r) => ({ g, r, i: byCode.get(r.code)! })));
  return {
    title: t('Portfolio schedule — projects in progress & pipeline'),
    filters: compact([
      zoneLine(ctx), filter !== 'all' ? `${t('Display')}: ${t(filter === 'exec' ? 'In progress' : 'Pipeline')}` : null, filterLine(t('Period'), windowLabel(model.window.from, t)),
    ]),
    sheets: [
      sheet(t('Projects'), [
        col('group', t('Group'), 'text', 12), col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('pm', t('Project manager'), 'text', 26),
        col('stage', t('Stage'), 'text', 22), col('execStart', t('Execution start'), 'date'), col('finish', t('Finish'), 'month', 10), col('gate', t('Next gate'), 'text', 24),
        col('gateSub', t('Details'), 'text', 22), col('pending', t('Decision pending'), 'boolean'),
      ], shown.map(({ g, r, i }) => ({
        group: t(g.label), code: r.code, name: dataText(r.name, ctx.lang), pm: t(r.pmLine), stage: t(r.status), execStart: i.pipeline ? monthIso(i.execStart) : null,
        finish: monthOfText(i.project.finish), gate: t(r.gate), gateSub: t(r.gateSub), pending: r.decisionPending,
      }))),
      sheet(t('Stage plan'), [col('code', t('Code'), 'text', 10), col('window', t('Stage'), 'text', 16), col('start', t('Start date'), 'date'), col('end', t('Finish'), 'date'), col('period', t('Period'), 'text', 22)],
        shown.flatMap(({ r, i }) => i.windows.map((w) => ({ code: r.code, window: t(WINDOW_LABEL[w.window] ?? w.window), start: monthIso(w.start), end: monthIso(w.end), period: `${t(monthText(w.start))} → ${t(monthText(w.end))}` })))),
      kpiSheet(ctx, model.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub) }))),
    ],
  };
}

// ── Projects map ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function worldmapWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const [map, visible] = await Promise.all([getProjectsMap(ctx.zone), projectFilter(ctx)]);
  const points = map.points.filter((p) => visible(p.project.code));
  const kpis = mapKpis(points.map((p) => ({ category: p.category, health: p.health, site: `${p.city}|${p.country}`, country: p.country })), map.unlocated, map.zone?.label ?? null);
  const CAT: Record<string, string> = { active: 'Active', pipeline: 'Pipeline', closed: 'Closed', other: 'Other' };
  return {
    title: t('Projects map'),
    filters: compact([zoneLine(ctx)]),
    sheets: [
      sheet(t('Sites'), [
        col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('stage', t('Stage'), 'text', 22), col('category', t('Category'), 'text', 10),
        col('health', t('Health'), 'text', 12), col('pm', t('Project manager'), 'text', 14), col('client', t('Client'), 'text', 20), col('city', t('City'), 'text', 16),
        col('country', t('Country'), 'text', 16), col('lat', t('Latitude'), 'number', 10, { decimals: 4 }), col('lng', t('Longitude'), 'number', 10, { decimals: 4 }),
      ], points.map((p) => ({
        code: p.project.code, name: dataText(p.project.name, ctx.lang), stage: t(p.project.status), category: t(CAT[p.category] ?? p.category), health: p.health ? t(HEALTH_LABEL[p.health]) : '',
        pm: p.project.pm, client: dataText(p.project.client, ctx.lang), city: t(p.city), country: t(p.country), lat: p.lat, lng: p.lng,
      }))),
      kpiSheet(ctx, kpis.map((k) => ({ label: t(k.label), value: k.value, sub: t(k.sub) }))),
    ],
  };
}

// ── Prioritisation & capacity ────────────────────────────────────────────────────────────────────────────────────────
async function prioritisationWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const t = pfT(ctx.t, ctx.lang);
  const { lang } = ctx;
  const tab = parsePfTab(param(ctx, 'tab'));
  const [{ candidates, ...data }, visible] = await Promise.all([getPrioritisationScreen(ctx.viewer, ctx.zone), projectFilter(ctx)]);
  const scoped = { ...data, projects: data.projects.filter((p) => visible(p.code)) };
  const view = prioritisationView(scoped, scoped.weights, t, lang);
  const ranked = rankByScore(scoped.projects, scoped.weights);
  const ranking = sheet(t('Ranking'), [
    col('rank', '#', 'integer', 5), col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('stage', t('Stage'), 'text', 20),
    col('score', t('Score'), 'number', 8, { decimals: 2 }), ...scoped.axes.map((a, i) => col(`ax${i}`, t(a.label), 'integer', 12)), col('budget', t('Budget'), 'money_keur'),
    ...(scoped.canSeeMargin ? [col('margin', t('Margin'), 'percent', 10, { decimals: 1 })] : []),
  ], ranked.map(({ rank, score, item: p }) => ({
    rank, code: p.code, name: dataText(p.name, ctx.lang), stage: t(p.status), score, ...Object.fromEntries(p.scores.map((v, i) => [`ax${i}`, v])), budget: p.budget,
    margin: p.marginPct != null ? p.marginPct / 100 : null,
  })));
  const weights = sheet(t('Weights'), [col('axis', t('Axis'), 'text', 30), col('weight', t('Weight'), 'number', 10), col('share', t('Share'), 'percent', 10)],
    scoped.axes.map((a, i) => ({ axis: t(a.label), weight: scoped.weights[i] ?? 0, share: pctNum(view.weightRows[i]?.pct) })));
  const sheets = [ranking, weights, kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub })))];
  if (tab === 'capacity') {
    const asked = param(ctx, 'project');
    const cands = candidates.filter((c) => visible(c.code));
    const candidate = cands.find((c) => c.code === asked) ?? cands[0] ?? null;
    const input = candidate ? await getCapacityScreen(candidate.code) : null;
    if (input) {
      const cv = capacityView(input, t, lang);
      sheets.unshift(sheet(`${t('Capacity')} ${input.project.code}`, [
        col('department', t('Department'), 'text', 22), col('capacity', t('Capacity (h)'), 'integer'), col('committed', t('Committed (h)'), 'integer'),
        col('add', t('Candidate (h)'), 'integer'), col('total', t('Total (h)'), 'integer'), col('gap', t('Gap (h)'), 'integer'),
      ], input.departments.map((d) => {
        const total = d.committedH + d.addH;
        return { department: t(d.department), capacity: d.capacityH, committed: d.committedH, add: d.addH, total, gap: Math.max(0, total - d.capacityH) };
      })));
      sheets.splice(1, 0, kpiSheet(ctx, [{ label: t('Verdict'), value: cv.verdict, sub: cv.gapLine }, { label: t('Project'), value: `${input.project.code} · ${cv.name}`, sub: cv.budgetLine }, ...cv.options.map((o, i) => ({ label: `${t('Option')} ${i + 1}`, value: o }))], t('Capacity what-if')));
    }
  }
  return {
    title: t('Portfolio — prioritisation & capacity'),
    filters: compact([zoneLine(ctx), `${t('Display')}: ${t(tab === 'capacity' ? 'Capacity' : 'Scoring')}`]),
    sheets,
  };
}

// ── Cash flow & billing ──────────────────────────────────────────────────────────────────────────────────────────────
async function cashWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const t = pfT(ctx.t, ctx.lang);
  const [data, visible] = await Promise.all([getCashScreen(ctx.viewer.role, ctx.zone), projectFilter(ctx)]);
  const scoped = { ...data, rows: data.rows.filter((r) => visible(r.code)) };
  const view = cashView(scoped, t, ctx.lang);
  const bars = cashBars(scoped.forecast);
  return {
    title: t('Cash flow & billing — next 6 months'),
    filters: compact([zoneLine(ctx)]),
    sheets: [
      sheet(t('Billing by project'), [
        col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('model', t('Billing model'), 'text', 24), col('contract', t('Contract value'), 'money_keur'),
        col('invoiced', t('Invoiced'), 'money_keur'), col('paid', t('Paid'), 'money_keur'), col('outstanding', t('Outstanding'), 'money_keur'), col('cost', t('Cost to date'), 'money_keur'),
        ...(scoped.canSeeMargin ? [col('margin', t('Margin'), 'percent', 10, { decimals: 1 })] : []), col('next', t('Next milestone'), 'text', 36),
      ], scoped.rows.map((r) => {
        const b = billingRollup(r.contractKeur, r.milestones);
        return {
          code: r.code, name: dataText(r.name, ctx.lang), model: t(r.modelLabel), contract: r.contractKeur || null, invoiced: r.contractKeur ? b.invoicedKeur : null, paid: r.contractKeur ? b.paidKeur : null,
          outstanding: r.contractKeur ? b.outstandingKeur : null, cost: r.actual, margin: r.marginPct != null ? r.marginPct / 100 : null,
          next: b.next ? `${t(b.next.label)} · ${b.next.amountKeur} k€` : '',
        };
      })),
      sheet(t('Cash forecast'), [col('month', t('Month'), 'text', 10), col('in', t('Cash in'), 'money_keur'), col('out', t('Cash out'), 'money_keur'), col('net', t('Net'), 'money_keur')],
        scoped.forecast.map((m, i) => ({ month: t(m.label), in: m.cashInKeur, out: m.cashOutKeur, net: bars[i]?.netKeur ?? m.cashInKeur - m.cashOutKeur }))),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub }))),
    ],
  };
}

registerExportProvider({ screen: 'overview', table: overviewWorkbook, fileBase: () => 'portfolio-overview' });
registerExportProvider({ screen: 'pfplan', table: pfplanWorkbook, fileBase: () => 'portfolio-schedule' });
registerExportProvider({ screen: 'worldmap', table: worldmapWorkbook, fileBase: () => 'projects-map' });
registerExportProvider({ screen: 'portfolio', table: prioritisationWorkbook, fileBase: () => 'prioritisation' });
registerExportProvider({ screen: 'cash', table: cashWorkbook, fileBase: () => 'cash-flow' });
