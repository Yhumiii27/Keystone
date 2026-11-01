// Export provider — My dashboards (R-203, K-203): the viewer's dashboards (own and shared with them) and the widgets of the
// dashboard shown (`?d=`, else the default one), each with its figure or row count as resolved for the viewer — the same rights
// as the screen (a widget outside the viewer's workspace exports "Not available for your role", nothing of its data).
import { widgetTitleParts } from '@/domain/dashboards';
import { dataText } from '@/i18n/data-text';
import { getDb } from '@/server/db/client';
import { resolveWidgets, type WidgetData } from '@/server/dal/dashboard-data';
import { listDashboardsOf } from '@/server/dal/dashboards';
import { userIdOf } from '@/server/dal/users';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, param, sheet } from './common';

function valueOf(ctx: ExportContext, d: WidgetData): string {
  const { t } = ctx;
  if (d.state === 'denied') return t('Not available for your role');
  if (d.state === 'unavailable') return t('No data for this project');
  const v = d.view;
  switch (v.type) {
    case 'kpi':
      return t(v.kpi.value);
    case 'alerts':
      return String(v.alerts.length);
    case 'list':
      return String(v.total);
    case 'evm':
      return t('Budget vs cost');
  }
}

async function dashboardsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang, viewer } = ctx;
  const userId = await userIdOf(await getDb(), viewer);
  const list = userId ? await listDashboardsOf(userId) : [];
  const asked = param(ctx, 'd');
  const current = list.find((d) => d.id === asked) ?? list.find((d) => d.own && d.isDefault) ?? list[0] ?? null;
  const widgets = current ? await resolveWidgets(viewer, current.layout.widgets, lang) : [];
  return {
    title: t('My dashboards'),
    filters: current ? [`${t('Dashboard')}: ${dataText(current.name, lang)}`] : [],
    sheets: [
      sheet(t('My dashboards'), [
        col('name', t('Dashboard'), 'text', 32), col('owner', t('Owned by'), 'text', 20), col('own', t('Mine'), 'boolean'), col('default', t('Default'), 'boolean'),
        col('widgets', t('Widgets'), 'integer'), col('shared', t('Shared with'), 'text', 40),
      ], list.map((d) => ({
        name: dataText(d.name, lang), owner: d.ownerName, own: d.own, default: d.isDefault, widgets: d.layout.widgets.length,
        shared: d.sharedWith.map((p) => p.name).join(', '),
      }))),
      sheet(t('Widgets'), [col('position', '#', 'integer', 5), col('widget', t('Widget'), 'text', 40), col('value', t('Value shown'), 'text', 24)],
        widgets.map(({ widget, data }, i) => {
          const parts = widgetTitleParts(widget);
          const project = data.state === 'ok' ? data.projectLabel : null;
          return { position: i + 1, widget: project ? `${t(parts.label)} · ${project}` : t(parts.label), value: valueOf(ctx, data) };
        })),
    ],
  };
}

registerExportProvider({ screen: 'dashboards', table: dashboardsWorkbook, fileBase: () => 'my-dashboards' });
