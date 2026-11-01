// R-205 (K-205, K-205b): « Analyse de risques » section of the Risk register — the last stored Monte-Carlo run (date, author,
// iterations, inputs), its finish and cost percentiles with the probability of meeting the target, histogram and S-curve of each,
// the tornado and the criticality index, the risks simulated with their delay, and (`?analysis=ranges`) the three-point estimates
// of the activities. The project's leads run the analysis and enter the ranges (buttons.tsx); everybody else reads it.
// Server Component.
import { ArrowsClockwise, Info } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { LO } from '@/components/app/tones';
import { ButtonLink } from '@/components/ds/Button';
import { Tag } from '@/components/ds/Tag';
import { CellStack, Table, Td, Th } from '@/components/ds/Table';
import { addCalendarDays } from '@/domain/calendar';
import { DEFAULT_RANGE_HIGH, DEFAULT_RANGE_LOW, MC_ITERATION_CHOICES, MC_ITERATIONS_DEFAULT, defaultRange, type HistogramBin, type ThreePoint } from '@/domain/monte-carlo';
import { longDateText, shortDateText } from '@/domain/schedule-rollup';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { parisParts } from '@/server/db/codes';
import type { RiskAnalysisData } from '@/server/dal/risk-analysis';
import { EditDelayButton, EditRangeButton, RunAnalysisButton } from './buttons';
import { curveModel, histogramModel, type Marker } from './chart-model';
import { DistributionChart } from './distribution-chart';
import s from './risk-analysis.module.css';

export interface RiskAnalysisSectionProps {
  code: string;
  /** Dialog sub-line: the project's label. */
  context: string;
  data: RiskAnalysisData;
  /** The viewer is a lead on a project they may edit. */
  canEdit: boolean;
  /** `?analysis=ranges`: show the three-point estimates table. */
  showRanges: boolean;
  /** The register's URL with and without `?analysis=ranges`. */
  rangesHref: string;
  summaryHref: string;
  t: T;
  lang: Lang;
}

const pctText = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)} %`);
const num = (v: number, lang: Lang) => v.toLocaleString(intlLocale(lang), { maximumFractionDigits: 1 });
const tripleText = (r: ThreePoint, lang: Lang) => `${num(r.min, lang)} / ${num(r.likely, lang)} / ${num(r.max, lang)}`;

export function RiskAnalysisSection({ code, context, data, canEdit, showRanges, rangesHref, summaryHref, t, lang }: RiskAnalysisSectionProps) {
  const run = data.latest;
  const r = run?.result;
  const year = Number(data.dataDate.slice(0, 4));
  const longDate = (iso: string) => t(longDateText(iso));
  const shortDate = (iso: string) => t(shortDateText(iso, year));
  const dayDate = (d: number) => shortDate(addCalendarDays(r?.dataDate ?? data.dataDate, Math.round(d)));
  const k = (v: number) => money(v, lang);
  const entered = data.activities.filter((a) => a.durationRange || a.costRange).length;
  const nameOf = new Map(data.activities.map((a) => [a.code, dataText(a.name, lang)]));
  const riskOf = new Map(data.risks.map((x) => [x.number, x]));
  const targetSource = data.target.source === 'planned' ? t('planned finish') : data.target.source === 'baseline' ? t('baseline finish') : null;
  const runs = (n: number) => `${n.toLocaleString(intlLocale(lang))} ${t(n > 1 ? 'runs' : 'run')}`;

  const header = (
    <div className={s.head}>
      <div className={s.meta}>
        {run ? (
          <>
            {t('Last run')} · {longDate(parisParts(run.ranAt).iso)} · {dataText(run.ranByName, lang)} · {run.iterations.toLocaleString(intlLocale(lang))} {t('iterations')} ·{' '}
            {t('data date')} {longDate(run.dataDate)}
          </>
        ) : (
          t('Not run yet')
        )}
      </div>
      {canEdit && <RunAnalysisButton code={code} context={context} choices={MC_ITERATION_CHOICES} fallback={run?.iterations ?? MC_ITERATIONS_DEFAULT} rerun={!!run} />}
    </div>
  );

  const finishMarkers: Marker[] = r
    ? [
        { label: 'P50', value: r.finish.p50, kind: 'percentile' },
        { label: 'P80', value: r.finish.p80, kind: 'percentile' },
        ...(r.finish.target ? [{ label: t('Target'), value: daysFrom(r.dataDate, r.finish.target), kind: 'target' as const }] : []),
      ]
    : [];
  const costMarkers: Marker[] = r
    ? [
        { label: 'P50', value: r.cost.p50, kind: 'percentile' },
        { label: 'P80', value: r.cost.p80, kind: 'percentile' },
        ...(r.cost.target ? [{ label: t('Budget'), value: r.cost.target, kind: 'target' as const }] : []),
      ]
    : [];
  const binTip = (fmt: (v: number) => string) => (b: HistogramBin) => `${fmt(b.from)} – ${fmt(b.to)} · ${runs(b.count)}`;

  return (
    <SectionCard
      title={t('Risk analysis (Monte-Carlo)')}
      hint={t('Three-point estimates on durations and costs · risks linked to an activity occur with their probability · triangular distributions')}
      gap={12}
    >
      {header}
      {run && data.stale && (
        <Callout variant="compact" icon={ArrowsClockwise} role="status">
          {t('The schedule, the risks or the ranges changed since this run · run it again for current figures')}
        </Callout>
      )}
      {!run && (
        <Callout variant="note" icon={Info}>
          {t('The analysis simulates the schedule and the cost many times with uncertain durations and costs and the risks of the register, and gives the dates and costs reached with 50 %, 80 % and 90 % confidence.')}
        </Callout>
      )}

      {r && run && (
        <Stack gap={12}>
          <KpiGrid min={150}>
            <KpiTile label={t('P50 finish')} value={shortDate(r.finish.dates.p50)} sub={`${t('Plan')} · ${shortDate(r.deterministic.finish)}`} />
            <KpiTile label={t('P80 finish')} value={shortDate(r.finish.dates.p80)} sub={`P90 · ${shortDate(r.finish.dates.p90)}`} />
            <KpiTile
              label={t('Chance of meeting the end date')}
              value={pctText(r.finish.probOnTarget)}
              color={r.finish.probOnTarget != null && r.finish.probOnTarget < 0.5 ? LO : undefined}
              alertLabel={t('Needs attention')}
              sub={r.finish.target ? `${targetSource ?? t('Target')} · ${shortDate(r.finish.target)}` : t('No target date')}
            />
            <KpiTile label={t('P50 cost')} value={k(r.cost.p50)} sub={`${t('Plan')} · ${k(r.deterministic.cost)}`} />
            <KpiTile label={t('P80 cost')} value={k(r.cost.p80)} sub={`P90 · ${k(r.cost.p90)}`} />
            <KpiTile
              label={t('Chance of staying within budget')}
              value={pctText(r.cost.probWithinTarget)}
              color={r.cost.probWithinTarget != null && r.cost.probWithinTarget < 0.5 ? LO : undefined}
              alertLabel={t('Needs attention')}
              sub={r.cost.target ? `BAC · ${k(r.cost.target)}` : t('No budget')}
            />
          </KpiGrid>

          <div className={s.charts}>
            <div className={s.chart}>
              <div className={s.chartTitle}>{t('Finish date — distribution')}</div>
              <DistributionChart model={histogramModel(r.finish.histogram, dayDate, finishMarkers, binTip(dayDate))} label={t('Finish date — distribution')} />
            </div>
            <div className={s.chart}>
              <div className={s.chartTitle}>{t('Finish date — cumulative probability')}</div>
              <CurveChart curve={r.finish.curve} fmt={dayDate} markers={finishMarkers} label={t('Finish date — cumulative probability')} />
            </div>
            <div className={s.chart}>
              <div className={s.chartTitle}>{t('Cost at completion — distribution')}</div>
              <DistributionChart model={histogramModel(r.cost.histogram, k, costMarkers, binTip(k))} label={t('Cost at completion — distribution')} />
            </div>
            <div className={s.chart}>
              <div className={s.chartTitle}>{t('Cost at completion — cumulative probability')}</div>
              <CurveChart curve={r.cost.curve} fmt={k} markers={costMarkers} label={t('Cost at completion — cumulative probability')} />
            </div>
          </div>

          <div className={s.split}>
            <div className={s.panel}>
              <div className={s.chartTitle}>{t('What drives the finish (tornado)')}</div>
              <div className={s.note}>{t('Correlation between the uncertainty of an activity or the occurrence of a risk and the project finish')}</div>
              {r.tornado.length ? (
                <div className={s.tornado}>
                  {r.tornado.map((d) => (
                    <div key={`${d.kind}-${d.id}`} className={s.tornadoRow}>
                      <span className={s.tornadoLabel} title={d.kind === 'risk' ? dataText(riskOf.get(d.id)?.title ?? '', lang) : nameOf.get(d.id)}>
                        {d.id} · {d.kind === 'risk' ? dataText(riskOf.get(d.id)?.title ?? '', lang) : nameOf.get(d.id) ?? ''}
                      </span>
                      <span className={s.tornadoTrack}>
                        <span className={s.tornadoBar} style={{ width: `${Math.round(Math.abs(d.correlation) * 100)}%` }} />
                      </span>
                      <span className={s.tornadoValue}>{d.correlation.toLocaleString(intlLocale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.note}>{t('No activity or risk stands out')}</div>
              )}
            </div>
            <div className={s.panel}>
              <div className={s.chartTitle}>{t('Criticality index')}</div>
              <div className={s.note}>{t('Share of the runs where the activity is on the critical path')}</div>
              <Table size={12.5}>
                <thead>
                  <tr>
                    <Th>{t('Activity')}</Th>
                    <Th align="right">{t('Critical')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.criticality.slice(0, 10).map((d) => (
                    <tr key={d.id}>
                      <Td>
                        {d.id} · {nameOf.get(d.id) ?? ''}
                      </Td>
                      <Td numeric>{pctText(d.criticality)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        </Stack>
      )}

      <div className={s.panel}>
        <div className={s.chartTitle}>{t('Risks in the simulation')}</div>
        <div className={s.note}>{t('Open risks: probability P / 5, delay on the linked activity if it occurs (default impact × 5 working days), cost if it occurs')}</div>
        {data.risks.length ? (
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Risk')}</Th>
                <Th>{t('Linked activity')}</Th>
                <Th align="right">{t('Probability')}</Th>
                <Th align="right">{t('Delay')}</Th>
                <Th align="right">{t('Cost if it occurs')}</Th>
                {r && <Th align="right">{t('Occurred')}</Th>}
                {canEdit && <Th />}
              </tr>
            </thead>
            <tbody>
              {data.risks.map((x) => (
                <tr key={x.id}>
                  <Td>
                    <CellStack title={x.number} sub={dataText(x.title, lang)} />
                  </Td>
                  <Td>{x.activityCode ?? t('None · cost only')}</Td>
                  <Td numeric>{pctText(x.probability / 5)}</Td>
                  <Td numeric>
                    {x.activityCode ? `${x.delayDays} ${t('wd')}` : '—'} {!x.delayEntered && x.activityCode && <Tag size="xs">{t('default')}</Tag>}
                  </Td>
                  <Td numeric>{x.costKeur ? k(x.costKeur) : '—'}</Td>
                  {r && <Td numeric>{pctText(r.risks.find((o) => o.id === x.number)?.occurrence ?? null)}</Td>}
                  {canEdit && (
                    <Td align="right">
                      {x.activityCode && <EditDelayButton code={code} riskId={x.id} context={`${x.number} · ${dataText(x.title, lang)}`} initial={x.delayEntered ? String(x.delayDays) : ''} />}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className={s.note}>{t('No open risk')}</div>
        )}
      </div>

      <div className={s.head}>
        <div className={s.meta}>
          {t('Three-point estimates')} · {entered} / {data.activities.length} {t('activities entered')} ·{' '}
          {t('default range')} −{Math.round((1 - DEFAULT_RANGE_LOW) * 100)} % / +{Math.round((DEFAULT_RANGE_HIGH - 1) * 100)} %
        </div>
        <ButtonLink variant="ghost" size="sm" href={showRanges ? summaryHref : rangesHref} scroll={false}>
          {t(showRanges ? 'Hide the estimates' : 'Show the estimates')}
        </ButtonLink>
      </div>
      {showRanges && (
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Activity')}</Th>
              <Th>{t('Status')}</Th>
              <Th align="right">{t('Duration · min / most likely / max (wd)')}</Th>
              <Th align="right">{t('Cost at completion · min / most likely / max')}</Th>
              {canEdit && <Th />}
            </tr>
          </thead>
          <tbody>
            {data.activities.map((a) => {
              const d = a.durationRange ?? defaultRange(a.duration);
              const c = a.costRange ?? defaultRange(a.eac);
              const done = a.state === 'complete';
              return (
                <tr key={a.id}>
                  <Td>
                    <CellStack title={a.code} sub={dataText(a.name, lang)} />
                  </Td>
                  <Td>{t(done ? 'Completed' : a.state === 'in_progress' ? 'In progress' : 'Not started')}</Td>
                  <Td numeric>
                    {done ? '—' : tripleText(d, lang)} {!done && !a.durationRange && <Tag size="xs">{t('default')}</Tag>}
                  </Td>
                  <Td numeric>
                    {done ? '—' : `${tripleText(c, lang)} k€`} {!done && !a.costRange && <Tag size="xs">{t('default')}</Tag>}
                  </Td>
                  {canEdit && (
                    <Td align="right">
                      {!done && (
                        <EditRangeButton
                          code={code}
                          activityId={a.id}
                          context={`${a.code} · ${dataText(a.name, lang)}`}
                          initial={{
                            dMin: a.durationRange ? String(d.min) : '', dLikely: a.durationRange ? String(d.likely) : '', dMax: a.durationRange ? String(d.max) : '',
                            cMin: a.costRange ? String(c.min) : '', cLikely: a.costRange ? String(c.likely) : '', cMax: a.costRange ? String(c.max) : '',
                          }}
                        />
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </SectionCard>
  );
}

function daysFrom(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function CurveChart({ curve, fmt, markers, label }: { curve: { x: number; p: number }[]; fmt: (v: number) => string; markers: Marker[]; label: string }) {
  const model = curveModel(curve, fmt, markers);
  const pts = model.path ? model.path.split(' ').map((seg) => seg.slice(1).split(',').map(Number)) : [];
  const tips = pts.map(([x, y], i) => ({ x, y, tip: `${fmt(curve[i].x)} · ${Math.round(curve[i].p * 100)} %` }));
  return <DistributionChart model={model} label={label} pointTips={tips} />;
}
