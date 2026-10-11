// Export providers — Project engineering: Synthesis and the four discipline screens, P&ID validation, Project BOM.
// Engineering: deliverables, consistency checks (the discipline screens keep their checks and the `?status=` chip),
// inputs and outputs. P&ID: the tag register with the screen's filters (`?status=`, `?scope=`, `?q=`), the overlay list
// and the validation steps; "Export overlay list" = a PDF to agree and sign with the client. BOM: the flat list with its
// filters and sort (`?q=`, `?type=`, `?mfr=`, `?sort=`), the PU/PR list of the selected system (`?sys=`, `?kind=`), and
// the "Export list" PDF of that recommended wear & spare parts list.
import { filterBomLines, filterSpares, sortBomLines, bomSupplierOptions, bomTypeOptions } from '@/domain/bom';
import { SCREEN_OF_DISCIPLINE, checkFilterOf } from '@/domain/engineering';
import { filterPidTags, overlayTags } from '@/domain/pid';
import { SCREEN_BY_ID, type ScreenId } from '@/config/screens';
import { parseBomState } from '@/features/bom/links';
import { parsePidState } from '@/features/pid/links';
import { getBomScreen } from '@/server/dal/bom-screen';
import { getEngineeringRegister } from '@/server/dal/engineering';
import { getPidValidation } from '@/server/dal/pid';
import { DISCIPLINES, type Discipline } from '@/server/db/codes';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfDocument } from '../types';
import { col, compact, filterLine, kpiSheet, paramRecord, projectRef, sheet, sum, tableBlock, todayIso } from './common';
import { dataText } from '@/i18n/data-text';

// ── Engineering ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function engWorkbook(ctx: ExportContext, disc: Discipline | null): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const reg = await getEngineeringRegister(ctx.project.code);
  if (!reg) return null;
  const { t } = ctx;
  const filter = checkFilterOf(ctx.params.get('status'));
  const discLabel = new Map(reg.disciplines.map((d) => [d.code, d.label]));
  const checks = reg.checks.filter((c) => !disc || c.owner === disc || c.rulePair.split('-').includes(disc))
    .filter((c) => !disc || filter === 'all' || (filter === 'open' ? c.open : c.status === filter));
  const sheets: ExportSheet[] = [
    sheet(t('Consistency checks'), [
      col('number', t('Consistency check'), 'text', 9), col('rule', t('Rule'), 'text', 28), col('severity', t('Severity'), 'text', 12), col('title', t('Title'), 'text', 40),
      col('detail', t('Details'), 'text', 50), col('owner', t('Owner'), 'text', 14), col('lead', t('Lead'), 'text', 16), col('status', t('Status'), 'text', 12), col('note', t('Note'), 'text', 30),
    ], checks.map((c) => ({
      number: c.number, rule: t(c.ruleLabel), severity: t(c.severityLabel), title: t(c.title), detail: t(c.detail), owner: t(c.ownerLabel), lead: c.lead, status: t(c.statusLabel), note: t(c.note),
    }))),
    sheet(t('Deliverables'), [
      col('number', t('Document'), 'text', 18), col('title', t('Title'), 'text', 40), col('discipline', t('Discipline'), 'text', 14), col('revision', t('Revision'), 'text', 8),
      col('status', t('Status'), 'text', 14), col('issued', t('Issued on'), 'date'), col('author', t('Author'), 'text', 16), col('blocking', t('Blocking checks'), 'integer'),
    ], reg.deliverables.filter((d) => !disc || d.discipline === disc).map((d) => ({
      number: d.number, title: dataText(d.title, ctx.lang), discipline: t(discLabel.get(d.discipline) ?? d.discipline), revision: d.revision, status: t(d.statusLabel), issued: d.issuedOn || null,
      author: d.author, blocking: d.blockingChecks,
    }))),
    sheet(t('Inputs'), [
      col('consumer', t('Used by'), 'text', 14), col('number', t('Document'), 'text', 18), col('title', t('Title'), 'text', 40), col('provider', t('Provided by'), 'text', 16),
      col('inUse', t('Revision in use'), 'text', 10), col('latest', t('Latest'), 'text', 8), col('state', t('Status'), 'text', 14), col('acknowledged', t('Acknowledged'), 'boolean'),
    ], reg.inputs.filter((i) => !disc || i.consumer === disc).map((i) => ({
      consumer: t(discLabel.get(i.consumer) ?? i.consumer), number: i.documentNumber, title: dataText(i.title, ctx.lang), provider: t(i.providerLabel), inUse: i.revisionInUse, latest: i.latest,
      state: t(i.stateLabel), acknowledged: i.acknowledged,
    }))),
    sheet(t('Outputs'), [
      col('number', t('Output'), 'text', 10), col('discipline', t('Discipline'), 'text', 14), col('name', t('Name'), 'text', 40), col('source', t('Source'), 'text', 24),
      col('state', t('Status'), 'text', 12), col('generated', t('Generated on'), 'datetime'), col('format', t('Format'), 'text', 8),
    ], reg.outputs.filter((o) => !disc || o.discipline === disc).map((o) => ({
      number: o.number, discipline: t(discLabel.get(o.discipline) ?? o.discipline), name: dataText(o.name, ctx.lang), source: t(o.source), state: t(o.stateLabel), generated: o.generatedAt, format: o.generatedFormat ?? '',
    }))),
  ];
  if (!disc) sheets.push(sheet(t('Changes'), [col('date', t('Date'), 'date'), col('text', t('Change'), 'text', 70)], reg.changes.map((c) => ({ date: c.changedOn, text: dataText(c.text, ctx.lang) }))));
  return {
    title: t(SCREEN_BY_ID[disc ? SCREEN_OF_DISCIPLINE[disc] : 'eng'].title),
    filters: compact([disc && filter !== 'all' ? `${t('Status')}: ${t(filter === 'open' ? 'Open' : filter === 'sent_back' ? 'Sent back' : 'Resolved')}` : null]),
    sheets,
  };
}

// ── P&ID ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function pidData(ctx: ExportContext) {
  return ctx.project ? getPidValidation(ctx.project.code) : null;
}

const tagColumns = (t: (s: string) => string) => [
  col('tag', t('Tag'), 'text', 10), col('description', t('Description'), 'text', 36), col('kind', t('Type'), 'text', 14), col('scope', t('Supplied by'), 'text', 12),
  col('ref', t('BOM reference'), 'text', 16), col('part', t('Article'), 'text', 30), col('activity', t('Activity'), 'text', 10), col('plc', 'PLC', 'text', 12),
  col('feedback', t('State feedback'), 'text', 14), col('status', t('Status'), 'text', 16), col('sheet', t('Sheet'), 'integer', 6),
];

async function pidWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const data = await pidData(ctx);
  if (!data) return null;
  const { t } = ctx;
  const state = parsePidState(paramRecord(ctx));
  const row = (x: (typeof data.tags)[number]) => ({
    tag: x.tag, description: dataText(x.description, ctx.lang), kind: t(x.kindLabel), scope: t(x.scopeLabel), ref: x.partRef ?? '', part: x.partName ? dataText(x.partName, ctx.lang) : '', activity: x.activityCode,
    plc: x.plcLabel ? t(x.plcLabel) : '', feedback: t(x.stateFeedback), status: t(x.statusLabel), sheet: x.sheet,
  });
  return {
    title: t('P&ID — tags, overlay & process validation'),
    filters: compact([filterLine(t('Status'), state.status), filterLine(t('Scope'), state.scope), filterLine(t('Search'), state.q)]),
    sheets: [
      sheet(t('Tags'), tagColumns(t), filterPidTags(data.tags, { status: state.status, scope: state.scope, q: state.q }).map(row)),
      sheet(t('Overlay'), tagColumns(t), overlayTags(data.tags).map(row)),
      sheet(t('Validation steps'), [col('step', t('Step'), 'text', 34), col('state', t('Status'), 'text', 14), col('date', t('Date'), 'date'), col('who', t('By'), 'text', 18)],
        data.steps.map((s) => ({ step: t(s.label), state: t(s.stateLabel), date: s.dateOn, who: s.who }))),
      kpiSheet(ctx, [
        { label: t('P&ID'), value: `${data.sheet.documentNumber} ${data.sheet.revision}`, sub: `${t(data.sheet.statusLabel)} · ${t('Sheets')} ${data.sheet.sheetCount}` },
        { label: t('Tags in scope'), value: String(data.coverage.inScope), sub: `${t('Linked')} ${data.coverage.linked} · ${data.coverage.pct}%` },
        { label: t('Unmapped'), value: String(data.coverage.unmapped) }, { label: t('Reference issues'), value: String(data.coverage.referenceIssues) },
        { label: t('Overlay'), value: String(data.coverage.overlay), sub: `${t('Client')} ${data.coverage.client}` },
      ]),
    ],
  };
}

/** Overlay list (PDF): client equipment secured by Keystone, agreed and signed with the client. */
async function overlayDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  const data = await pidData(ctx);
  if (!data || !ctx.project) return null;
  const { t } = ctx;
  const rows = overlayTags(data.tags);
  return {
    title: t('Overlay list — client equipment secured by Keystone'),
    subtitle: `${data.sheet.documentNumber} ${t('rev.')} ${data.sheet.revision}`,
    project: projectRef(ctx),
    reference: data.sheet.documentNumber,
    date: todayIso(ctx),
    blocks: [
      { kind: 'paragraph', text: t('The client supplies the equipment, Keystone supplies and wires the instruments · this list is agreed and signed with the client') },
      { kind: 'table', sheet: sheet(t('Overlay'), [col('tag', t('Tag'), 'text', 10), col('description', t('Description'), 'text', 38), col('scope', t('Supplied by'), 'text', 12), col('ref', t('BOM reference'), 'text', 16), col('status', t('Status'), 'text', 14)],
        rows.map((x) => ({ tag: x.tag, description: dataText(x.description, ctx.lang), scope: t(x.scopeLabel), ref: x.partRef ?? '—', status: t(x.statusLabel) }))) },
      { kind: 'spacer', height: 12 },
      { kind: 'signatures', parties: [{ role: t('Keystone — project manager'), name: ctx.project.pm }, { role: t('Client') }] },
    ],
    footnote: t('Tags extracted from the P&ID revision named above; the Codex record stays the reference.'),
  };
}

// ── BOM ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function bomWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const state = parseBomState(paramRecord(ctx));
  const data = await getBomScreen(ctx.project.code, { view: state.view === 'spares' ? 'spares' : state.view === 'compare' ? 'compare' : state.view === 'tree' ? 'tree' : 'flat', system: state.sys });
  if (!data) return null;
  const { t } = ctx;
  const lines = data.bom.lines;
  const type = bomTypeOptions(lines).some((o) => o.value === state.type) ? state.type : null;
  const mfr = bomSupplierOptions(lines).some((o) => o.value === state.mfr) ? state.mfr : null;
  const shown = sortBomLines(filterBomLines(lines, { q: state.q, type, mfr }), state.sort);
  const flat = sheet(t('Articles'), [
    col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 36), col('type', t('Type'), 'text', 14), col('makeBuy', t('Make / buy'), 'text', 12),
    col('scope', t('Scope'), 'text', 12), col('qty', t('Quantity'), 'number', 9), col('unit', t('Unit'), 'text', 6), col('price', t('List price'), 'money_eur'),
    col('total', t('Total'), 'money_eur'), col('mfr', t('Manufacturer'), 'text', 20), col('mfrRef', t('Manufacturer ref.'), 'text', 16), col('revision', t('Revision'), 'text', 8),
    col('status', t('Status'), 'text', 14), col('lead', t('Lead time (weeks)'), 'integer'), col('hs', t('HS code'), 'text', 10), col('restriction', t('Export restriction'), 'text', 18),
    col('eco', t('Open ECO'), 'text', 10),
  ], shown.map((l) => ({
    ref: l.ref, name: dataText(l.name, ctx.lang), type: t(l.typeLabel), makeBuy: t(l.makeBuyLabel), scope: t(l.scopeLabel), qty: l.quantity, unit: l.unit, price: l.listPriceEur, total: l.totalEur,
    mfr: l.manufacturer ?? '', mfrRef: l.manufacturerRef ?? '', revision: l.revision ?? '', status: t(l.statusLabel), lead: l.leadWeeks, hs: l.hsCode ?? '',
    restriction: l.exportRestriction ? t(l.exportRestriction) : '', eco: l.openEco ?? '',
  })));
  const sheets: ExportSheet[] = [flat];
  if (data.spares) {
    const sp = spareSheet(ctx, data.spares, state.kind);
    if (state.view === 'spares') sheets.unshift(sp);
    else sheets.push(sp);
  }
  if (data.assembly) {
    sheets.splice(state.view === 'tree' ? 0 : sheets.length, 0, sheet(t('Assembly tree'), [
      col('level', t('Level'), 'integer', 6), col('ref', t('Reference'), 'text', 18), col('name', t('Article'), 'text', 36), col('qty', t('Qty per parent'), 'number', 9),
      col('extended', t('Total units'), 'number', 9), col('unit', t('Unit cost'), 'money_eur'), col('extendedCost', t('Extended cost'), 'money_eur'), col('status', t('Status'), 'text', 14),
    ], data.assembly.rows.map((n) => ({ level: n.depth, ref: n.ref, name: dataText(n.name, ctx.lang), qty: n.qty, extended: n.extended, unit: n.unitCostEur, extendedCost: n.extendedCostEur, status: t(n.statusLabel) }))));
  }
  if (data.comparison) {
    const c = data.comparison;
    sheets.splice(state.view === 'compare' ? 0 : sheets.length, 0, sheet(`${t('Compare')} ${c.fromRevision}-${c.toRevision}`, [
      col('path', t('Path'), 'text', 40), col('name', t('Article'), 'text', 30), col('from', c.fromRevision, 'number', 8), col('to', c.toRevision, 'number', 8),
      col('kind', t('Change'), 'text', 12), col('price', t('Last price'), 'money_eur'), col('delta', t('Cost delta'), 'money_eur'),
    ], c.lines.map((l) => ({ path: l.path, name: dataText(l.name, ctx.lang), from: l.qtyFrom, to: l.qtyTo, kind: t(l.kindLabel), price: l.lastPriceEur, delta: l.deltaEur }))));
  }
  const s = data.bom.summary;
  sheets.push(kpiSheet(ctx, [
    { label: t('Articles'), value: String(s.articles), sub: `${s.units} ${t('units in total')}` }, { label: t('BOM value'), value: `${Math.round(s.valueEur)} €` },
    { label: t('Not validated'), value: String(s.notValidated) }, { label: t('Outdated or obsolete'), value: String(s.outdatedOrObsolete) },
    { label: t('Export-restricted'), value: String(s.exportRestricted) },
  ]));
  return {
    title: t('Project BOM — equipment & parts'),
    filters: compact([filterLine(t('Search'), state.q), filterLine(t('Type'), type), filterLine(t('Manufacturer'), mfr), state.sys ? filterLine(t('System'), data.spares?.systemName ?? state.sys) : null]),
    sheets,
  };
}

function spareSheet(ctx: ExportContext, list: NonNullable<Awaited<ReturnType<typeof getBomScreen>>>['spares'] & object, kind: 'PU' | 'PR' | null): ExportSheet {
  const { t } = ctx;
  return sheet(t('Wear & spare parts'), [
    col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 36), col('kind', 'PU / PR', 'text', 6), col('perSystem', t('Qty per system'), 'number', 8),
    col('recommended', t('Recommended qty'), 'number', 10), col('inStock', t('In stock'), 'number', 8), col('price', t('Last price'), 'money_eur'), col('total', t('Total'), 'money_eur'),
    col('lead', t('Lead time (weeks)'), 'integer'), col('status', t('Status'), 'text', 14), col('underChange', t('Under change'), 'boolean'), col('note', t('Note'), 'text', 30),
  ], filterSpares(list.rows, kind).map((r) => ({
    ref: r.ref, name: dataText(r.name, ctx.lang), kind: r.kind, perSystem: r.qtyPerSystem, recommended: r.recommendedQty, inStock: r.inStock, price: r.lastPriceEur, total: r.totalEur, lead: r.leadWeeks,
    status: t(r.statusLabel), underChange: r.underChange, note: r.note ? dataText(r.note, ctx.lang) : '',
  })));
}

/** "Export list" (PDF): recommended wear & spare parts of the selected system, with quantities and value. */
async function sparesDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const state = parseBomState(paramRecord(ctx));
  const data = await getBomScreen(ctx.project.code, { view: 'spares', system: state.sys });
  if (!data?.spares) return null;
  const { t } = ctx;
  const s = spareSheet(ctx, data.spares, state.kind);
  return {
    title: `${t('Recommended wear & spare parts')} — ${dataText(data.spares.systemName, ctx.lang)}`,
    subtitle: `${data.spares.systemQty} × ${data.spares.system}`,
    project: projectRef(ctx),
    reference: data.spares.system,
    date: todayIso(ctx),
    landscape: true,
    blocks: [
      { kind: 'paragraph', text: t('Linked to the system in the catalogue · handed over with the equipment · stock checked against recommended quantity') },
      tableBlock(s, ['ref', 'name', 'kind', 'perSystem', 'recommended', 'inStock', 'price', 'total', 'lead', 'status'], { name: t('Total'), total: sum(s.rows, 'total') }),
    ],
    footnote: t('PU = wear part · PR = spare part. Prices are last purchase prices in euros, excluding VAT.'),
  };
}

registerExportProvider({ screen: 'eng', table: (ctx) => engWorkbook(ctx, null), fileBase: () => 'engineering' });
for (const d of DISCIPLINES) {
  const screen = SCREEN_OF_DISCIPLINE[d] as ScreenId;
  registerExportProvider({ screen, table: (ctx) => engWorkbook(ctx, d) });
}
registerExportProvider({ screen: 'pid', table: pidWorkbook, documents: { overlay: overlayDocument } });
registerExportProvider({ screen: 'bom', table: bomWorkbook, documents: { spares: sparesDocument } });
