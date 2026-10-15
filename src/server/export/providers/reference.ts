// Export providers — Documents (Codex index) and the technical reference: Parts (PLM), Engineering change orders (Vigie
// mirror), Drawings (PDM vault).
// Documents: the vault register with the screen's scope / saved view / family / status / search (`?scope=&view=&fam=
// &status=&q=`), or only the documents ticked in the selection bar (`?numbers=A,B`) — "Export register (xlsx)"; the files
// themselves stay in Codex. Parts: the catalogue with its filters and sort; ECOs: the register with the status chip and
// each ECO's Vigie link; Drawings: the vault register with its state chip and search.
import { parseFamily, parseScope, parseStatus, parseView, vaultKpis, vaultList } from '@/domain/documents';
import { filterDrawings, drawingFilterOf } from '@/domain/drawings';
import { ecoFilterOf } from '@/domain/eco';
import { parsePlmState, plmKpis, plmRows } from '@/domain/parts';
import { getDrawingsScreen, getEcoScreen } from '@/server/dal/eco-screen';
import { listVaultDocuments } from '@/server/dal/documents';
import { getPlmCatalogue } from '@/server/dal/plm';
import { docFamily, documentStatus, drawingState, ecoStatus } from '@/server/db/codes';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, compact, filterLine, kpiSheet, param, pricedWorkbook, sheet } from './common';
import { projectFilter } from './scope';
import { dataText } from '@/i18n/data-text';

// ── Documents (Codex index) ──────────────────────────────────────────────────────────────────────────────────────────
async function docsWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const [docs, visible] = await Promise.all([listVaultDocuments(), projectFilter(ctx)]);
  // A client exports the documents shared with them on their organisation's projects (P-10a, P-10b).
  const own = docs.filter((d) => visible(d.project) && (ctx.viewer.role !== 'client' || d.shared));
  const numbers = (param(ctx, 'numbers') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  const query = {
    scope: parseScope(param(ctx, 'scope')), project: ctx.project.code, view: parseView(param(ctx, 'view')), family: parseFamily(param(ctx, 'fam')),
    status: parseStatus(param(ctx, 'status')), q: (param(ctx, 'q') ?? '').slice(0, 120),
  };
  const { scoped, list } = vaultList(own, query, (d) => `${dataText(d.title, ctx.lang)} ${t(d.typeLabel)} ${t(d.tagsText)}`);
  const rows = numbers.length ? own.filter((d) => numbers.includes(d.number)) : list;
  return {
    title: t('Documents — Codex index'),
    filters: numbers.length ? [`${t('Selection')}: ${rows.length}`] : compact([
      `${t('Scope')}: ${t(query.scope === 'all' ? 'All projects' : 'Current project')}`, query.view !== 'all' ? filterLine(t('View'), query.view) : null,
      query.family ? filterLine(t('Family'), t(docFamily.label(query.family))) : null, query.status ? filterLine(t('Status'), t(documentStatus.label(query.status))) : null,
      filterLine(t('Search'), query.q),
    ]),
    sheets: [
      sheet(t('Register'), [
        col('number', t('Document'), 'text', 18), col('title', t('Title'), 'text', 40), col('type', t('Type'), 'text', 20), col('family', t('Family'), 'text', 16),
        col('project', t('Project'), 'text', 10), col('service', t('Service'), 'text', 18), col('revision', t('Revision'), 'text', 8), col('status', t('Status'), 'text', 16),
        col('issued', t('Issued on'), 'date'), col('author', t('Author'), 'text', 14), col('confidentiality', t('Confidentiality'), 'text', 14), col('tags', t('Tags'), 'text', 24),
        col('shared', t('Shared with the client'), 'boolean'), col('acknowledged', t('Acknowledged'), 'boolean'), col('next', t('Next approver'), 'text', 18),
        col('links', t('Relations'), 'text', 30), col('retention', t('Retention'), 'text', 14), col('iso', 'ISO 9001', 'text', 8),
      ], rows.map((d) => ({
        number: d.number, title: dataText(d.title, ctx.lang), type: t(d.typeLabel), family: t(d.familyLabel), project: d.project, service: t(d.serviceLabel), revision: d.revision, status: t(d.statusLabel),
        issued: d.issuedOn, author: d.author, confidentiality: t(d.confidentialityLabel), tags: d.tags.map((x) => t(x)).join(' · '), shared: d.shared, acknowledged: d.acknowledged,
        next: d.nextRoleLabel ? `${t(d.nextRoleLabel)}${d.nextApprover ? ' · ' + d.nextApprover : ''}` : '', links: d.links.map((l) => `${t(l.kindLabel)} ${l.ref}`).join(' · '),
        retention: t(d.retention), iso: d.isoClause,
      }))),
      kpiSheet(ctx, vaultKpis(scoped).map((k) => ({ label: t(k.label), value: String(k.value), sub: t(k.sub) }))),
    ],
  };
}

// ── Parts (PLM) ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function plmWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const cat = await getPlmCatalogue();
  const p = (k: string) => param(ctx, k) ?? undefined;
  const state = parsePlmState({ q: p('q'), type: p('type'), status: p('status'), pu: p('pu'), mb: p('mb'), restr: p('restr'), sort: p('sort'), dir: p('dir') });
  const rows = plmRows(cat.parts, state, (x) => dataText(x.name, ctx.lang));
  return {
    title: t('PLM — parts catalogue'),
    filters: compact([filterLine(t('Search'), state.filter.q)]),
    sheets: [
      sheet(t('Parts'), [
        col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 36), col('type', t('Type'), 'text', 14), col('makeBuy', t('Make / buy'), 'text', 12),
        col('status', t('Status'), 'text', 14), col('revision', t('Revision'), 'text', 8), col('pu', 'PU / PR', 'text', 16), col('unit', t('Unit'), 'text', 6),
        col('price', t('List price'), 'money_eur'), col('lastPrice', t('Last price'), 'money_eur'), col('lead', t('Lead time (weeks)'), 'integer'), col('mfr', t('Manufacturer'), 'text', 20),
        col('mfrRef', t('Manufacturer ref.'), 'text', 16), col('hs', t('HS code'), 'text', 10), col('restriction', t('Export restriction'), 'text', 18), col('eco', t('Open ECO'), 'text', 12),
      ], rows.map((x) => ({
        ref: x.ref, name: dataText(x.name, ctx.lang), type: t(x.typeLabel), makeBuy: t(x.makeBuyLabel), status: t(x.statusLabel), revision: x.revision ?? '', pu: x.wearSpareLabel ? t(x.wearSpareLabel) : '',
        unit: x.unit, price: x.listPriceEur, lastPrice: x.lastPriceEur, lead: x.leadWeeks, mfr: x.manufacturer ?? '', mfrRef: x.manufacturerRef ?? '', hs: x.hsCode ?? '',
        restriction: x.exportRestriction ? t(x.exportRestriction) : '', eco: cat.openEco[x.ref] ?? '',
      }))),
      kpiSheet(ctx, plmKpis(cat.parts).map((k) => ({ label: t(k.label), value: String(k.value), sub: t(k.sub) }))),
    ],
  };
}

// ── ECO (Vigie mirror) ───────────────────────────────────────────────────────────────────────────────────────────────
async function ecoWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const [data, visible] = await Promise.all([getEcoScreen({ name: ctx.viewer.name, role: ctx.viewer.role }, null), projectFilter(ctx)]);
  const status = ecoFilterOf(param(ctx, 'status'));
  const ecos = data.ecos.filter((e) => (!status || e.status === status) && (ctx.viewer.role !== 'client' || e.projects.some((c) => visible(c))));
  return {
    title: t('Engineering change orders'),
    filters: compact([status ? `${t('Status')}: ${t(ecoStatus.label(status))}` : null]),
    sheets: [
      sheet(t('Change orders'), [
        col('number', 'ECO', 'text', 14), col('title', t('Title'), 'text', 40), col('type', t('Type'), 'text', 14), col('status', t('Status'), 'text', 16), col('from', t('From revision'), 'text', 8),
        col('to', t('To revision'), 'text', 8), col('cost', t('Cost'), 'money_eur'), col('days', t('Schedule impact (d)'), 'integer'), col('stock', t('Stock impact'), 'text', 24),
        col('parts', t('Parts'), 'text', 24), col('projects', t('Projects'), 'text', 18), col('requestedBy', t('Requested by'), 'text', 16), col('raised', t('Raised on'), 'date'),
        col('approvals', t('Approvals'), 'text', 40), col('vigie', 'Vigie', 'text', 40),
      ], ecos.map((e) => ({
        number: e.number, title: dataText(e.title, ctx.lang), type: t(e.typeLabel), status: t(e.statusLabel), from: e.fromRevision, to: e.toRevision, cost: e.costEur, days: e.scheduleDays, stock: t(e.stockImpact),
        parts: e.parts.join(' · '), projects: e.projects.filter((c) => visible(c)).join(' · '), requestedBy: e.requestedBy, raised: e.raisedOn,
        approvals: e.approvals.map((a) => `${a.key}: ${a.decision}`).join(' · '), vigie: e.vigieUrl,
      }))),
    ],
  };
}

// ── Drawings (PDM vault) ─────────────────────────────────────────────────────────────────────────────────────────────
async function drawingsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const data = await getDrawingsScreen(null);
  const state = drawingFilterOf(param(ctx, 'state'));
  const q = (param(ctx, 'q') ?? '').slice(0, 120);
  return {
    title: t('Drawings — PDM vault'),
    filters: compact([state ? `${t('Status')}: ${t(drawingState.label(state))}` : null, filterLine(t('Search'), q)]),
    sheets: [
      sheet(t('Drawings'), [
        col('number', t('Drawing'), 'text', 16), col('title', t('Title'), 'text', 40), col('part', t('Part'), 'text', 16), col('revision', t('Revision'), 'text', 8),
        col('state', t('Status'), 'text', 14), col('by', t('Checked in by'), 'text', 16), col('on', t('Checked in on'), 'date'), col('eco', 'ECO', 'text', 14), col('formats', t('Formats'), 'text', 18),
        col('file', t('Vault file'), 'text', 44),
      ], filterDrawings(data.drawings, state, q).map((d) => ({
        number: d.number, title: dataText(d.title, ctx.lang), part: d.partRef ?? '', revision: d.revision, state: t(d.stateLabel), by: d.checkedInBy, on: d.checkedInOn, eco: d.ecoNumber ?? '', formats: d.formats, file: d.vaultFile,
      }))),
    ],
  };
}

registerExportProvider({ screen: 'docs', table: docsWorkbook, fileBase: () => 'documents-register' });
// R-046 (NEW-D2-1): catalogue and last prices only for the director, the PMs and procurement.
registerExportProvider({ screen: 'plm', table: pricedWorkbook(plmWorkbook), fileBase: () => 'parts' });
registerExportProvider({ screen: 'eco', table: ecoWorkbook, fileBase: () => 'eco' });
registerExportProvider({ screen: 'drawings', table: drawingsWorkbook });
