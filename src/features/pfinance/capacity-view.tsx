// Capacity what-if tab of Portfolio — prioritisation & capacity (docs/spec/03 §6.5, template 2118–2138): pipeline
// project selector (`?project=`), verdict card, demand vs capacity by department and the options card.
// Server Component.
import { Scales, Sparkle } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { LegendItem } from '@/components/app/Legend';
import { FlexRow, SectionCard } from '@/components/app/SectionCard';
import { LifecycleTag } from '@/components/app/StatusTag';
import { CapacityDemandBar } from '@/components/charts/capacity-demand-bar';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import type { T } from '@/i18n/translate';
import { prioritisationHref, type CapacityView as CapacityViewModel } from './model';
import s from './pfinance.module.css';

export interface CapacityViewProps {
  /** Zone pipeline projects (codes, register order). */
  candidates: string[];
  current: string;
  view: CapacityViewModel;
  /** Selected ranking row, kept in the links. */
  sel: string | null;
  t: T;
}

export function CapacityView({ candidates, current, view: v, sel, t }: CapacityViewProps) {
  return (
    <>
      <div className={s.selector}>
        <span className={s.selectorLabel}>{t('Pipeline project to absorb')}</span>
        <Segmented
          wrap
          value={current}
          label={t('Pipeline project to absorb')}
          options={candidates.map((code) => ({ value: code, label: code, href: prioritisationHref({ tab: 'capacity', project: code, sel }) }))}
        />
      </div>
      <SectionCard variant="tinted" gap={6}>
        <div className={s.verdictHead}>
          <Scales className={s.accentIcon} aria-hidden />
          <div className={s.verdictTitle}>
            <span className={s.verdictName}>{v.name}</span>
            <span className={s.verdictSub}>{v.budgetLine}</span>
          </div>
          <LifecycleTag status={v.stage} label={v.status} />
        </div>
        <span className={s.verdict} style={{ '--verdict-color': v.verdictColor } as CSSProperties} role="status">
          {v.verdict}
        </span>
        <span className={s.gapLine}>{v.gapLine}</span>
      </SectionCard>
      <FlexRow gap={14}>
        <SectionCard
          title={t('Demand vs capacity by department — next 8 weeks')}
          subtitle={t('Current commitments + the candidate project · tick = available capacity')}
          gap={10}
          flex="1.6 1 560px"
        >
          {v.rows.map((r) => (
            <div key={r.name} className={s.dept}>
              <div className={s.deptHead}>
                <span className={s.deptName}>{r.name}</span>
                <span className={s.deptAdd}>{r.addText}</span>
                <span className={s.deptTotal} style={{ '--dept-color': r.color } as CSSProperties}>
                  {r.text}
                </span>
              </div>
              <CapacityDemandBar committedPct={r.committedPct} candidatePct={r.candidatePct} capacityPct={r.capacityPct} label={`${r.name} · ${r.text}`} />
            </div>
          ))}
          <div className={s.legend}>
            <LegendItem kind="block" color="var(--color-neutral-600)" width={12} height={6}>
              {t('Committed')}
            </LegendItem>
            <LegendItem kind="block" color="var(--color-accent)" width={12} height={6}>
              {t('Candidate project')}
            </LegendItem>
            <LegendItem kind="tick" color="var(--color-neutral-200)" width={2} height={10}>
              {t('Capacity')}
            </LegendItem>
          </div>
        </SectionCard>
        <SectionCard gap={6} flex="1 1 260px">
          <div className={s.optionsHead}>
            <Sparkle className={s.accentIcon} aria-hidden />
            <CardTitle>{t('Options')}</CardTitle>
          </div>
          {v.options.map((o) => (
            <div key={o} className={s.option}>
              {o}
            </div>
          ))}
          <span className={s.footnote}>{t('Demand is estimated from budget and past projects of the same type until the WBS is planned.')}</span>
        </SectionCard>
      </FlexRow>
    </>
  );
}
