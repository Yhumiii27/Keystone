// Plan — WBS & activities — /projects/[code]/plan (docs/spec/05 §2, template 1024–1166, logic 3971–4046).
// URL state (docs/spec/00 §8.3): `?view=structure` (default Progress), `?act=A1250` opens the activity drawer,
// `?sel=A1250` keeps a row highlighted after the drawer closes (prototype `sel`, default A1250).
// Primary action: "Update progress" (Progress view) / "Add activity" (Structure view). Edits go through the
// Server Functions of src/features/plan/actions.ts; projects without planning data show an empty state.
import { cookies } from 'next/headers';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { screenHref } from '@/config/screens';
import { ActivityDrawer } from '@/features/plan/activity-drawer';
import { COLLAPSE_COOKIE, parseCollapsed } from '@/features/plan/collapse';
import { activityDrawerView } from '@/features/plan/drawer-model';
import { planFormDefs } from '@/features/plan/forms';
import { planT } from '@/features/plan/i18n';
import { planKpis, planRowViews, planRows, type PlanView } from '@/features/plan/model';
import { AddWorkPackageButton, PlanForms, PlanPrimaryButton } from '@/features/plan/plan-forms';
import { PlanTable } from '@/features/plan/plan-table';
import { PlanToolbar } from '@/features/plan/toolbar';
import s from '@/features/plan/plan.module.css';
import { STATUS_DATE } from '@/lib/format';
import { listChangeRequestDetails } from '@/server/dal/changes';
import { listDepartments } from '@/server/dal/people';
import { getPlanData, getPlanRequests, getPlanTodos } from '@/server/dal/plan';
import { getActivityAssignments } from '@/server/dal/planning';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlanPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'plan');
  const projectCode = ctx.project.code;
  const [i18n, data, jar] = await Promise.all([getI18n(), getPlanData(projectCode), cookies()]);
  const { lang } = i18n;
  const t = planT(i18n.t, lang);
  // Edits: not outside the workspace, not a read-only project, never the client (`planRO`).
  const canEdit = ctx.canEdit('plan') && ctx.viewer.role !== 'client';

  if (!data)
    return (
      <>
        <PageHeader screen="plan" projectCode={projectCode} />
        <SectionCard gap={10}>
          <CardTitle>{t('Work breakdown structure')}</CardTitle>
          <EmptyState variant="boxed">{t('No activities recorded for this project yet')}</EmptyState>
        </SectionCard>
      </>
    );

  const view: PlanView = first(sp.view) === 'structure' ? 'structure' : 'progress';
  const ids = new Set(data.activities.map((a) => a.id));
  const actParam = first(sp.act)?.toUpperCase();
  const act = actParam ? data.activities.find((a) => a.id === actParam) : undefined;
  const selParam = first(sp.sel)?.toUpperCase();
  const selected = act?.id ?? (selParam && ids.has(selParam) ? selParam : ids.has('A1250') ? 'A1250' : null);

  // URLs (view + selection kept across switches)
  const base = screenHref('plan', { code: projectCode });
  const href = (q: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const keep = { act: act?.id, sel: !act && selParam && ids.has(selParam) ? selParam : undefined };
  const viewHrefs: Record<PlanView, string> = { structure: href({ view: 'structure', ...keep }), progress: href(keep) };

  // Collapse map (cookie), with the deep-linked activity's work package expanded (`openPlan`, logic 4093).
  const collapsed = parseCollapsed(jar.get(COLLAPSE_COOKIE)?.value);
  if (act) collapsed[act.wbs] = false;

  const [todos, requests] = await Promise.all([getPlanTodos(projectCode), getPlanRequests(projectCode)]);
  const rows = planRowViews(planRows(data, todos), data, t, lang);
  const kpis = planKpis(view, data, t, lang);

  let drawer = null;
  if (act) {
    const [assignments, depts, crs] = await Promise.all([getActivityAssignments(projectCode, act.id), listDepartments(), listChangeRequestDetails(projectCode)]);
    const view_ = activityDrawerView(
      {
        act,
        activities: data.activities,
        packages: data.packages,
        owners: data.owners,
        assignments,
        todos,
        requests,
        deptHeads: Object.fromEntries(depts.map((d) => [d.name, d.head ?? d.headShort ?? d.name])),
        pendingChanges: crs.filter((c) => c.status === 'in_review').map((c) => c.id),
        taskHref: (x) => screenHref('task', { taskId: x.id }),
      },
      i18n.t,
      lang,
    );
    drawer = (
      <ActivityDrawer
        view={view_}
        closeHref={href({ view: view === 'structure' ? 'structure' : undefined, sel: act.id })}
        scheduleHref={screenHref('schedule', { code: projectCode })}
        t={t}
      />
    );
  }

  const formDefs = planFormDefs({
    wp: data.packages.map((p) => `${p.code} · ${p.name}`),
    team: data.control.team.length ? data.control.team : data.owners.map((o) => o.name),
    actOpen: data.activities.filter((a) => a.pct < 100).map((a) => `${a.id} · ${a.name}`),
  });
  const primary = canEdit ? (
    <PlanPrimaryButton form={view === 'structure' ? 'plan' : 'progress'} label={t(view === 'structure' ? 'Add activity' : 'Update progress')} />
  ) : undefined;

  return (
    <>
      <PageHeader screen="plan" projectCode={projectCode} primary={primary} />
      <div className={s.body}>
        <PlanToolbar view={view} hrefs={viewHrefs} baselineSet={data.control.baselineSet} t={t} />
        <KpiGrid min={150}>
          {kpis.map((k) => (
            <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
          ))}
        </KpiGrid>
        <div className={cx('card', 'elev-sm', s.card)}>
          <div className={s.cardHead}>
            <div className={s.cardHeadText}>
              <CardTitle>{t(view === 'structure' ? 'Work breakdown structure' : 'Progress update')}</CardTitle>
              <span className={s.cardSub}>
                {t(
                  view === 'structure'
                    ? 'Build the WBS · rename, re-order, assign owners, durations and budgets · logic as “A1010 FS+5, A1020 SS”'
                    : 'Enter % complete per activity · summaries roll up by budget weight · click a row for details',
                )}
              </span>
            </div>
            {view === 'structure' ? (
              canEdit && <AddWorkPackageButton label={t('Add work package')} />
            ) : (
              <span className={s.dataDate}>
                {t('Data date')} · {t(STATUS_DATE)}
              </span>
            )}
          </div>
          <PlanTable
            view={view}
            code={projectCode}
            rows={rows}
            collapsed={collapsed}
            selected={selected}
            canEdit={canEdit}
            owners={data.owners.map((o) => ({ value: o.code, label: o.name }))}
            hrefOf={{ base, query: view === 'structure' ? 'view=structure&' : '' }}
          />
        </div>
        {drawer}
      </div>
      {canEdit && <PlanForms code={projectCode} context={t(projectLabel(ctx.project))} defs={formDefs} />}
    </>
  );
}
