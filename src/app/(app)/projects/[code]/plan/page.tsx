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
import { canEditPlan, canSchedulePlan } from '@/features/plan/rights';
import { PlanToolbar } from '@/features/plan/toolbar';
import s from '@/features/plan/plan.module.css';
import { canSnapshotFreely } from '@/domain/baseline-policy';
import { nextBaselineCode } from '@/domain/ch4-defaults';
import { longDateText } from '@/domain/schedule-rollup';
import { baselineWhenText, trashMetaText } from '@/features/plan/i18n';
import { RecentlyDeleted } from '@/features/plan/recently-deleted';
import { PLAN_TRASH_RETENTION_DAYS, listPlanTrash } from '@/server/dal/plan-trash';
import { listActivityTodos } from '@/server/dal/activity-todos';
import { listCrActivityLinks } from '@/server/dal/change-activities';
import { listDepartments } from '@/server/dal/people';
import { getPlanData, getPlanRequests, getPlanSettings, getPlanTodos } from '@/server/dal/plan';
import { getActivityAssignments } from '@/server/dal/planning';
import { baselineState } from '@/server/db/codes';
import { projectLabel } from '@/server/dal/projects';
import { STATUS_DATE } from '@/lib/format';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlanPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'plan');
  const projectCode = ctx.project.code;
  const [i18n, data, settings, jar] = await Promise.all([getI18n(), getPlanData(projectCode), getPlanSettings(projectCode), cookies()]);
  const { lang } = i18n;
  const t = planT(i18n.t, lang);
  // Edits: not outside the workspace, not a read-only project, never the client (`planRO`). Scheduling decisions
  // (Reschedule, Set baseline, Baseline / Calendar chips): the director or the project's manager (S-1).
  const canEdit = canEditPlan(ctx);
  const canSchedule = canSchedulePlan(ctx);

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

  const [todos, requests, trash] = await Promise.all([getPlanTodos(projectCode), getPlanRequests(projectCode), canSchedule ? listPlanTrash(projectCode) : []]);
  const rows = planRowViews(planRows(data, todos), data, t, lang);
  const displayed = settings?.displayed ?? null;
  const kpis = planKpis(view, data, t, lang, { dataDate: settings?.dataDate, baseline: displayed });
  const dataDateText = t(settings ? longDateText(settings.dataDate) : STATUS_DATE);
  const context = t(projectLabel(ctx.project));
  // "Recently deleted" (S-5): real-clock removal times.
  const whenText = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  // Toolbar chips (S-2 project calendar, S-3 displayed baseline).
  const calName = (c: string) => settings?.calendars.find((x) => x.code === c)?.name ?? c;
  const blWhen = (b: { setOn: string | null; changeRequest: string | null }) => baselineWhenText(b.setOn ? t(longDateText(b.setOn)) : null, b.changeRequest, lang);
  const calendarChip = {
    value: t(calName(settings?.calendarCode ?? '')),
    current: settings?.calendarCode ?? '',
    options: (settings?.calendars ?? []).map((c) => ({ value: c.code, label: t(c.name) })),
  };
  const baselineChip = {
    value: displayed ? `${displayed.code} · ${blWhen(displayed)}` : t(`BL1 · ${data.control.baselineSet}`),
    current: displayed?.code ?? '',
    options: (settings?.baselines ?? []).map((b) => ({
      value: b.code, label: `${b.code} · ${blWhen(b)}`, meta: t(baselineState.label(b.state)), disabled: !b.activityCount,
      title: b.activityCount ? undefined : t('No activity snapshot'),
    })),
  };

  // S-3: "Set baseline" snapshots freely up to BL1; afterwards it opens a change request proposing the next baseline.
  const baselineCodes = (settings?.baselines ?? []).map((b) => b.code);

  let drawer = null;
  if (act) {
    const [assignments, depts, crLinks, actTodos] = await Promise.all([
      getActivityAssignments(projectCode, act.id), listDepartments(), listCrActivityLinks(projectCode), canEdit ? listActivityTodos(projectCode, act.id) : [],
    ]);
    // NEW-D2-2 (R-062): the change requests that name this activity, opened on Change control.
    const changesBase = screenHref('changes', { code: projectCode });
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
        changeLinks: crLinks.filter((l) => l.code === act.id).map((l) => ({
          cr: l.cr, title: l.crTitle, status: l.crStatus, durationDays: l.durationDays, newDurationDays: l.newDurationDays, appliedAt: l.appliedAt,
          appliedFromDays: l.appliedFromDays, href: `${changesBase}?cr=${encodeURIComponent(l.cr)}`,
        })),
        taskHref: (x) => screenHref('task', { taskId: x.id }),
        calendars: settings?.calendars,
        projectCalendar: settings?.calendarCode,
        baselineCode: displayed?.code ?? null,
        removableTodos: new Set(actTodos.filter((x) => x.removable).map((x) => x.number)),
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
        code={projectCode}
        canEdit={canEdit}
        context={context}
        linkOptions={data.activities.filter((a) => a.id !== act.id).map((a) => `${a.id} · ${a.name}`)}
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
        <PlanToolbar
          view={view}
          hrefs={viewHrefs}
          code={projectCode}
          context={context}
          calendar={calendarChip}
          baseline={baselineChip}
          dataDate={dataDateText}
          nextBaseline={nextBaselineCode(baselineCodes)}
          baselineChangeRequestHref={canSnapshotFreely(baselineCodes) ? undefined : `${screenHref('changes', { code: projectCode })}?new=1&baseline=1`}
          canSchedule={canSchedule}
          t={t}
        />
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
                {t('Data date')} · {dataDateText}
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
            canRemove={canSchedule}
            owners={data.owners.map((o) => ({ value: o.code, label: o.name }))}
            hrefOf={{ base, query: view === 'structure' ? 'view=structure&' : '' }}
          />
        </div>
        {canSchedule && (
          <RecentlyDeleted
            code={projectCode}
            title={t('Recently deleted')}
            hint={t(`Removed work packages and activities can be restored for ${PLAN_TRASH_RETENTION_DAYS} days, with their links, assignments and to-dos`)}
            entries={trash.map((e) => ({
              id: e.id,
              label: `${e.code} · ${e.name}`,
              meta: trashMetaText(e.kind, e.activityCount, e.deletedByName, whenText.format(e.deletedAt), lang),
            }))}
          />
        )}
        {drawer}
      </div>
      {canEdit && <PlanForms code={projectCode} context={context} defs={formDefs} />}
    </>
  );
}
