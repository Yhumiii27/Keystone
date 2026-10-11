// Export providers — Site & handover: Site (readiness, mobilisation & execution) and Commissioning & handover dossier.
// Site: the current tab first (`?tab=ready|team|exec`) — prerequisites and equipment with the Go chantier conditions,
// the team (Cursus go / no go verdicts — approvals only — rotation and collisions), execution (daily reports, punch list,
// HSE register mirrored from Vigie with its links, mission costs). Commissioning: the system × step grid, the handover
// dossier and the SAT plans.
import { siteTabOf } from '@/domain/site';
import { getCommissioning } from '@/server/dal/commissioning';
import { listPunchItems } from '@/server/dal/itp';
import { getSite } from '@/server/dal/site';
import { cursusClearance, cursusVaccination, cursusVerdict, cursusVisa } from '@/server/db/codes';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook } from '../types';
import { col, kpiSheet, param, sheet } from './common';
import { dataText, fieldsText } from '@/i18n/data-text';


async function siteWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const d = await getSite(ctx.project.code);
  if (!d) return null;
  const { t } = ctx;
  const tab = siteTabOf(param(ctx, 'tab'));
  const s = d.sheet;
  const ready: ExportSheet[] = [
    sheet(t('Prerequisites'), [
      col('title', t('Prerequisite'), 'text', 40), col('activity', t('Activity'), 'text', 30), col('needed', t('Needed by'), 'date'), col('status', t('Status'), 'text', 12),
      col('late', t('Late'), 'boolean'), col('evidence', t('Evidence'), 'text', 30),
    ], d.prerequisites.map((p) => ({ title: dataText(p.title, ctx.lang), activity: `${p.activityCode}${p.activityName ? ' · ' + dataText(p.activityName, ctx.lang) : ''}`, needed: p.neededBy, status: t(p.statusLabel), late: p.late, evidence: fieldsText(p.evidence, t, ctx.lang) }))),
    sheet(t('Equipment'), [col('name', t('Equipment'), 'text', 36), col('source', t('Source'), 'text', 18), col('status', t('Status'), 'text', 12), col('note', t('Note'), 'text', 36)],
      d.equipment.map((e) => ({ name: dataText(e.name, ctx.lang), source: t(e.sourceLabel), status: t(e.statusLabel), note: fieldsText(e.note, t, ctx.lang) }))),
  ];
  const team: ExportSheet[] = [
    sheet(t('Go / no go (Cursus)'), [
      col('person', t('Person'), 'text', 20), col('visa', t('Visa'), 'text', 14), col('vaccination', t('Vaccination'), 'text', 14), col('clearance', t('Clearances'), 'text', 14),
      col('note', t('Note'), 'text', 24), col('verdict', t('Verdict'), 'text', 14), col('received', t('Received'), 'datetime'),
    ], d.cursus.people.map((p) => ({
      person: p.personName, visa: t(cursusVisa.label(p.visa)), vaccination: t(cursusVaccination.label(p.vaccination)), clearance: t(cursusClearance.label(p.clearance)), note: t(p.clearanceNote),
      verdict: t(cursusVerdict.label(p.verdict)), received: p.receivedAt,
    }))),
    sheet(t('Rotation'), [
      col('person', t('Person'), 'text', 20), col('role', t('Role on site'), 'text', 20), col('from', t('From'), 'date'), col('to', t('To'), 'date'), col('lodging', t('Lodging'), 'text', 20),
      col('travel', t('Travel'), 'text', 20), col('rotation', t('Rotation'), 'integer'), col('collision', t('Collision'), 'boolean'),
    ], d.rotation.map((r) => ({ person: r.person, role: dataText(r.roleOnSite, ctx.lang), from: r.fromOn, to: r.toOn, lodging: dataText(r.lodging, ctx.lang), travel: dataText(r.travel, ctx.lang), rotation: r.rotationNo, collision: r.hasCollision }))),
    sheet(t('Collisions'), [col('person', t('Person'), 'text', 20), col('description', t('Description'), 'text', 40), col('kind', t('Type'), 'text', 14), col('fix', t('Proposed fix'), 'text', 36), col('resolved', t('Resolved'), 'boolean')],
      d.collisions.map((c) => ({ person: c.person, description: dataText(c.description, ctx.lang), kind: t(c.kindLabel), fix: dataText(c.proposedFix, ctx.lang), resolved: c.resolved }))),
  ];
  const exec: ExportSheet[] = [
    sheet(t('Daily reports'), [
      col('number', t('Report'), 'text', 10), col('date', t('Date'), 'date'), col('activity', t('Activity'), 'text', 30), col('pct', t('% complete'), 'percent'), col('text', t('Report'), 'text', 50),
      col('weather', t('Weather'), 'text', 12), col('headcount', t('Headcount'), 'integer'), col('hse', 'HSE', 'text', 14), col('author', t('Author'), 'text', 16), col('link', t('Linked to'), 'text', 12),
    ], d.dailyReports.map((r) => ({
      number: r.number, date: r.reportOn, activity: dataText(r.activity, ctx.lang), pct: r.percentComplete != null ? r.percentComplete / 100 : null, text: dataText(r.text, ctx.lang), weather: r.weatherLabel ? t(r.weatherLabel) : '',
      headcount: r.headcount, hse: r.hseIncidentLabel ? t(r.hseIncidentLabel) : '', author: r.author, link: r.linkRef ?? '',
    }))),
    sheet(t('Site punch list'), [col('number', t('Item'), 'text', 8), col('description', t('Description'), 'text', 44), col('owner', t('Owner'), 'text', 16), col('due', t('Due'), 'date'), col('status', t('Status'), 'text', 12)],
      d.punch.map((p) => ({ number: p.number, description: dataText(p.description, ctx.lang), owner: p.owner ? dataText(p.owner, ctx.lang) : '', due: p.dueOn, status: t(p.statusLabel) }))),
    sheet(t('HSE (Vigie)'), [col('ref', t('Reference'), 'text', 14), col('title', t('Item'), 'text', 36), col('status', t('Status'), 'text', 14), col('date', t('Date'), 'date'), col('vigie', 'Vigie', 'text', 40)],
      d.hse.map((h) => ({ ref: h.vigieRef ?? '', title: dataText(h.title, ctx.lang), status: t(h.statusText), date: h.dateOn, vigie: h.vigieUrl }))),
    sheet(t('Mission costs'), [col('name', t('Cost item'), 'text', 30), col('budget', t('Budget'), 'money_keur'), col('actual', t('Actual'), 'money_keur'), col('remaining', t('Remaining'), 'money_keur'), col('used', t('Used'), 'percent')],
      d.missionCosts.map((m) => ({ name: dataText(m.name, ctx.lang), budget: m.budgetKeur, actual: m.actualKeur, remaining: m.remainingKeur, used: m.usedPct / 100 }))),
  ];
  const facts = kpiSheet(ctx, [
    { label: t('Site'), value: dataText(s.site, ctx.lang), sub: t(s.country) }, { label: t('Start date'), value: s.startOn, sub: `${t('Finish')} ${s.endOn}` },
    { label: t('Days on site'), value: `${s.doneDays} / ${s.planDays}` }, { label: t('Working hours'), value: t(s.workingHours) }, { label: t('Client contact'), value: t(s.clientContact) },
    { label: t('Access constraints'), value: t(s.accessConstraints) },
    ...d.go.conditions.map((c) => ({ label: `${t('Go chantier')} · ${t(c.label)}`, value: t(c.ok ? 'Ready' : 'Open'), sub: t(c.sub) })),
  ], t('Site sheet'));
  const order = tab === 'team' ? [...team, ...ready, ...exec] : tab === 'exec' ? [...exec, ...ready, ...team] : [...ready, ...team, ...exec];
  return { title: t('Site — readiness, mobilisation & execution'), filters: [`${t('Tab')}: ${t(tab === 'team' ? 'Team' : tab === 'exec' ? 'Execution' : 'Readiness')}`], sheets: [...order, facts] };
}

async function commissioningWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const [d, punch] = await Promise.all([getCommissioning(ctx.project.code), listPunchItems(ctx.project.code, 'itp')]);
  if (!d) return null;
  const { t } = ctx;
  return {
    title: t('Commissioning & handover dossier'),
    sheets: [
      sheet(t('Commissioning'), [
        col('system', t('System'), 'text', 26), ...d.steps.flatMap((s) => [col(`${s.step}`, t(s.label), 'text', 14), col(`${s.step}_d`, t('Date'), 'date')]), col('blockingA', t('Open A punch items'), 'integer'),
      ], d.systems.map((sys) => ({
        system: t(sys.name), blockingA: sys.blockingA,
        ...Object.fromEntries(sys.cells.flatMap((c) => [[`${c.step}`, `${t(c.statusLabel)}${c.blockingRef ? ' · ' + c.blockingRef : ''}`], [`${c.step}_d`, c.dateOn]])),
      }))),
      sheet(t('Handover dossier'), [col('item', t('Item'), 'text', 40), col('type', t('Document type'), 'text', 10), col('ref', t('Document'), 'text', 18), col('status', t('Status'), 'text', 14)],
        d.dossier.map((h) => ({ item: t(h.item), type: h.documentType, ref: h.documentRef ?? '', status: t(h.statusLabel) }))),
      sheet(t('SAT plans'), [col('system', t('System'), 'text', 26), col('planned', t('Planned on'), 'date'), col('witnesses', t('Client witnesses'), 'text', 24), col('prerequisites', t('Prerequisites'), 'text', 36), col('by', t('Planned by'), 'text', 16)],
        d.satPlans.map((p) => ({ system: t(p.system), planned: p.plannedOn, witnesses: p.clientWitnesses, prerequisites: p.prerequisites, by: p.plannedBy }))),
      sheet(t('Open punch items'), [col('number', t('Item'), 'text', 8), col('description', t('Description'), 'text', 44), col('location', t('System / location'), 'text', 22), col('category', t('Category'), 'text', 8), col('status', t('Status'), 'text', 12)],
        punch.filter((p) => p.open).map((p) => ({ number: p.number, description: dataText(p.description, ctx.lang), location: dataText(p.location, ctx.lang), category: p.categoryLabel ? t(p.categoryLabel) : '', status: t(p.statusLabel) }))),
    ],
  };
}

registerExportProvider({ screen: 'site', table: siteWorkbook });
registerExportProvider({ screen: 'commissioning', table: commissioningWorkbook });
