// Portfolio schedule body (docs/spec/05 §3.3, template 972–1023). Server Component: stage filter (`?filter=`, links),
// Delivery 8 (L-8 = a, R-136): the "Period" links (previous quarter, today, next quarter — `?from=`) and the window shown;
// zone empty notice, 4 KPI tiles and the portfolio Gantt card (CH-9). Read-only screen: no primary action, no edits;
// rows link to the project's Plan (projects with planning data) or to the Projects register searched by code.
import { CalendarBlank, CaretLeft, CaretRight, Funnel, GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { FilterBar, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { PortfolioGantt, PortfolioGanttLegend, type PortfolioGanttRow } from '@/components/charts/portfolio-gantt';
import { Button, ButtonLink } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { screenHref } from '@/config/screens';
import {
  PG_FILTERS, defaultWindowStart, windowLabel, windowParam, type PgFilter, type PgKpiTint, type PgRow, type PgTarget, type PortfolioScheduleModel,
} from '@/domain/pfplan';
import type { Lang, T } from '@/i18n/translate';
import { projectName } from '@/features/portfolio/view';
import s from './pfplan.module.css';

const KPI_COLOR: Record<PgKpiTint, string> = { ok: OK, n200: 'var(--color-neutral-200)', lo: LO };

/**
 * Link of the screen with its stage filter and window (the zone lives in its cookie): `?filter=` (All omitted) and
 * `?from=YYYY-MM` (the default window omitted, L-8). Filter links keep the window; window links keep the filter.
 */
export function pfplanHref(filter: PgFilter, from: number | null = null): string {
  const q = new URLSearchParams();
  if (filter !== 'all') q.set('filter', filter);
  if (from != null && from !== defaultWindowStart()) q.set('from', windowParam(from));
  const qs = q.toString();
  return screenHref('pfplan') + (qs ? `?${qs}` : '');
}

/** `?filter=` link of the stage segment, keeping the window. */
export const filterHref = (f: PgFilter, from: number | null = null) => pfplanHref(f, from);

/** Row click (4547): Plan of a project with planning data, else the Projects register searched by code (no stage filter). */
export const targetHref = (target: PgTarget) =>
  target.screen === 'plan' ? screenHref('plan', { code: target.code }) : `${screenHref('projects')}?q=${encodeURIComponent(target.q)}`;

function ganttRow(r: PgRow, t: T, lang: Lang): PortfolioGanttRow {
  return {
    key: r.code,
    name: projectName(r, lang),
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

/** "Period": previous quarter · today (the default window, no `?from=`) · next quarter, then the window shown. */
function PeriodLinks({ model, filter, t }: { model: PortfolioScheduleModel; filter: PgFilter; t: T }) {
  const w = model.window;
  const step = (to: number | null, label: string, icon: typeof CaretLeft, right: boolean) =>
    to == null ? (
      <Button variant="secondary" size="xs" disabled icon={right ? undefined : icon} iconRight={right ? icon : undefined}>
        {label}
      </Button>
    ) : (
      <ButtonLink variant="secondary" size="xs" href={pfplanHref(filter, to)} icon={right ? undefined : icon} iconRight={right ? icon : undefined}>
        {label}
      </ButtonLink>
    );
  return (
    <>
      {step(w.prevFrom, t('Previous quarter'), CaretLeft, false)}
      <ButtonLink variant="ghost" size="xs" href={pfplanHref(filter, null)} aria-current={w.isDefault ? 'page' : undefined}>
        {t('Today')}
      </ButtonLink>
      {step(w.nextFrom, t('Next quarter'), CaretRight, true)}
      <span className={s.window}>{windowLabel(w.from, t)}</span>
    </>
  );
}

export function PfPlanBody({ model, filter, zoneSelected, t, lang }: { model: PortfolioScheduleModel; filter: PgFilter; zoneSelected: boolean; t: T; lang: Lang }) {
  return (
    <Stack gap={14}>
      <FilterBar>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Stage')}</FilterLabel>
          <Segmented
            wrap
            label={t('Stage')}
            value={filter}
            options={PG_FILTERS.map((o) => ({ value: o.value, label: t(o.label), href: filterHref(o.value, model.window.from) }))}
          />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel icon={CalendarBlank}>{t('Period')}</FilterLabel>
          <PeriodLinks model={model} filter={filter} t={t} />
        </FilterGroup>
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
          groups={model.groups.map((g) => ({ key: g.key, label: t(g.label), count: g.count, rows: g.rows.map((r) => ganttRow(r, t, lang)) }))}
          todayL={model.todayL}
          labels={{ project: t('Project'), status: t('Status'), gate: `${t('Next decision')} / ${t('Finish')}` }}
        />
      </SectionCard>
    </Stack>
  );
}
