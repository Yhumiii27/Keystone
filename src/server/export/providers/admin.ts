// Export providers — Administration: Settings (personalisable lists), Machine types, Document types register (Codex) and
// Activity, integrations & audit. Settings: every list with its codes plus the health thresholds; machine types: the
// templates (phases, cost categories, ITP systems, payment terms); document types: the Codex register; Activity &
// integrations: the current view first (`?view=activity|connectors|imports|audit`, `?source=` chip of the feed).
import { SETTINGS_CARDS, parseActivitySource, parsePlumbView } from '@/domain/admin';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { listDocumentTypes } from '@/server/dal/documents';
import { visibleImportFormats } from '@/features/admin/model';
import { listImportFormats } from '@/server/dal/integrations';
import { listMachineTypes } from '@/server/dal/mtypes';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getSettings } from '@/server/dal/settings';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook } from '../types';
import { col, compact, filterLine, kpiSheet, param, sheet } from './common';
import { projectFilter } from './scope';

async function settingsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const data = await getSettings();
  const lists = data.lists as Record<string, { code: string; label: string }[]>;
  const values = SETTINGS_CARDS.filter((c) => c.key !== 'locations' && lists[c.key]).flatMap((c) => lists[c.key].map((v, i) => ({ list: t(c.title), position: i + 1, code: v.code, label: t(v.label) })));
  return {
    title: t('Settings — personalisable lists'),
    sheets: [
      sheet(t('Lists'), [col('list', t('List'), 'text', 30), col('position', '#', 'integer', 5), col('code', t('Code'), 'text', 18), col('label', t('Value'), 'text', 36)], values),
      sheet(t('Stock locations & workshops'), [col('name', t('Location'), 'text', 34), col('type', t('Type'), 'text', 20)], data.locations.map((l) => ({ name: t(l.name), type: t(l.typeLabel) }))),
      kpiSheet(ctx, [
        { label: t('On track'), value: `≥ ${data.health.risk}`, sub: t('Project health rules') },
        { label: t('At risk'), value: `< ${data.health.risk}` }, { label: t('Off track'), value: `< ${data.health.off}` },
      ], t('Project health rules')),
    ],
  };
}

async function machineTypesWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  // A client sees only its own organisation's projects in the "Projects" column.
  const [types, visible] = await Promise.all([listMachineTypes(), projectFilter(ctx)]);
  return {
    title: t('Standard machine types'),
    sheets: [
      sheet(t('Machine types'), [
        col('code', t('Code'), 'text', 8), col('label', t('Label'), 'text', 20), col('description', t('Description'), 'text', 40), col('calendar', t('Calendar'), 'text', 16),
        col('active', t('Active'), 'boolean'), col('standard', t('Standard'), 'boolean'), col('phases', t('Phases'), 'text', 40), col('budget', t('Reference budget'), 'money_keur'),
        col('deposit', t('Deposit'), 'percent'), col('delivery', t('Delivery'), 'percent'), col('acceptance', t('Acceptance'), 'percent'), col('projects', t('Projects'), 'text', 30),
      ], types.map((m) => ({
        code: m.displayCode, label: t(m.label), description: t(m.description), calendar: t(m.calendarLabel), active: m.active, standard: m.isStandard, phases: m.phases.map((p) => t(p)).join(' → '),
        budget: m.costTotalKeur, deposit: m.depositPct / 100, delivery: m.deliveryPct / 100, acceptance: m.acceptancePct / 100, projects: m.projects.filter((p) => visible(p.code)).map((p) => p.code).join(' · '),
      }))),
      sheet(t('Cost categories'), [col('type', t('Machine type'), 'text', 10), col('name', t('Category'), 'text', 30), col('costType', t('Type'), 'text', 14), col('budget', t('Budget'), 'money_keur')],
        types.flatMap((m) => m.costCategories.map((c) => ({ type: m.displayCode, name: t(c.name), costType: t(c.typeLabel), budget: c.budgetKeur })))),
      sheet(t('ITP systems'), [col('type', t('Machine type'), 'text', 10), col('position', '#', 'integer', 5), col('system', t('System'), 'text', 34)],
        types.flatMap((m) => m.itpSystems.map((s, i) => ({ type: m.displayCode, position: i + 1, system: t(s) })))),
      sheet(t('Lessons learned references'), [col('type', t('Machine type'), 'text', 10), col('analytic', t('Analytic code'), 'text', 12), col('project', t('Project'), 'text', 30), col('year', t('Year'), 'text', 6), col('pattern', t('Pattern'), 'text', 40)],
        types.flatMap((m) => m.rexReferences.map((r) => ({ type: m.displayCode, analytic: r.analyticCode, project: t(r.projectName), year: r.year, pattern: t(r.pattern) })))),
    ],
  };
}

async function docTypesWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const rows = await listDocumentTypes();
  return {
    title: t('Document types register (Codex)'),
    sheets: [sheet(t('Document types'), [
      col('code', t('Code'), 'text', 8), col('label', t('Type'), 'text', 30), col('family', t('Family'), 'text', 16), col('circuit', t('Approval circuit'), 'text', 50),
      col('retention', t('Retention'), 'text', 14), col('iso', 'ISO 9001', 'text', 8), col('client', t('Client deliverable'), 'boolean'), col('count', t('In Codex'), 'integer'),
    ], rows.map((r) => ({ code: r.code, label: t(r.label), family: t(r.familyLabel), circuit: t(r.circuitText), retention: t(r.retention), iso: r.isoClause, client: r.isClientDeliverable, count: r.inCodex })))],
  };
}

async function plumbingWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const [activity, connectors, allFormats, audit, visible] = await Promise.all([listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), projectFilter(ctx)]);
  // D-7b: the import cards are hidden while imports are off; the export lists what the screen shows.
  const imports = visibleImportFormats(allFormats);
  const view = parsePlumbView(param(ctx, 'view'));
  const source = parseActivitySource(param(ctx, 'source'), activity.map((a) => a.kind));
  // A client sees its own projects' events only; events without a project are company-wide and stay internal.
  const own = <R extends { projectCode: string | null }>(r: R) => (ctx.viewer.role === 'client' ? !!r.projectCode && visible(r.projectCode) : true);
  const feed = sheet(t('Activity feed'), [col('when', t('Date'), 'datetime'), col('who', t('Who'), 'text', 18), col('what', t('What'), 'text', 60), col('kind', t('Source'), 'text', 14), col('project', t('Project'), 'text', 10)],
    activity.filter((a) => (!source || a.kind === source) && own(a)).map((a) => ({ when: a.occurredAt, who: a.who, what: t(a.what), kind: a.kind, project: a.projectCode ?? '' })));
  const conn: ExportSheet = sheet(t('Connectors'), [
    col('name', t('System'), 'text', 20), col('data', t('Data'), 'text', 44), col('frequency', t('Frequency'), 'text', 18), col('direction', t('Direction'), 'text', 10), col('status', t('Status'), 'text', 10),
    col('last', t('Last sync'), 'datetime'), col('volume', t('Last volume'), 'text', 26), col('pending', t('Pending'), 'integer'), col('failed', t('Failed'), 'integer'), col('owner', t('Owner'), 'text', 16),
  ], connectors.map((c) => ({
    name: c.name, data: t(c.dataScope), frequency: t(c.frequency), direction: c.direction ?? '', status: t(c.statusLabel), last: c.lastSyncAt, volume: t(c.lastVolume), pending: c.pending, failed: c.failed, owner: c.owner ?? '',
  })));
  const formats = sheet(t('Import & export formats'), [col('name', t('Format'), 'text', 26), col('direction', t('Direction'), 'text', 10), col('description', t('Description'), 'text', 60)],
    imports.map((f) => ({ name: t(f.name), direction: t(f.direction === 'import' ? 'Import' : 'Export'), description: t(f.description) })));
  const trail = sheet(t('Audit trail'), [col('when', t('Date'), 'datetime'), col('who', t('Who'), 'text', 18), col('object', t('Object'), 'text', 18), col('change', t('Change'), 'text', 50), col('area', t('Area'), 'text', 18), col('project', t('Project'), 'text', 10)],
    audit.filter(own).map((a) => ({ when: a.occurredAt, who: a.who, object: a.object, change: a.change, area: t(a.area), project: a.projectCode ?? '' })));
  const first = view === 'connectors' ? conn : view === 'imports' ? formats : view === 'audit' ? trail : feed;
  return {
    title: t('Activity, integrations & audit'),
    filters: compact([filterLine(t('Source'), source), ctx.viewer.role === 'client' ? `${t('Client')}: ${ctx.viewer.organisation ?? '—'}` : null]),
    sheets: [first, ...[feed, conn, formats, trail].filter((s) => s !== first)],
  };
}

registerExportProvider({ screen: 'settings', table: settingsWorkbook });
registerExportProvider({ screen: 'mtypes', table: machineTypesWorkbook, fileBase: () => 'machine-types' });
registerExportProvider({ screen: 'doctypes', table: docTypesWorkbook, fileBase: () => 'document-types' });
registerExportProvider({ screen: 'plumbing', table: plumbingWorkbook, fileBase: () => 'activity-integrations' });
