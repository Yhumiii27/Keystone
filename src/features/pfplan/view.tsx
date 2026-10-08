// Portfolio schedule body (docs/spec/05 §3.3, template 972–1023). Server Component: stage filter (`?filter=`, links),
// zone empty notice, 4 KPI tiles and the portfolio Gantt card (CH-9). Read-only screen: no primary action, no edits;
// rows link to the project's Plan (projects with planning data) or to the Projects register searched by code.
import { Funnel, GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { PortfolioGantt, PortfolioGanttLegend, type PortfolioGanttRow } from '@/components/charts/portfolio-gantt';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { screenHref } from '@/config/screens';
import { PG_FILTERS, type PgFilter, type PgKpiTint, type PgRow, type PgTarget, type PortfolioScheduleModel } from '@/domain/pfplan';
import type { T } from '@/i18n/translate';
import { projectName } from '@/features/portfolio/view';
import s from './pfplan.module.css';

const KPI_COLOR: Record<PgKpiTint, string> = { ok: OK, n200: 'var(--color-neutral-200)', lo: LO };

/** `?filter=` link of the stage segment (the zone lives in its cookie). */
export const filterHref = (f: PgFilter) => screenHref('pfplan') + (f === 'all' ? '' : `?filter=${f}`);

/** Row click (4547): Plan of a project with planning data, else the Projects register searched by code (no stage filter). */
export const targetHref = (target: PgTarget) =>
  target.screen === 'plan' ? screenHref('plan', { code: target.code }) : `${screenHref('projects')}?q=${encodeURIComponent(target.q)}`;

function ganttRow(r: PgRow, t: T): PortfolioGanttRow {
  return {
    key: r.code,
    name: projectName(r, t),
    sub: t(r.pmLine),
    href: targetHref(r.target),
    status: t(r.status),
    tone: r.tone,
    gate: t(r.gate),
    gateSub: t(r.gateSub),
    gateTint: r.gateTint,
    segments: r.segments.map((seg) => (seg.kind === 'stage' ? { ...seg, title: t(seg.title), label: t(seg.label) } : { ...seg, title: t(seg.title) })),
    exec: r.exec,
    baseline: r.baseline,
    clipText: t(r.clipText),
  };
}

export function PfPlanBody({ model, filter, zoneSelected, t }: { model: PortfolioScheduleModel; filter: PgFilter; zoneSelected: boolean; t: T }) {
  return (
    <Stack gap={14}>
      <FilterBar>
        <FilterLabel icon={Funnel}>{t('Stage')}</FilterLabel>
        <Segmented
          wrap
          label={t('Stage')}
          value={filter}
          options={PG_FILTERS.map((o) => ({ value: o.value, label: t(o.label), href: filterHref(o.value) }))}
        />
      </FilterBar>
      {zoneSelected && model.empty && (
        <Callout icon={GlobeHemisphereEast} role="status">
          {t('No project in this zone for this view')}
        </Callout>
      )}
      <KpiGrid min={150}>
        {model.kpis.map((k) => (
          <KpiTile key={k.key} label={t(k.label)} value={t(k.value)} sub={t(k.sub)} color={KPI_COLOR[k.tint]} />
        ))}
      </KpiGrid>
      <SectionCard gap={10} scroll>
        <div className={s.head}>
          <div className={s.titleCol}>
            <CardTitle>{t('Portfolio schedule')}</CardTitle>
            <span className={s.subtitle}>
              {t('One line per project · execution in accent, pipeline (Initiative → APS → APD) in grey, hatched while the group board decides')}
            </span>
          </div>
          <PortfolioGanttLegend
            labels={{
              inProgress: t('In progress'),
              pipeline: t('Pipeline'),
              decisionPending: t('Group decision pending'),
              groupBoard: t('Group board'),
              ifApproved: t('Execution if approved'),
              baselineFinish: t('Baseline finish'),
            }}
          />
        </div>
        <PortfolioGantt
          months={model.months.map((m) => ({ ...m, label: t(m.label) }))}
          groups={model.groups.map((g) => ({ key: g.key, label: t(g.label), count: g.count, rows: g.rows.map((r) => ganttRow(r, t)) }))}
          todayL={model.todayL}
          labels={{ project: t('Project'), status: t('Status'), gate: `${t('Next decision')} / ${t('Finish')}` }}
        />
      </SectionCard>
    </Stack>
  );
}
