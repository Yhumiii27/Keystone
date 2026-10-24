// Schedule — Gantt baseline vs forecast (docs/spec/05 §1, template 485–572, logic 3847–3864).
// Read-only package-level schedule: 5 KPI tiles, package Gantt (baseline bars, forecast bars, today line,
// milestones), schedule progression and milestone list. Primary action "Re-baseline" (AF `schedule`).
// `?baseline=0` hides the baseline geometry (prototype app prop `showBaseline`, default true).
import { SectionCard } from '@/components/app/SectionCard';
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { CardTitle } from '@/components/ds/Card';
import { stageEstimateClass } from '@/domain/estimate-class';
import { scheduleView } from '@/domain/schedule-gantt';
import { RebaselineButton } from '@/features/schedule/rebaseline-button';
import { ScheduleView } from '@/features/schedule/schedule-view';
import { getScheduleData } from '@/server/dal/schedule';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'schedule');
  const [{ t, lang }, data] = await Promise.all([getI18n(), getScheduleData(ctx.project.code)]);
  const baselineParam = Array.isArray(sp.baseline) ? sp.baseline[0] : sp.baseline;
  const showBaseline = baselineParam !== '0' && baselineParam !== 'off';

  const primary =
    data && ctx.canEdit('schedule') ? <RebaselineButton code={ctx.project.code} context={projectLabelText(ctx.project, lang)} defaultClass={stageEstimateClass(ctx.project.stage)} /> : undefined;

  return (
    <>
      <PageHeader screen="schedule" projectCode={ctx.project.code} primary={primary} />
      {data ? (
        <ScheduleView view={scheduleView(data)} showBaseline={showBaseline} />
      ) : (
        <SectionCard gap={10}>
          <CardTitle>{t('Schedule — baseline vs forecast')}</CardTitle>
          <EmptyState variant="boxed">{t('No schedule recorded for this project')}</EmptyState>
        </SectionCard>
      )}
    </>
  );
}
