// Budget › Performance tab (docs/spec/04 §1.4; template 289–378, logic 3816–3845, 5179). Server Component.
import { ArrowRight, Steps } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { BulletBar, KpiGrid, KpiTile, LO, Legend, LegendItem, OK, SectionCard } from '@/components/app';
import { EvmSCurve } from '@/components/charts/evm-s-curve';
import { ButtonLink } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { Table, Td, Th } from '@/components/ds/Table';
import { costVarianceBars, offerPoints, type EvmCore, type OfferQuote } from '@/domain/evm';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { CostControl } from '@/server/dal/cost';
import s from './budget.module.css';

export interface PerformanceTabProps {
  cost: CostControl;
  core: EvmCore;
  offer: OfferQuote[];
  /** `costProfile.sourceText · costProfile.rexText`, already translated. */
  profileText: string;
  /** Link to the Structure & changes tab ("See profile"). */
  setupHref: string;
  lang: Lang;
  t: T;
}

export function PerformanceTab({ cost, core, offer, profileText, setupHref, lang, t }: PerformanceTabProps) {
  const f = (k: number, signed?: boolean) => money(k, lang, { signed });
  const { bac } = cost;
  const kpis = [
    { label: 'Budget (BAC)', value: f(bac), sub: 'Approved baseline', color: OK },
    { label: 'Actual cost', value: f(core.ac), sub: `${Math.round((core.ac / bac) * 100)}% of budget`, color: OK },
    { label: 'Earned value', value: f(core.ev), sub: 'Work completed', color: OK },
    // Q1: the prototype colours these four LO whatever the value.
    { label: 'Forecast (EAC)', value: f(core.eac), sub: 'At current CPI', color: LO },
    { label: 'Variance (VAC)', value: f(core.vac, true), sub: `${Math.round((core.vac / bac) * 1000) / 10}% of budget`, color: LO },
    { label: 'CPI', value: core.cpi.toFixed(2), sub: 'Target ≥ 1.00', color: LO },
    { label: 'TCPI', value: core.tcpi.toFixed(2), sub: 'Needed to hit BAC', color: LO },
  ];
  const bars = costVarianceBars(cost.ev, cost.ac);

  return (
    <div className={s.stack}>
      <KpiGrid min={140}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={t(k.label)} value={k.value} sub={t(k.sub)} color={k.color} />
        ))}
      </KpiGrid>

      <div className={s.cardsRow}>
        {/* B1 — Budget vs cost (302–334) */}
        <SectionCard gap={10} flex="3 1 560px">
          <div className={s.cardHead}>
            <div className={s.titleCol}>
              <CardTitle>{t('Budget vs cost')}</CardTitle>
              <span className={s.subtitle}>{t('Cumulative, earned-value method')}</span>
            </div>
            <Legend>
              <LegendItem kind="line" lineStyle="dashed" color="var(--color-neutral-500)">
                {t('Planned (PV)')}
              </LegendItem>
              <LegendItem kind="line" color="var(--color-accent)">
                {t('Earned (EV)')}
              </LegendItem>
              <LegendItem kind="line" color="var(--color-neutral-100)">
                {t('Actual (AC)')}
              </LegendItem>
              <LegendItem kind="line" lineStyle="dotted" color="var(--color-neutral-100)">
                {t('Forecast')}
              </LegendItem>
            </Legend>
          </div>
          <EvmSCurve
            series={{ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac }}
            eac={core.eac}
            points={offerPoints(offer)}
            chartMonths={cost.chartMonths}
            lang={lang}
            t={t}
          />
          <div className={s.chartFoot}>
            <Steps className={s.chartFootIcon} aria-hidden />
            <span className={s.chartFootText}>
              {/* R-073: PV comes from the cost-loaded baseline; the prototype's series followed the offer's disbursement profile. */}
              {cost.evmSource === 'keystone'
                ? `${t('Planned value follows the cost-loaded baseline')} · ${t('Earned value = progress × budget')} · ${profileText}`
                : `${t('Planned value follows the disbursement profile')} · ${profileText}`}
            </span>
            <ButtonLink href={setupHref} variant="ghost" size="xs" push nowrap iconRight={ArrowRight} scroll={false}>
              {t('See profile')}
            </ButtonLink>
          </div>
        </SectionCard>

        {/* B2 — Variance (335–351) */}
        <SectionCard gap={12} flex="1 1 280px" title={t('Variance')}>
          <div className={s.varGrid}>
            <div className={s.varItem}>
              <span className={s.varLabel}>{t('Cost (EV−AC)')}</span>
              <span className={s.varValue}>{f(core.cv, true)}</span>
            </div>
            <div className={s.varItem}>
              <span className={s.varLabel}>{t('Schedule (EV−PV)')}</span>
              <span className={s.varValue}>{f(core.sv, true)}</span>
            </div>
          </div>
          <div className={s.caption}>{t('Cumulative cost variance by month')}</div>
          <div className={s.bars}>
            {bars.map((b, i) => (
              <div key={i} className={s.barCol}>
                <div className={s.bar} style={{ '--bar-h': `${b.h}%` } as CSSProperties} title={f(b.cv, true)} />
                <span className={s.barLabel}>{t((cost.chartMonths[i] ?? '')[0] ?? '')}</span>
              </div>
            ))}
          </div>
          <div className={s.note}>
            {t(cost.note)} {t('To finish on budget the remaining work needs a CPI of')}{' '}
            <span className={s.noteAccent}>{core.tcpi.toFixed(2)}</span>.
          </div>
        </SectionCard>
      </div>

      {/* C — Cost breakdown (353–376) */}
      <SectionCard scroll title={t('Cost breakdown')} hint={t("Bar spans 140% of each line's budget · tick = budget")}>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Category')}</Th>
              <Th align="right">{t('Budget')}</Th>
              <Th align="right">{t('Actual')}</Th>
              <Th align="right">{t('Committed')}</Th>
              <Th align="right">{t('Forecast')}</Th>
              <Th width="30%">{t('Actual · committed · forecast')}</Th>
              <Th align="right">{t('Variance')}</Th>
            </tr>
          </thead>
          <tbody>
            {cost.categories.map((c) => {
              const v = c.budget - c.forecast;
              return (
                <tr key={c.code}>
                  <Td className={s.strong}>{t(c.name)}</Td>
                  <Td align="right" numeric>
                    {f(c.budget)}
                  </Td>
                  <Td align="right" numeric>
                    {f(c.actual)}
                  </Td>
                  <Td align="right" numeric color="var(--color-neutral-400)">
                    {c.committed ? f(c.committed) : '—'}
                  </Td>
                  <Td align="right" numeric>
                    {f(c.forecast)}
                  </Td>
                  <Td>
                    {/* The committed layer stops at the end of the track (open orders can exceed the line's budget). */}
                    <BulletBar actual={c.actual} committed={Math.min(c.committed, Math.max(0, c.budget * 1.4 - c.actual))} budget={c.budget} forecast={c.forecast} />
                  </Td>
                  <Td align="right" numeric color={v < 0 ? LO : 'var(--color-neutral-300)'}>
                    {f(v, true)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
