// Change control & baselines — /projects/[code]/changes (docs/spec/07 §2.2, template 1833–1882, logic 4591–4610).
// URL state (docs/spec/00 §8.3): `?filter=budget|scope|schedule` (type chips), `?cr=CR-008` opens the CR drawer,
// `?new=1` opens the New change request form on arrival (Budget › "New change request"); `?new=1&baseline=1` (Plan "Set baseline"
// after BL1, S-3) opens it as a request proposing the next baseline, pre-filled.
// Primary action "New change request" (AF `changes`) for viewers who may edit the project; Submit for review and
// the approval-step decisions are hidden when the screen is outside the workspace or the project is read-only.
// Delivery 8: the board threshold of Settings (R-069) in the workflow note, the cost category of each request for the project
// team only (R-081), the justification in the drawer (R-140).
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/shell/page-header';
import { screenHref } from '@/config/screens';
import { parseCrFilter, withDerivedStatus, type CrFilter } from '@/domain/change-control';
import { NewChangeRequestButton } from '@/features/changes/change-buttons';
import { ChangesView } from '@/features/changes/changes-view';
import { CR_DEFAULT_WBS } from '@/features/changes/forms';
import { changesT } from '@/features/changes/i18n';
import { canEditCrActivities, durationChangeText } from '@/domain/change-activities';
import { nextBaselineCode } from '@/domain/ch4-defaults';
import { listProjectBaselines } from '@/server/dal/baselines';
import { listCrActivityLinks } from '@/server/dal/change-activities';
import { ccbThreshold } from '@/server/dal/change-settings';
import { getChangeControl } from '@/server/dal/changes';
import { getCostControl } from '@/server/dal/cost';
import { listIssueActivityOptions } from '@/server/dal/stock';
import { getBaselineRegister } from '@/server/dal/changes-baselines';
import { getWbs } from '@/server/dal/planning';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { dataText, projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ChangesPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'changes');
  const projectCode = ctx.project.code;
  const internal = ctx.viewer.role !== 'client';
  const [i18n, cc, wbs, baselines, blRows, crLinks, planActs, threshold, cost] = await Promise.all([
    getI18n(), getChangeControl(projectCode), getWbs(projectCode), getBaselineRegister(projectCode), listProjectBaselines(projectCode),
    listCrActivityLinks(projectCode), listIssueActivityOptions(projectCode), ccbThreshold(),
    // R-081: the project's cost categories are internal cost data — never read for the client.
    internal ? getCostControl(projectCode) : Promise.resolve(null),
  ]);
  if (!cc) notFound();
  const { lang } = i18n;
  const t = changesT(i18n.t, lang);
  const canEdit = ctx.canEdit('changes');
  // R-081 (C-3a): the cost category a request moves — offered to and shown for the project team only (typed names as typed).
  const categoryLabel = (c: { code: string; name: string }) => `${c.code} · ${dataText(c.name, lang)}`;
  const categories = cost?.categories ?? [];
  const costCategoryOf: Record<string, string> = {};
  if (internal) {
    for (const cr of cc.changeRequests) {
      const cat = cr.costCategoryCode ? categories.find((c) => c.code === cr.costCategoryCode) : undefined;
      if (cr.costCategoryCode) costCategoryOf[cr.id] = cat ? categoryLabel(cat) : cr.costCategoryCode;
    }
  }

  // Internal ids never reach the islands; the cost category only for the project team (R-081).
  const crs = withDerivedStatus(cc.changeRequests).map((c) => ({ ...c, requestedByPersonId: null, costCategoryCode: internal ? c.costCategoryCode : null }));
  // NEW-D2-2 (R-062): plan activities each request touches; the project team edits them, the client does not see them.
  const actsByCr: Record<string, { code: string; label: string; duration: string }[]> = {};
  const fr = (x: string) => (lang === 'fr' ? x.replace(/(\d+)d\b/g, '$1 j') : x);
  for (const l of crLinks) {
    const duration = l.appliedAt ? `${durationChangeText(l.appliedFromDays, l.newDurationDays)} · ${t('applied')}` : durationChangeText(l.durationDays, l.newDurationDays);
    (actsByCr[l.cr] ??= []).push({ code: l.code, label: l.name ? `${l.code} · ${dataText(l.name, lang)}` : `${l.code} · ${t('not in the plan any more')}`, duration: fr(duration) });
  }
  const crActivities = {
    byCr: actsByCr, options: planActs.map((a) => ({ value: a.code, label: `${a.code} · ${dataText(a.name, lang)}` })),
    canEdit: canEditCrActivities(ctx.viewer, canEdit), visible: ctx.viewer.role !== 'client',
  };
  const filter = parseCrFilter(first(sp.filter));
  const crParam = first(sp.cr)?.toUpperCase();
  const selected = crParam && crs.some((c) => c.id === crParam) ? crParam : null;

  const base = screenHref('changes', { code: projectCode });
  const href = (q: { filter?: CrFilter; cr?: string | null }) => {
    const u = new URLSearchParams();
    if (q.filter && q.filter !== 'all') u.set('filter', q.filter);
    if (q.cr) u.set('cr', q.cr);
    const qs = u.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const autoOpen = first(sp.new) === '1';
  const proposeBaseline = autoOpen && first(sp.baseline) === '1';
  const nextBl = nextBaselineCode(blRows.map((b) => b.code));
  const primary = canEdit ? (
    <NewChangeRequestButton
      code={projectCode}
      context={projectLabelText(ctx.project, i18n.lang)}
      defaultWbs={wbs.some((w) => w.code === CR_DEFAULT_WBS) ? CR_DEFAULT_WBS : '1'}
      autoOpen={autoOpen}
      closeHref={href({ filter, cr: selected })}
      proposeBaseline={proposeBaseline}
      initialValues={proposeBaseline ? { title: `${i18n.t('New baseline')} ${nextBl}`, type: 'schedule', wbs: '1' } : undefined}
      withActivities={canEditCrActivities(ctx.viewer, canEdit)}
      costCategories={canEditCrActivities(ctx.viewer, canEdit) ? categories.map((c) => ({ value: c.code, label: categoryLabel(c) })) : undefined}
    />
  ) : undefined;

  return (
    <>
      <PageHeader screen="changes" projectCode={projectCode} primary={primary} />
      <ChangesView
        code={projectCode}
        data={{ crs, baselines, originalBudget: cc.originalBudget, bac: cc.bac, contingency: cc.contingency }}
        filter={filter}
        selected={selected}
        role={ctx.viewer.role}
        canEdit={canEdit}
        href={href}
        planHref={screenHref('plan', { code: projectCode })}
        budgetHref={screenHref('budget', { code: projectCode })}
        crActivities={crActivities}
        ccbThresholdKeur={threshold}
        costCategoryOf={internal ? costCategoryOf : undefined}
        lang={lang}
        t={t}
      />
    </>
  );
}
