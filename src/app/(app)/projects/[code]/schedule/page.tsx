// Schedule — Gantt baseline vs forecast (docs/spec/05 §1, template 485–572, logic 3847–3864).
// Read-only package-level schedule: 5 KPI tiles, package Gantt (baseline bars, forecast bars, today line,
// milestones), schedule progression and milestone list. Primary action "Re-baseline" (AF `schedule`).
// `?baseline=0` hides the baseline geometry (prototype app prop `showBaseline`, default true).
// R-198: `?gantt=activities` shows the interactive activity Gantt instead of the package Gantt, `?zoom=day|week|month` its zoom
// (default week), `?equipment=EQ-02|common` its equipment line filter on a project with several lines (S-08, R-185). Its edits (project's PMs and the director) go through src/features/schedule/gantt-actions.ts.
// R-206: the Schedule quality card (DCMA 14 points) and the Delay analysis (`?from=BL1&to=current|BL2`), read-only, for whoever
// sees the schedule.
import { SectionCard } from '@/components/app/SectionCard';
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { CardTitle } from '@/components/ds/Card';
import { stageEstimateClass } from '@/domain/estimate-class';
import { scheduleView } from '@/domain/schedule-gantt';
import { canSetCapexMilestone } from '@/domain/rights';
import { RebaselineButton } from '@/features/schedule/rebaseline-button';
import { Segmented } from '@/components/ds/Segmented';
import { screenHref } from '@/config/screens';
import { isGanttZoom, type GanttZoom } from '@/domain/gantt-edit';
import { COMMON_EQUIPMENT, equipmentFilterOf, showsEquipment } from '@/domain/equipment-scope';
import { equipmentLotLabel } from '@/domain/project-equipment';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import { ActivityGanttCard } from '@/features/schedule/activity-gantt-card';
import { canEditGantt } from '@/features/schedule/gantt-rights';
import { getGanttNetwork } from '@/server/dal/gantt';
import { listCapexMilestones } from '@/server/dal/capex-milestones';
import { ScheduleView } from '@/features/schedule/schedule-view';
import { getScheduleData } from '@/server/dal/schedule';
import { getScheduleQuality } from '@/server/dal/schedule-quality';
import { ScheduleQualityCards } from '@/features/schedule/schedule-quality-card';
import { getProjectContext } from '@/server/project-context';
import { canSnapshotFreely } from '@/domain/baseline-policy';
import { listProjectBaselines } from '@/server/dal/baselines';
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
  const [{ t, lang }, data, capexRows] = await Promise.all([getI18n(), getScheduleData(ctx.project.code), listCapexMilestones(ctx.project.code)]);
  const baselineParam = Array.isArray(sp.baseline) ? sp.baseline[0] : sp.baseline;
  const showBaseline = baselineParam !== '0' && baselineParam !== 'off';
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const level = first(sp.gantt) === 'activities' ? 'activities' : 'packages';
  const zoomParam = first(sp.zoom);
  const zoom: GanttZoom = isGanttZoom(zoomParam) ? zoomParam : 'week';
  // S-08 (R-185): on a project with several equipment lines, `?equipment=EQ-02|common` filters the activity Gantt's rows
  // ('all' default, omitted); hidden with one line.
  const lines = level === 'activities' ? (await listProjectEquipments(ctx.project.code)).map((l) => ({ ...l, label: equipmentLotLabel(l) })) : [];
  const multiEquipment = showsEquipment(lines);
  const equipment = multiEquipment ? equipmentFilterOf(sp.equipment, lines.map((l) => l.ref)) : 'all';
  const base = screenHref('schedule', { code: ctx.project.code });
  const href = (q: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    if (!showBaseline) u.set('baseline', '0');
    for (const [k, v] of Object.entries(q)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const levelSwitch = (
    <Segmented
      label={t('Gantt level')}
      value={level}
      options={[
        { value: 'packages', label: t('Work packages'), href: href({}) },
        { value: 'activities', label: t('Activities'), href: href({ gantt: 'activities', zoom: zoomParam && isGanttZoom(zoomParam) ? zoomParam : undefined }) },
      ]}
    />
  );
  const network = level === 'activities' ? await getGanttNetwork(ctx.project.code) : null;
  const quality = data ? await getScheduleQuality(ctx.project.code, { from: first(sp.from), to: first(sp.to) }) : null;
  // The forensic pair keeps the page's other parameters (baseline, Gantt level, zoom).
  const pairHref = (from: string, to: string) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const one = first(v);
      if (one && k !== 'from' && k !== 'to') u.set(k, one);
    }
    u.set('from', from);
    u.set('to', to);
    return `${base}?${u.toString()}`;
  };

  // D9-12 (R-063): after BL1, « Re-baseline » always goes through a change request — the button opens the Change control form
  // proposing the next baseline, as the Plan's « Set baseline » (S-3).
  const freeSnapshot = data && ctx.canEdit('schedule') ? canSnapshotFreely((await listProjectBaselines(ctx.project.code)).map((b) => b.code)) : true;
  const primary =
    data && ctx.canEdit('schedule') ? (
      <RebaselineButton
        code={ctx.project.code}
        context={projectLabelText(ctx.project, lang)}
        defaultClass={stageEstimateClass(ctx.project.stage)}
        changeRequestHref={freeSnapshot ? undefined : `${screenHref('changes', { code: ctx.project.code })}?new=1&baseline=1`}
      />
    ) : undefined;

  return (
    <>
      <PageHeader screen="schedule" projectCode={ctx.project.code} primary={primary} />
      {data ? (
        <ScheduleView
          view={scheduleView(data)}
          showBaseline={showBaseline}
          // R-189: which milestone is which CAPEX milestone (its BL1 date is published to Arche); set by the project's leads.
          ganttSwitch={levelSwitch}
          activityGantt={
            level === 'activities' ? (
              <ActivityGanttCard
                code={ctx.project.code}
                network={network}
                zoom={zoom}
                zoomHref={(z) => href({ gantt: 'activities', zoom: z, equipment: equipment === 'all' ? undefined : equipment })}
                equipment={
                  multiEquipment
                    ? {
                        value: equipment,
                        options: [
                          { value: 'all', label: t('All'), href: href({ gantt: 'activities', zoom: zoomParam && isGanttZoom(zoomParam) ? zoomParam : undefined }) },
                          ...lines.map((l) => ({ value: l.ref, label: l.label, href: href({ gantt: 'activities', zoom: zoomParam && isGanttZoom(zoomParam) ? zoomParam : undefined, equipment: l.ref }) })),
                          { value: COMMON_EQUIPMENT, label: t('Common to the project'), href: href({ gantt: 'activities', zoom: zoomParam && isGanttZoom(zoomParam) ? zoomParam : undefined, equipment: COMMON_EQUIPMENT }) },
                        ],
                      }
                    : undefined
                }
                levelSwitch={levelSwitch}
                editable={canEditGantt(ctx)}
                showBaseline={showBaseline}
              />
            ) : undefined
          }
          quality={quality ? <ScheduleQualityCards code={ctx.project.code} data={quality} pairHref={pairHref} /> : undefined}
          capex={{
            rows: capexRows.map((r) => ({ id: r.id, capexCode: r.capexCode })),
            editCode: canSetCapexMilestone(ctx.viewer.role, ctx.access) && ctx.canEdit('schedule') ? ctx.project.code : undefined,
          }}
        />
      ) : (
        <SectionCard gap={10}>
          <CardTitle>{t('Schedule — baseline vs forecast')}</CardTitle>
          <EmptyState variant="boxed">{t('No schedule recorded for this project')}</EmptyState>
        </SectionCard>
      )}
    </>
  );
}
