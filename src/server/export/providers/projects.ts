// Export provider — Projects register (/portfolio/projects; reference provider of the chapter 4 framework).
// Rows = what the register shows for the viewer: the zone of the zone bar, the stage slider (?status=), the search (?q=);
// columns follow the view (?view=health|progress|budget) plus the identity columns. Clients see their organisation's
// projects only. Numbers stay numbers (k€, %, ratios).
import { HEALTH_LABEL } from '@/domain/health';
import { isRegisterView, matchesQuery } from '@/domain/lifecycle';
import { buildRegisterModel } from '@/features/projects/register-model';
import { isMineProject } from '@/server/project-context';
import { stage as stageCodec } from '@/server/db/codes';
import { getRegisterData } from '@/server/dal/projects-register';
import { registerExportProvider } from '../registry';
import type { ExportColumn, ExportContext, ExportWorkbook } from '../types';

export async function projectsWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const { t, lang } = ctx;
  const data = await getRegisterData();
  const visible = ctx.viewer.role === 'client' ? { ...data, projects: data.projects.filter((p) => isMineProject(ctx.viewer, p)) } : data;
  const model = buildRegisterModel(visible, ctx.zone, t, lang);
  const status = ctx.params.get('status');
  const q = (ctx.params.get('q') ?? '').slice(0, 100);
  const viewParam = ctx.params.get('view');
  const view = isRegisterView(viewParam) ? viewParam : 'health';
  const byCode = new Map(visible.projects.map((p) => [p.code, p]));
  const rows = model.rows.filter((r) => (!status || r.stage === status) && matchesQuery(r.search, q));

  const ident: ExportColumn[] = [
    { key: 'code', header: t('Code'), width: 10 },
    { key: 'name', header: t('Project'), width: 36 },
    { key: 'stage', header: t('Stage'), width: 20 },
    { key: 'pm', header: t('Project manager'), width: 16 },
    { key: 'client', header: t('Client'), width: 22 },
    { key: 'analytic', header: t('Analytic code'), width: 12 },
    { key: 'machineType', header: t('Machine type'), width: 10 },
    { key: 'start', header: t('Start date'), width: 10 },
    { key: 'finish', header: t('Finish'), width: 10 },
  ];
  const perView: Record<typeof view, ExportColumn[]> = {
    health: [
      { key: 'health', header: t('Health'), width: 12 },
      { key: 'spi', header: 'SPI', type: 'number', decimals: 2 },
      { key: 'cpi', header: 'CPI', type: 'number', decimals: 2 },
      { key: 'milestone', header: t('Next milestone'), width: 24 },
      { key: 'attention', header: t('Attention'), width: 30 },
    ],
    progress: [
      { key: 'progress', header: t('Progress'), type: 'percent' },
      { key: 'finishPlanned', header: t('Planned finish'), width: 14 },
      { key: 'finishForecast', header: t('Forecast finish'), width: 14 },
      { key: 'float', header: t('Float'), width: 12 },
    ],
    budget: [
      { key: 'budget', header: t('Budget'), type: 'money_keur' },
      { key: 'actual', header: t('Spent'), type: 'money_keur' },
      { key: 'spentPct', header: t('Spent %'), type: 'percent' },
      { key: 'eac', header: 'EAC', width: 12 },
      { key: 'vac', header: 'VAC', width: 12 },
    ],
  };
  const sheetRows = rows.map((r) => {
    const p = byCode.get(r.code)!;
    const cpi = r.cpiText && r.cpiText !== '—' ? parseFloat(r.cpiText) : null;
    const spi = r.spiText && r.spiText !== '—' ? parseFloat(r.spiText) : null;
    return {
      code: p.code, name: t(p.name), stage: t(p.status), pm: p.pm, client: t(p.client), analytic: p.analytic ?? '', machineType: p.machineType ?? '',
      start: t(p.start), finish: t(p.finish),
      health: p.health ? t(HEALTH_LABEL[p.health]) : '—', spi: Number.isFinite(spi) ? spi : null, cpi: Number.isFinite(cpi) ? cpi : null,
      milestone: [r.msName, r.msLine].filter((x) => x && x !== '—').join(' · '), attention: r.attention === '—' ? '' : r.attention,
      progress: p.progress, finishPlanned: r.finishPlanned, finishForecast: r.finishForecast, float: r.floatText,
      budget: p.budget, actual: p.actual, spentPct: p.budget ? (p.actual || 0) / p.budget : null, eac: r.eacText, vac: r.vacText,
    };
  });
  const filters = [
    ctx.zone ? `${t('Zone')}: ${ctx.zone.toUpperCase()}` : null,
    status && stageCodec.isCode(status) ? `${t('Stage')}: ${t(stageCodec.label(status))}` : null,
    q ? `${t('Search')}: ${q}` : null,
    `${t('Display')}: ${t(view === 'health' ? 'Health' : view === 'progress' ? 'Progress' : 'Budget')}`,
  ].filter((x): x is string => !!x);
  return { title: t('Projects'), filters, sheets: [{ name: t('Projects'), columns: [...ident, ...perView[view]], rows: sheetRows }] };
}

registerExportProvider({ screen: 'projects', table: projectsWorkbook });
