// R-208 (K-208 alt1): « Dérive prévue » card of the Trends & status screen — the rule-based forecast of the finish slip and the
// cost overrun (src/domain/drift-forecast.ts), its confidence, the reasons, and the mitigation suggestions of the rule table.
// Always labelled as a rule-based estimate (no machine learning). Server Component.
import { Lightbulb } from '@phosphor-icons/react/dist/ssr';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO } from '@/components/app/tones';
import { Tag, type TagTone } from '@/components/ds/Tag';
import type { Confidence, CostMethod, DriftReason, DriftSuggestion, FinishMethod, ReasonCode, RuleId, Severity } from '@/domain/drift-forecast';
import { longDateText } from '@/domain/schedule-rollup';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { ProjectDrift } from '@/server/dal/drift-forecast';
import s from './risk-analysis.module.css';

const CONFIDENCE: Record<Confidence, string> = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };
const SEVERITY: Record<Severity, { label: string; tone: TagTone }> = {
  high: { label: 'Act now', tone: 'accent' },
  medium: { label: 'Watch', tone: 'outline' },
  low: { label: 'Tip', tone: 'neutral' },
};
const FINISH_METHOD: Record<FinishMethod, string> = { schedule: 'from the schedule', evm: 'from the earned-value pace (SPI)', monte_carlo: 'Monte-Carlo P80' };
const COST_METHOD: Record<CostMethod, string> = { cpi: 'EAC = BAC / CPI', composite: 'EAC = AC + (BAC − EV) / (CPI × SPI)', monte_carlo: 'Monte-Carlo P80' };

const REASON: Record<ReasonCode, string> = {
  spi_low: 'Work is earned slower than planned (SPI)',
  cpi_low: 'Work costs more than budgeted (CPI)',
  tcpi_high: 'The remaining work must be done more efficiently than planned (TCPI)',
  schedule_late: 'The scheduled finish is after the target (calendar days)',
  float_negative: 'Negative float on the critical path (working days)',
  float_eroding: 'Float lost since the last weekly snapshot (working days)',
  milestones_late: 'Late milestones',
  mc_on_time_low: 'Monte-Carlo: low chance of meeting the end date',
  mc_budget_low: 'Monte-Carlo: low chance of staying within budget',
  eac_over_bac: 'Forecast cost above the budget',
  no_evm: 'No earned value yet: forecast from the schedule only',
  early_progress: 'Early in the project: earned value is not reliable yet (% complete)',
  mc_missing: 'No Monte-Carlo risk analysis yet',
  mc_stale: 'The last Monte-Carlo run is out of date: not used',
};

const RULE: Record<RuleId, string> = {
  spi_critical: 'Resequence the work or add resources on the critical activities',
  cpi_review: 'Review the open commitments and the estimates to complete',
  tcpi_reestimate: 'Re-estimate the cost at completion or plan a draw on the contingency',
  milestone_float: 'Early warning to the project manager: no float left on these milestones',
  negative_float: 'Recovery plan: compress the critical path (overlap or crash these activities)',
  float_eroding: 'Float is being consumed: review the critical path every week',
  mc_drivers: 'Treat what drives the finish first',
  mc_budget: 'Review the risk responses and the contingency',
  contingency_short: 'The forecast overrun exceeds the contingency left: prepare a change request or a budget review',
  mc_rerun: 'Run the risk analysis again: its inputs changed',
  mc_run: 'Run the Monte-Carlo risk analysis (Risk register) to measure the uncertainty',
};

export function DriftForecastCard({ drift, t, lang }: { drift: ProjectDrift; t: T; lang: Lang }) {
  const f = drift.forecast;
  const k = (v: number) => money(v, lang);
  const n2 = (v: number) => v.toLocaleString(intlLocale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const name = (code: string) => (drift.names[code] ? `${code} · ${dataText(drift.names[code], lang)}` : dataText(code, lang));

  const reasonValue = (r: DriftReason): string | null => {
    if (r.names) return r.names.map((x) => dataText(x, lang)).join(', ');
    if (r.value == null) return null;
    switch (r.code) {
      case 'spi_low':
      case 'cpi_low':
      case 'tcpi_high':
        return n2(r.value);
      case 'eac_over_bac':
        return `+${k(r.value)}`;
      case 'mc_on_time_low':
      case 'mc_budget_low':
        return pct(r.value);
      case 'early_progress':
        return `${r.value} %`;
      default:
        return String(r.value);
    }
  };
  const suggestionValue = (sg: DriftSuggestion): string | null => {
    const targets = sg.targets.length ? sg.targets.map(name).join(' · ') : null;
    const v =
      sg.value == null
        ? null
        : sg.rule === 'cpi_review'
          ? `${t('open commitments')} ${k(sg.value)}`
          : sg.rule === 'contingency_short'
            ? `${t('gap')} ${k(sg.value)}`
            : sg.rule === 'mc_drivers' || sg.rule === 'mc_budget'
              ? pct(sg.value)
              : sg.rule === 'spi_critical' || sg.rule === 'tcpi_reestimate'
                ? n2(sg.value)
                : `${sg.value} ${t('wd')}`;
    return [v, targets].filter(Boolean).join(' · ') || null;
  };

  const slip = f.finish.slipDays;
  const over = f.cost.overrunKeur;
  return (
    <SectionCard
      title={t('Forecast drift')}
      hint={t('Rule-based estimate from earned value, the schedule and the risk analysis · not a prediction model')}
      actions={<Tag tone={f.confidence === 'high' ? 'neutral' : 'outline'}>{t(CONFIDENCE[f.confidence])}</Tag>}
      gap={12}
    >
      <KpiGrid min={170}>
        <KpiTile
          label={t('Forecast finish')}
          value={f.finish.date ? t(longDateText(f.finish.date)) : '—'}
          sub={f.finish.method ? t(FINISH_METHOD[f.finish.method]) : undefined}
        />
        <KpiTile
          label={t('Finish slip')}
          value={slip == null ? '—' : `${slip > 0 ? '+' : ''}${slip} ${t('days')}`}
          color={slip != null && slip > 0 ? LO : undefined}
          alertLabel={t('Needs attention')}
          sub={f.finish.target ? `${t('Target')} · ${t(longDateText(f.finish.target))}` : t('No target date')}
        />
        <KpiTile label={t('Forecast cost at completion')} value={f.cost.eac == null ? '—' : k(f.cost.eac)} sub={f.cost.method ? t(COST_METHOD[f.cost.method]) : undefined} />
        <KpiTile
          label={t('Cost overrun')}
          value={over == null ? '—' : `${over > 0 ? '+' : ''}${k(over)}`}
          color={over != null && over > 0 ? LO : undefined}
          alertLabel={t('Needs attention')}
          sub={f.cost.overrunShare != null && f.cost.bac ? `${pct(f.cost.overrunShare)} · BAC ${k(f.cost.bac)}` : undefined}
        />
      </KpiGrid>
      <div className={s.split}>
        <div className={s.panel}>
          <div className={s.chartTitle}>{t('Why')}</div>
          {f.reasons.length ? (
            <ul className={s.list}>
              {f.reasons.map((r, i) => {
                const v = reasonValue(r);
                return (
                  <li key={i}>
                    {t(REASON[r.code])}
                    {v && <span className={s.value}> · {v}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={s.note}>{t('Nothing points to a drift')}</div>
          )}
        </div>
        <div className={s.panel}>
          <div className={s.chartTitle}>{t('Suggested mitigations')}</div>
          {f.suggestions.length ? (
            <ul className={s.suggestions}>
              {f.suggestions.map((sg, i) => {
                const v = suggestionValue(sg);
                return (
                  <li key={i} className={s.suggestion}>
                    <Lightbulb aria-hidden className={s.icon} />
                    <span>
                      <Tag size="xs" tone={SEVERITY[sg.severity].tone}>
                        {t(SEVERITY[sg.severity].label)}
                      </Tag>{' '}
                      {t(RULE[sg.rule])}
                      {v && <span className={s.value}> · {v}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={s.note}>{t('No mitigation needed')}</div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/** The English labels of the card (the i18n test checks each has its French). */
export const DRIFT_LABELS: readonly string[] = [
  ...Object.values(CONFIDENCE), ...Object.values(SEVERITY).map((x) => x.label), ...Object.values(FINISH_METHOD), ...Object.values(REASON), ...Object.values(RULE),
  'Monte-Carlo P80',
];
