// Export provider — Budget & cost (/projects/[code]/budget; reference provider of the chapter 4 framework).
// Excel: cost categories, work packages, change lines and the monthly EVM series; CSV: the sheet of the current tab
// (?tab=perf → EVM, setup → categories, cash → EVM); PDF: a cost report (KPIs, categories, work packages, changes).
import { evmCore } from '@/domain/evm';
import { getBudgetData } from '@/server/dal/budget';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfDocument } from '../types';
import { ratioText } from './common';
import { dataText } from '@/i18n/data-text';

async function budgetSheets(ctx: ExportContext): Promise<{ sheets: Record<'categories' | 'wps' | 'changes' | 'evm', ExportSheet>; data: NonNullable<Awaited<ReturnType<typeof getBudgetData>>> } | null> {
  const { t } = ctx;
  const data = ctx.project ? await getBudgetData(ctx.project.code) : null;
  if (!data) return null;
  const { cost } = data;
  const categories: ExportSheet = {
    name: t('Cost categories'),
    columns: [
      { key: 'code', header: t('Code'), width: 8 }, { key: 'name', header: t('Category'), width: 30 }, { key: 'type', header: t('Type'), width: 14 },
      { key: 'source', header: t('Actuals source'), width: 30 }, { key: 'budget', header: t('Budget'), type: 'money_keur' },
      { key: 'actual', header: t('Actual'), type: 'money_keur' }, { key: 'committed', header: t('Committed'), type: 'money_keur' },
      { key: 'forecast', header: t('Forecast'), type: 'money_keur' },
    ],
    rows: cost.categories.map((c) => ({
      code: c.code, name: dataText(c.name, ctx.lang), type: t(c.costTypeLabel), source: t(c.source), budget: c.budget, actual: c.actual, committed: c.committed, forecast: c.forecast,
    })),
  };
  const wps: ExportSheet = {
    name: t('Work packages'),
    columns: [
      { key: 'wbs', header: 'WBS', width: 8 }, { key: 'name', header: t('Work package'), width: 30 }, { key: 'original', header: t('Original'), type: 'money_keur' },
      { key: 'changes', header: t('Changes'), type: 'money_keur' }, { key: 'actual', header: t('Actual'), type: 'money_keur' }, { key: 'eac', header: 'EAC', type: 'money_keur' },
    ],
    rows: cost.workPackages.map((w) => ({ wbs: w.wbs, name: dataText(w.name, ctx.lang), original: w.original, changes: w.changes, actual: w.actual, eac: w.eac })),
  };
  const changes: ExportSheet = {
    name: t('Changes'),
    columns: [
      { key: 'id', header: t('Change'), width: 13 }, { key: 'title', header: t('Title'), width: 40 }, { key: 'amount', header: t('Amount'), type: 'money_keur' },
      { key: 'days', header: t('Days'), type: 'integer' }, { key: 'status', header: t('Status'), width: 12 }, { key: 'meta', header: t('Decision'), width: 30 },
    ],
    rows: cost.changes.map((c) => ({ id: c.id, title: dataText(c.title, ctx.lang), amount: c.amount, days: c.days, status: t(c.statusLabel), meta: t(c.meta) })),
  };
  const evm: ExportSheet = {
    name: 'EVM',
    columns: [
      { key: 'month', header: t('Month'), width: 10 }, { key: 'pv', header: 'PV', type: 'money_keur' }, { key: 'ev', header: 'EV', type: 'money_keur' },
      { key: 'ac', header: 'AC', type: 'money_keur' },
    ],
    rows: cost.pv.map((pv, i) => ({ month: t(cost.chartMonths[i] ?? String(i + 1)), pv, ev: cost.ev[i] ?? null, ac: cost.ac[i] ?? null })),
  };
  return { sheets: { categories, wps, changes, evm }, data };
}

export async function budgetWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const b = await budgetSheets(ctx);
  if (!b) return null;
  const tab = ctx.params.get('tab');
  const { categories, wps, changes, evm } = b.sheets;
  const order = tab === 'setup' ? [categories, wps, changes, evm] : [evm, categories, wps, changes];
  const tabLabel = tab === 'setup' ? 'Structure & changes' : tab === 'cash' ? 'Cash & recovery' : 'Performance';
  return { title: ctx.t('Budget & cost'), filters: [`${ctx.t('Tab')}: ${ctx.t(tabLabel)}`], sheets: order };
}

export async function budgetReport(ctx: ExportContext): Promise<PdfDocument | null> {
  const b = await budgetSheets(ctx);
  if (!b || !ctx.project) return null;
  const { t, lang } = ctx;
  const { cost } = b.data;
  const core = evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac });
  const fmtK = (v: number) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(v) + ' k€';
  const totals = (s: ExportSheet, keys: string[], label: string) => ({
    [s.columns[1].key]: label, ...Object.fromEntries(keys.map((k) => [k, s.rows.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)])),
  });
  return {
    title: t('Budget & cost'),
    subtitle: t('Cost report'),
    project: { code: ctx.project.code, name: dataText(ctx.project.name, ctx.lang) },
    reference: ctx.project.code,
    date: ctx.now.toISOString().slice(0, 10),
    blocks: [
      {
        kind: 'kpis', items: [
          { label: 'BAC', value: fmtK(cost.bac) }, { label: 'EAC', value: fmtK(Math.round(core.eac)) }, { label: 'CPI', value: ratioText(core.cpi, lang) },
          { label: 'SPI', value: ratioText(core.spi, lang) }, { label: t('Actual cost'), value: fmtK(cost.ac.at(-1) ?? 0) },
        ],
      },
      { kind: 'heading', text: t('Cost categories') },
      { kind: 'table', sheet: { ...b.sheets.categories, columns: b.sheets.categories.columns.filter((c) => c.key !== 'source') }, totals: totals(b.sheets.categories, ['budget', 'actual', 'committed', 'forecast'], t('Total')) },
      { kind: 'heading', text: t('Work packages') },
      { kind: 'table', sheet: b.sheets.wps, totals: totals(b.sheets.wps, ['original', 'changes', 'actual', 'eac'], t('Total')) },
      ...(b.sheets.changes.rows.length ? [{ kind: 'heading' as const, text: t('Changes') }, { kind: 'table' as const, sheet: b.sheets.changes }] : []),
    ],
    footnote: t('Amounts in thousands of euros (k€) at the project data date.'),
  };
}

registerExportProvider({ screen: 'budget', table: budgetWorkbook, pdf: budgetReport });
