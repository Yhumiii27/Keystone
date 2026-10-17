// What-if levelling (docs/spec/05 §4, template 1504–1528; chapter 4, S-7). Scenarios are per project: the page shows the
// levelling of `?project=`; without it, it redirects to the viewer's current project (the last project used), so the URL —
// and the header's Export, which reads `?project=` — always names the project shown. The prototype had no picker and was
// hard-wired to Harbor Line; the header's project switcher now sets `?project=`. Any project with a plan has a what-if:
// levers derived from its data, effects computed by the CPM engine on a copy of the plan, scenarios persisted per project.
// KPI tiles, scenario cards and the side-by-side table are the client board; primary action "New scenario" (AF whatif).
// Owner answers 17 Oct 2026 ("What-if : OUI"): the horizon has the load plans' navigation — `?week=` (validated server-side,
// the current 8-week window by default), previous / current / next week and 8-week page links — and every action carries it;
// a horizon entirely in the past is read-only, with its reason.
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/app/EmptyState';
import { SectionCard } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { NewScenarioButton } from '@/features/resources/new-scenario-button';
import { WhatIfBoard } from '@/features/resources/whatif-board';
import { LoadWindowNav } from '@/features/resources/window-nav';
import { WHATIF_PAST_HORIZON, leverData, whatIfHref, type WhatIfData } from '@/features/resources/whatif-model';
import { screenHref } from '@/config/screens';
import { getProject } from '@/server/dal/projects';
import { getLoadWindow, getWhatIf } from '@/server/dal/resources';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function WhatIfPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = Array.isArray(sp.project) ? sp.project[0] : sp.project;
  if (!asked) redirect(whatIfHref(await getLastProject()));
  const code = asked || (await getLastProject());
  // The horizon is always 8 weeks (no week view on the what-if): `?view=` is not read.
  const [{ t, lang }, access, scope, project, win] = await Promise.all([getI18n(), getScreenAccess('whatif'), getProjectScope(), getProject(code), getLoadWindow(sp.week)]);
  const w = project ? await getWhatIf(project.code, win.start) : null;
  const past = !!w?.horizon.past;
  const canEdit = !!project && !!w && access.canEdit && !scope.readOnly(project) && !past;

  if (!project || !w) {
    return (
      <>
        <PageHeader screen="whatif" projectParam={project?.code} />
        <SectionCard gap={10}>
          <EmptyState variant="boxed">{t('No levelling scenario for this project')}</EmptyState>
        </SectionCard>
      </>
    );
  }

  const data: WhatIfData = {
    projectCode: project.code,
    horizon: w.horizon.window.start,
    dataDate: w.dataDate,
    weeks: w.weeks.map((x) => x.label),
    weekStarts: w.weeks.map((x) => x.start),
    levers: w.levers.map((l) => leverData(l, w.effects[l.code])),
    auto: w.autoLevers,
    current: w.current,
    results: w.results,
    plan: { forecastFinish: w.forecastFinish, floatDays: w.floatDays },
    baseline: w.baseline,
    peak: w.peak,
    overByWeek: w.overByWeek,
    scenarios: w.scenarios.map((s) => ({
      name: s.name, priority: s.priority, levers: s.levers, selected: s.selected, applied: !!s.appliedAt, requests: s.requests, hypotheses: s.hypotheses,
    })),
    error: w.error,
  };
  return (
    <>
      <PageHeader
        screen="whatif"
        projectParam={project.code}
        primary={canEdit ? <NewScenarioButton code={project.code} context={projectLabelText(project, lang)} horizon={data.horizon} /> : undefined}
      />
      <WhatIfBoard
        data={data}
        canEdit={canEdit}
        nav={<LoadWindowNav window={w.horizon.window} path={screenHref('whatif')} keep={{ project: project.code }} views={false} t={t} lang={lang} />}
        readOnlyReason={past ? t(WHATIF_PAST_HORIZON) : null}
      />
    </>
  );
}
