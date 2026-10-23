// Export providers — project control: Risk register, Change control & baselines, Quality (NCR & deliverables), Inspection
// & test plan · punch list.
// Risks: the register sorted by score with the category chip (`?filter=`), PDF = risk register report. Changes: change
// requests with the type chip (`?filter=`), their approval chains and the baselines. Quality: NCRs (Vigie mirror — the 8D
// stays in Vigie, the row carries its link) with the severity chip, deliverables with the status chip; `?tab=` puts the
// current register first; PDF document `pv` = the acceptance certificate ("PV de réception") of an accepted deliverable.
// ITP: inspections by system and the project's punch list (R-117: every origin, with its origin; `?view=` puts the current
// one first, `?origin=` filters the punch list as the screen does); the NCR column is left out for the client (P-10b).
import { filterCrs, parseCrFilter, withDerivedStatus } from '@/domain/change-control';
import { filterPunchByOrigin, punchOriginFilterOf } from '@/domain/itpcom';
import { deliverableFilterOf, ncrFilterOf, qualityTabOf } from '@/domain/quality';
import { parseCategory, riskKpis } from '@/domain/risk';
import { changesT } from '@/features/changes/i18n';
import { getChangeControl } from '@/server/dal/changes';
import { getContract } from '@/server/dal/contract';
import { getBaselineRegister } from '@/server/dal/changes-baselines';
import { getItpPlans, listPunchItems } from '@/server/dal/itp';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import { getQualityScreen } from '@/server/dal/quality-screen';
import { getRiskScreen } from '@/server/dal/risks-screen';
import { changeStatus, deliverableStatus, ncrSeverity, stepDecision } from '@/server/db/codes';
import { formatDate } from '../format';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfDocument } from '../types';
import { col, compact, filterLine, kpiSheet, param, projectRef, sheet, tableBlock, todayIso } from './common';
import { dataText } from '@/i18n/data-text';

// ── Risks ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function riskSheets(ctx: ExportContext) {
  if (!ctx.project) return null;
  const data = await getRiskScreen(ctx.project.code);
  if (!data) return null;
  const { t } = ctx;
  const category = parseCategory(param(ctx, 'filter'), data.register.categories.map((c) => c.code));
  const risks = data.register.risks.filter((r) => !category || r.category === category).sort((a, b) => b.score - a.score);
  const register = sheet(t('Risk register'), [
    col('id', t('Risk'), 'text', 7), col('title', t('Title'), 'text', 40), col('category', t('Category'), 'text', 20), col('p', 'P', 'integer', 4), col('i', 'I', 'integer', 4),
    col('score', t('Score'), 'integer', 6), col('level', t('Level'), 'text', 10), col('owner', t('Owner'), 'text', 18), col('response', t('Response'), 'text', 10),
    col('plan', t('Response plan'), 'text', 44), col('activity', t('Activity'), 'text', 10), col('emv', 'EMV', 'money_keur'), col('costIfOccurs', t('Cost if it occurs'), 'money_keur'),
    col('trigger', t('Trigger'), 'text', 30), col('status', t('Status'), 'text', 8),
  ], risks.map((r) => ({
    id: r.id, title: dataText(r.title, ctx.lang), category: t(r.categoryLabel), p: r.probability, i: r.impact, score: r.score, level: t(r.levelLabel), owner: r.owner ?? '', response: t(r.responseLabel),
    plan: t(r.plan), activity: r.activity?.code ?? '', emv: r.emv || null, costIfOccurs: r.costIfOccurs, trigger: t(r.trigger), status: t(r.statusLabel),
  })));
  const k = riskKpis(data.register.risks, data.contingency);
  const kpis = kpiSheet(ctx, [
    { label: t('Open risks'), value: String(k.open), sub: `${k.closed} ${t('closed')}` },
    { label: t('Exposure (open risks EMV)'), value: `${k.exposure} k€`, sub: `${t('Contingency')} ${data.contingency} k€` },
  ]);
  const catLabel = category ? data.register.categories.find((c) => c.code === category)?.label ?? category : null;
  return { register, kpis, filters: compact([filterLine(t('Category'), catLabel ? t(catLabel) : null)]), open: k.open, exposure: k.exposure, contingency: data.contingency };
}

async function risksWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const r = await riskSheets(ctx);
  return r && { title: ctx.t('Risk register'), filters: r.filters, sheets: [r.register, r.kpis] };
}

async function risksReport(ctx: ExportContext): Promise<PdfDocument | null> {
  const r = await riskSheets(ctx);
  if (!r) return null;
  const { t } = ctx;
  return {
    title: t('Risk register'),
    subtitle: r.filters.join(' · ') || undefined,
    project: projectRef(ctx),
    reference: ctx.project!.code,
    date: todayIso(ctx),
    landscape: true,
    blocks: [
      { kind: 'kpis', items: [{ label: t('Open risks'), value: String(r.open) }, { label: t('Exposure (open risks EMV)'), value: `${r.exposure} k€` }, { label: t('Contingency'), value: `${r.contingency} k€` }] },
      tableBlock(r.register, ['id', 'title', 'category', 'score', 'level', 'owner', 'response', 'plan', 'emv', 'status']),
    ],
    footnote: t('Score = probability × impact (1–5 each). EMV in thousands of euros (k€).'),
  };
}

// ── Change control & baselines ───────────────────────────────────────────────────────────────────────────────────────
async function changesWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const [cc, baselines] = await Promise.all([getChangeControl(ctx.project.code), getBaselineRegister(ctx.project.code)]);
  if (!cc) return null;
  const t = changesT(ctx.t, ctx.lang);
  const filter = parseCrFilter(param(ctx, 'filter'));
  const crs = filterCrs(withDerivedStatus(cc.changeRequests), filter);
  return {
    title: t('Change control & baselines'),
    filters: compact([filter !== 'all' ? `${t('Type')}: ${t(filter.charAt(0).toUpperCase() + filter.slice(1))}` : null]),
    sheets: [
      sheet(t('Change requests'), [
        col('id', t('Change'), 'text', 8), col('title', t('Title'), 'text', 40), col('types', t('Type'), 'text', 18), col('amount', t('Amount'), 'money_keur'), col('days', t('Days'), 'integer'),
        col('status', t('Status'), 'text', 12), col('by', t('Requested by'), 'text', 18), col('date', t('Date'), 'date'), col('baseline', t('Baseline'), 'text', 8),
        col('wbs', 'WBS', 'text', 30), col('justification', t('Justification'), 'text', 50),
      ], crs.map((c) => ({
        id: c.id, title: dataText(c.title, ctx.lang), types: t(c.typesLabel), amount: c.amount, days: c.days, status: t(changeStatus.label(c.status)), by: dataText(c.by, ctx.lang), date: c.requestedOn, baseline: c.baseline ?? '',
        wbs: c.wbs.map((w) => `${w.code}${w.name ? ' ' + dataText(w.name, ctx.lang) : ''}`).join(' · '), justification: c.justification ? dataText(c.justification, ctx.lang) : '',
      }))),
      sheet(t('Approval chain'), [
        col('id', t('Change'), 'text', 8), col('step', t('Step'), 'text', 20), col('approver', t('Approver'), 'text', 20), col('decision', t('Decision'), 'text', 10),
        col('by', t('Decided by'), 'text', 18), col('at', t('Decided on'), 'datetime'), col('comment', t('Comment'), 'text', 40),
      ], crs.flatMap((c) => c.chain.map((s) => ({
        id: c.id, step: t(s.label), approver: s.approver ? t(s.approver) : '', decision: s.decision ? t(stepDecision.label(s.decision)) : '', by: s.decidedBy ?? '', at: s.decidedAt, comment: s.comment ?? '',
      })))),
      sheet(t('Baselines'), [
        col('code', t('Baseline'), 'text', 8), col('name', t('Name'), 'text', 30), col('setOn', t('Set on'), 'date'), col('bac', 'BAC', 'money_keur'), col('finish', t('Finish'), 'date'),
        col('state', t('Status'), 'text', 12), col('cr', t('Change request'), 'text', 10),
      ], baselines.map((b) => ({ code: b.code, name: dataText(b.name, ctx.lang), setOn: b.setOnDate, bac: b.bac, finish: b.finishDate, state: t(b.stateLabel), cr: b.changeRequest ?? '' }))),
      kpiSheet(ctx, [
        { label: t('Original budget'), value: cc.originalBudget != null ? `${cc.originalBudget} k€` : '—' }, { label: 'BAC', value: `${cc.bac} k€` },
        { label: t('Contingency'), value: cc.contingency != null ? `${cc.contingency} k€` : '—' },
      ]),
    ],
  };
}

// ── Quality ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function qualityWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  // P-10b (R-043): a client exports the deliverables register only — no NCR sheet, no linked NCR numbers.
  const client = ctx.viewer.role === 'client';
  const screen = await getQualityScreen(ctx.project.code);
  const data = client ? { ...screen, ncrs: [], deliverables: screen.deliverables.map((d) => ({ ...d, linkedNcrs: [] })) } : screen;
  const severity = ncrFilterOf(param(ctx, 'filter'));
  const status = deliverableFilterOf(param(ctx, 'status'));
  const tab = qualityTabOf(param(ctx, 'tab')) ?? 'ncr';
  const ncrs: ExportSheet = sheet(t('Non-conformities'), [
    col('number', 'NCR', 'text', 9), col('title', t('Title'), 'text', 40), col('severity', t('Severity'), 'text', 10), col('source', t('Source'), 'text', 14), col('status', t('Status'), 'text', 18),
    col('activity', t('Activity'), 'text', 10), col('part', t('Part'), 'text', 14), col('deliverable', t('Deliverable'), 'text', 10), col('supplier', t('Supplier'), 'text', 18),
    col('raisedBy', t('Raised by'), 'text', 16), col('raisedOn', t('Raised on'), 'date'), col('owner', t('Owner'), 'text', 16), col('rootCause', t('Root cause'), 'text', 36),
    col('action', t('Corrective action'), 'text', 36), col('due', t('Due'), 'date'), col('cost', t('Cost'), 'money_keur'), col('iso', 'ISO 9001', 'text', 8),
    col('pending', t('Pending sync with Vigie'), 'text', 18), col('vigie', t('Vigie (8D)'), 'text', 40),
  ], data.ncrs.filter((n) => !severity || n.severity === severity).map((n) => ({
    number: n.number, title: dataText(n.title, ctx.lang), severity: t(n.severityLabel), source: t(n.sourceLabel), status: t(n.statusLabel), activity: n.activityCode ?? '', part: n.partRef ?? '',
    deliverable: n.deliverableNumber ?? '', supplier: n.supplierName ?? '', raisedBy: n.raisedBy, raisedOn: n.raisedOn, owner: n.owner, rootCause: dataText(n.rootCause, ctx.lang), action: dataText(n.action, ctx.lang),
    due: n.dueOn, cost: n.costKeur, iso: n.isoClause, pending: n.pendingSyncLabel ? t(n.pendingSyncLabel) : '', vigie: n.vigieUrl,
  })));
  const dlvs: ExportSheet = sheet(t('Deliverables'), [
    col('number', t('Deliverable'), 'text', 8), col('title', t('Title'), 'text', 40), col('type', t('Type'), 'text', 22), col('wbs', 'WBS', 'text', 24), col('due', t('Due'), 'date'),
    col('status', t('Status'), 'text', 16), col('revision', t('Revision'), 'text', 8), col('issue', t('Issue date'), 'date'), col('submitted', t('Submitted on'), 'date'),
    col('acceptBy', t('Acceptance due'), 'date'), col('accepted', t('Accepted on'), 'date'), col('acceptedBy', t('Accepted by'), 'text', 16), col('rejected', t('Rejected on'), 'date'),
    col('comments', t('Review comments'), 'text', 36), col('document', t('Document'), 'text', 16), col('ncrs', 'NCR', 'text', 14),
  ], data.deliverables.filter((d) => !status || d.status === status).map((d) => ({
    number: d.number, title: dataText(d.title, ctx.lang), type: t(d.typeLabel), wbs: `${d.wbsCode}${d.wbsName ? ' · ' + dataText(d.wbsName, ctx.lang) : ''}`, due: d.dueOn, status: t(d.statusLabel), revision: d.revision ?? '',
    issue: d.issueOn, submitted: d.submittedOn, acceptBy: d.acceptanceDueOn, accepted: d.acceptedOn, acceptedBy: d.acceptedBy ?? '', rejected: d.rejectedOn,
    comments: d.reviewComments ? t(d.reviewComments) : '', document: d.documentNumber ?? '', ncrs: d.linkedNcrs.join(' · '),
  })));
  return {
    title: t('Quality — NCR & deliverables'),
    filters: compact([severity ? `${t('Severity')}: ${t(ncrSeverity.label(severity))}` : null, status ? `${t('Status')}: ${t(deliverableStatus.label(status))}` : null]),
    sheets: client ? [dlvs] : tab === 'dlv' ? [dlvs, ncrs] : [ncrs, dlvs],
  };
}

/** "PV de réception" — acceptance certificate of an accepted deliverable (`?variant=pv&id=D-014`). */
async function pvDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const id = (param(ctx, 'id') ?? '').toUpperCase();
  const [data, contract] = await Promise.all([getQualityScreen(ctx.project.code), getContract(ctx.project.code)]);
  const found = data.deliverables.find((x) => x.number.toUpperCase() === id);
  if (!found || found.status !== 'accepted') return null;
  // P-10b (R-043): the client's copy names no NCR.
  const d = ctx.viewer.role === 'client' ? { ...found, linkedNcrs: [] } : found;
  const { t } = ctx;
  const doc = d.documentNumber ? data.documents.find((x) => x.number === d.documentNumber) ?? null : null;
  const client = contract?.sheet.client ?? ctx.project.client;
  const fd = (iso: string | null) => (iso ? formatDate(iso, ctx.lang) : '—');
  return {
    title: t('Acceptance certificate (PV de réception)'),
    subtitle: `${d.number} · ${dataText(d.title, ctx.lang)}`,
    project: projectRef(ctx),
    reference: `PV ${d.number}`,
    date: d.acceptedOn ?? todayIso(ctx),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [t('Client'), dataText(client, ctx.lang)], [t('Contract'), contract?.sheet.reference ?? '—'], [t('Deliverable'), `${d.number} · ${dataText(d.title, ctx.lang)}`], [t('Type'), t(d.typeLabel)],
        ['WBS', `${d.wbsCode}${d.wbsName ? ' · ' + dataText(d.wbsName, ctx.lang) : ''}`], [t('Revision'), d.revision ?? '—'],
        [t('Issued document'), doc ? `${doc.number} · ${dataText(doc.title, ctx.lang)} · ${t('Rev')} ${doc.revision}` : d.documentNumber ?? '—'], [t('Submitted on'), fd(d.submittedOn)],
        [t('Accepted on'), fd(d.acceptedOn)], [t('Accepted by'), d.acceptedBy ?? '—'],
      ] },
      { kind: 'heading', text: t('Acceptance') },
      { kind: 'paragraph', text: t('The client accepts the deliverable named above as compliant with the contract.') },
      { kind: 'paragraph', text: d.reviewComments ? `${t('Reservations')}: ${t(d.reviewComments)}` : t('Accepted without reservation.') },
      ...(d.linkedNcrs.length ? [{ kind: 'paragraph' as const, text: `${t('Related non-conformities')}: ${d.linkedNcrs.join(', ')}`, muted: true }] : []),
      { kind: 'spacer', height: 18 },
      { kind: 'signatures', parties: [{ role: t('For the client'), name: d.acceptedBy ?? undefined }, { role: t('For Keystone — project manager'), name: ctx.project.pm }] },
    ],
    footnote: t('Acceptance recorded in Keystone; the signed PV is filed in Codex with the deliverable.'),
  };
}

// ── ITP ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function itpWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  // R-185 (choice 4): every equipment line's plan, with an Equipment column when the project has more than one line.
  const [plans, all, lines] = await Promise.all([getItpPlans(ctx.project.code), listPunchItems(ctx.project.code), listProjectEquipments(ctx.project.code)]);
  const plan = plans[0] ?? null;
  if (!plan && !all.length) return null;
  const { t } = ctx;
  const multi = lines.length > 1;
  const eqCol = multi ? [col('equipment', t('Equipment'), 'text', 10)] : [];
  const origin = punchOriginFilterOf(param(ctx, 'origin'));
  const punch = filterPunchByOrigin(all, origin);
  // P-10b: the client never gets Vigie's NCR numbers (the screen hides the column too).
  const internal = ctx.viewer.role !== 'client';
  const inspections = sheet(t('Inspection & test plan'), [
    col('number', t('Inspection'), 'text', 8), ...eqCol, col('system', t('System'), 'text', 24), col('name', t('Inspection'), 'text', 40), col('point', t('Point type'), 'text', 12),
    col('stage', t('Stage'), 'text', 14), col('reference', t('Reference'), 'text', 18), col('planned', t('Planned on'), 'date'), col('result', t('Result'), 'text', 12),
    col('record', t('Record'), 'text', 16), col('custom', t('Added'), 'boolean'),
  ], plans.flatMap((pl) => pl.inspections.map((i) => ({ i, eq: pl.equipment?.ref ?? '' }))).map(({ i, eq }) => ({
    number: i.number, ...(multi ? { equipment: eq } : {}), system: dataText(i.system, ctx.lang), name: dataText(i.name, ctx.lang), point: t(i.pointTypeLabel), stage: t(i.stageLabel), reference: i.reference, planned: i.plannedOn, result: t(i.resultLabel),
    record: i.recordRef ?? '', custom: i.isCustom,
  })));
  const punchList = sheet(t('Punch list'), [
    col('number', t('Item'), 'text', 8), col('description', t('Description'), 'text', 44), col('origin', t('Origin'), 'text', 12), ...eqCol,
    col('location', t('System / location'), 'text', 22),
    col('category', t('Category'), 'text', 8), col('source', t('Raised by'), 'text', 18), ...(internal ? [col('ncr', 'NCR', 'text', 9)] : []), col('owner', t('Owner'), 'text', 16),
    col('due', t('Due'), 'date'), col('status', t('Status'), 'text', 12),
  ], punch.map((p) => ({
    number: p.number, description: dataText(p.description, ctx.lang), origin: t(p.originLabel), ...(multi ? { equipment: p.equipmentRef ?? t('Common') } : {}), location: dataText(p.location, ctx.lang), category: p.categoryLabel ? t(p.categoryLabel) : '',
    source: p.sourceText ? t(p.sourceText) : '', ...(internal ? { ncr: p.ncrNumber ?? '' } : {}), owner: p.ownerName ? dataText(p.ownerName, ctx.lang) : p.owner ? t(p.owner) : '',
    due: p.dueOn, status: t(p.statusLabel),
  })));
  return {
    title: t('Inspection & test plan · punch list'),
    filters: compact([plan?.template ? `${t('Template')}: ${plan.template}` : null, origin !== 'all' ? `${t('Origin')}: ${t(origin === 'itp' ? 'Inspection' : 'Site')}` : null]),
    sheets: param(ctx, 'view') === 'punch' ? [punchList, inspections] : [inspections, punchList],
  };
}

registerExportProvider({ screen: 'risks', table: risksWorkbook, pdf: risksReport });
registerExportProvider({ screen: 'changes', table: changesWorkbook });
registerExportProvider({ screen: 'quality', table: qualityWorkbook, documents: { pv: pvDocument } });
registerExportProvider({ screen: 'itp', table: itpWorkbook });
