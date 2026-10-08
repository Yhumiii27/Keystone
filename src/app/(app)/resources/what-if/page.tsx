// What-if levelling (docs/spec/05 §4, template 1504–1528, logic 4405–4419). Not project-scoped in the prototype
// (no picker) and wired to the Harbor Line steel slip: the page shows the levelling context of `?project=` or,
// by default, HLT-026 — the only project with one. KPI tiles, scenario cards and the side-by-side table are the
// client board; primary action "New scenario" (AF whatif).
import { SectionCard } from '@/components/app/SectionCard';
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { NewScenarioButton } from '@/features/resources/new-scenario-button';
import { WhatIfBoard } from '@/features/resources/whatif-board';
import { whatIfBase, type WhatIfData } from '@/features/resources/whatif-model';
import { getBaselines } from '@/server/dal/planning';
import { getProject } from '@/server/dal/projects';
import { getWhatIf } from '@/server/dal/resources';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

/** The prototype's what-if screen is hard-wired to Harbor Line. */
const WHATIF_DEFAULT_PROJECT = 'HLT-026';

export default async function WhatIfPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = Array.isArray(sp.project) ? sp.project[0] : sp.project;
  const [{ t }, access, scope, project] = await Promise.all([getI18n(), getScreenAccess('whatif'), getProjectScope(), getProject(asked || WHATIF_DEFAULT_PROJECT)]);
  const [w, baselines] = project ? await Promise.all([getWhatIf(project.code), getBaselines(project.code)]) : [null, []];
  const canEdit = !!project && !!w && access.canEdit && !scope.readOnly(project);

  if (!project || !w) {
    return (
      <>
        <PageHeader screen="whatif" />
        <SectionCard gap={10}>
          <EmptyState variant="boxed">{t('No levelling scenario for this project')}</EmptyState>
        </SectionCard>
      </>
    );
  }

  const current = baselines.find((b) => b.state === 'current');
  const data: WhatIfData = {
    projectCode: project.code,
    levers: w.levers.map((l) => ({ code: l.code, label: l.label, floatDays: l.floatDays, costKeur: l.costKeur, peakPts: l.peakPts, overPeople: l.overPeople, sideEffect: l.sideEffect })),
    auto: w.autoLevers,
    weeks: w.weeks.map((x) => x.label),
    base: whatIfBase(w),
    baseline: current?.finishDate ? { code: current.code, finish: current.finishDate } : null,
    peak: w.peak,
    scenarios: w.scenarios.map((s) => ({ name: s.name, priority: s.priority, levers: s.levers, selected: s.selected })),
  };
  return (
    <>
      <PageHeader
        screen="whatif"
        primary={canEdit ? <NewScenarioButton code={project.code} context={`${project.displayId} · ${t(project.name)}`} /> : undefined}
      />
      <WhatIfBoard data={data} canEdit={canEdit} />
    </>
  );
}
