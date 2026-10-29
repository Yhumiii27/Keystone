// Schedule screen body (docs/spec/05 §1.3–1.4, template 485–572): KPI row · Gantt card · bottom grid
// (Schedule progression | Milestones). Server Component; all strings go through t() (EN source = prototype).
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Legend, LegendItem } from '@/components/app/Legend';
import { CardGrid, SectionCard, Stack } from '@/components/app/SectionCard';
import { ObjectStatusTag } from '@/components/app/StatusTag';
import { LO, OK } from '@/components/app/tones';
import { ColumnPairChart } from '@/components/charts/column-pair-chart';
import { ProjectGantt, ProjectGanttLegend } from '@/components/charts/project-gantt';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import type { ScheduleView as ScheduleModel } from '@/domain/schedule-gantt';
import { getI18n } from '@/server/session';
import { CAPEX_MILESTONE_CODES, CAPEX_MILESTONE_LABELS, NO_CAPEX_MILESTONE, isCapexMilestoneCode } from '@/domain/capex-milestones';
import { CapexMilestoneSelect } from './capex-milestone-select';
import { slipText } from './i18n';
import s from './schedule.module.css';
import { dataText } from '@/i18n/data-text';

/**
 * R-189 (Arche K-04): the CAPEX code of each milestone of the list, in the same (schedule) order; `editCode` = the project code when
 * the viewer may set them (the project's leads), which shows a select per milestone instead of the code.
 */
export interface ScheduleCapexMilestones {
  rows: { id: string; capexCode: string | null }[];
  editCode?: string;
}

export async function ScheduleView({
  view, showBaseline = true, capex, ganttSwitch, activityGantt,
}: {
  view: ScheduleModel;
  showBaseline?: boolean;
  capex?: ScheduleCapexMilestones;
  /** R-198: Work packages | Activities switch, shown in the package Gantt card. */
  ganttSwitch?: ReactNode;
  /** R-198: the interactive activity Gantt card, shown instead of the package Gantt card. */
  activityGantt?: ReactNode;
}) {
  const { t, lang } = await getI18n();
  const capexOptions = [{ value: '', label: t(NO_CAPEX_MILESTONE) }, ...CAPEX_MILESTONE_CODES.map((c) => ({ value: c, label: t(CAPEX_MILESTONE_LABELS[c]) }))];
  const capexOf = (i: number) => (capex && capex.rows.length === view.milestones.length ? capex.rows[i] : undefined);
  const hasGantt = view.tasks.length > 0 || view.milestones.length > 0;
  return (
    <Stack gap={14}>
      <KpiGrid min={160}>
        {view.kpis.map((k) => (
          <KpiTile key={k.key} label={t(k.label)} value={t(k.value)} sub={t(k.sub)} color={k.alert ? LO : OK} />
        ))}
      </KpiGrid>

      {activityGantt ?? (
      <SectionCard gap={10} scroll>
        <div className={s.head}>
          <CardTitle push>{t('Schedule — baseline vs forecast')}</CardTitle>
          <ProjectGanttLegend labels={{ critical: t('Critical path'), task: t('Task'), baseline: t('Baseline'), milestone: t('Milestone') }} />
        </div>
        {ganttSwitch}
        {hasGantt ? (
          <ProjectGantt
            months={view.ganttMonths.map((m) => t(m))}
            tasks={view.tasks.map((x) => ({ ...x, name: dataText(x.name, lang), slipText: slipText(x.slipText, lang) }))}
            milestones={view.milestones.map((m) => ({ name: dataText(m.name, lang), bL: m.bL, fL: m.fL, done: m.done }))}
            todayL={view.todayL}
            showBaseline={showBaseline}
            labels={{ workPackage: t('Work package'), done: t('Done'), slip: t('Slip'), milestones: t('Milestones'), today: t('Today') }}
          />
        ) : (
          <EmptyState variant="boxed">{t('No work package scheduled for this project')}</EmptyState>
        )}
      </SectionCard>
      )}

      <CardGrid min={400} gap={14} align="stretch">
        <SectionCard gap={10}>
          <div className={s.head}>
            <div className={s.titleCol}>
              <CardTitle>{t('Schedule progression')}</CardTitle>
              <span className={s.sub}>{t('Cumulative % complete · SPI per month')}</span>
            </div>
            <Legend>
              <LegendItem kind="block" color="var(--color-neutral-700)">
                {t('Planned')}
              </LegendItem>
              <LegendItem kind="block" color="var(--color-accent)">
                {t('Actual')}
              </LegendItem>
            </Legend>
          </div>
          <ColumnPairChart columns={view.progression.map((p) => ({ label: t(p.label), planH: p.planH, actH: p.actH, spiText: p.spiText, spiAlert: p.spiAlert }))} />
        </SectionCard>

        <SectionCard title={t('Milestones')} titleGap={4} gap={4}>
          {view.milestones.length === 0 && <EmptyState>{t('No milestone recorded for this project')}</EmptyState>}
          {view.milestones.map((m, i) => (
            <div key={i} className={s.msRow}>
              <div className={s.msText}>
                <span>{dataText(m.name, lang)}</span>
                <span className={s.msSub}>{`${t('Baseline')} ${t(m.baseDate)} ${t('· Forecast')} ${t(m.fcDate)}`}</span>
                {(() => {
                  const row = capexOf(i);
                  if (!row) return null;
                  if (capex?.editCode)
                    return (
                      <span className={s.msCapex}>
                        <CapexMilestoneSelect
                          key={`${row.id}:${row.capexCode ?? ''}`}
                          code={capex.editCode}
                          milestoneId={row.id}
                          value={row.capexCode ?? ''}
                          label={`${t('CAPEX milestone')} · ${dataText(m.name, lang)}`}
                          options={capexOptions}
                          saved={t('CAPEX milestone saved')}
                        />
                      </span>
                    );
                  return isCapexMilestoneCode(row.capexCode) ? (
                    <span className={s.msSub}>{`${t('CAPEX milestone')} · ${t(CAPEX_MILESTONE_LABELS[row.capexCode])}`}</span>
                  ) : null;
                })()}
              </div>
              <span className={cx(s.msSlip, m.slipAlert && s.msSlipAlert)}>{slipText(m.slipText, lang)}</span>
              <ObjectStatusTag kind="milestone" code={m.status} label={t(m.statusLabel)} />
            </div>
          ))}
        </SectionCard>
      </CardGrid>
    </Stack>
  );
}
