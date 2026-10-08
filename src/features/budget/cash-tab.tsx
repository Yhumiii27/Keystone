// Budget › Cash & recovery tab (docs/spec/04 §1.6; template 448–481, logic 4904–4928). Server Component.
import { EmptyState, KpiGrid, KpiTile, LO, Legend, LegendItem, OK, SectionCard } from '@/components/app';
import { CashRecoveryChart } from '@/components/charts/cash-recovery-chart';
import { CardTitle } from '@/components/ds/Card';
import { Table, Td, Th } from '@/components/ds/Table';
import { RECOVERY_MONTHS, type CashRecovery } from '@/domain/evm';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import s from './budget.module.css';

export interface CashTabProps {
  /** Null when the project has no client contract → empty state. */
  recovery: CashRecovery | null;
  contractTotal: number;
  /** Contract payment terms text ("Net 45 days"). */
  terms: string;
  /** Actual cost to date (k€). */
  ac: number;
  lang: Lang;
  t: T;
}

export function CashTab({ recovery: rc, contractTotal, terms, ac, lang, t }: CashTabProps) {
  if (!rc)
    return (
      <div className={s.stack}>
        <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
      </div>
    );
  const f = (k: number, signed?: boolean) => money(k, lang, { signed });
  const month = (i: number) => RECOVERY_MONTHS[i];
  const what = (i: number) => rc.recWhat[i].join(' · ');
  const coverage = rc.committedNow ? rc.paid / rc.committedNow : 0;
  const low = rc.recov[rc.lowI];
  const kpis = [
    {
      label: 'Client payments received',
      value: f(rc.paid),
      sub: `${rc.paidCount} milestones paid · ${contractTotal ? Math.round((rc.paid / contractTotal) * 100) : 0} % of contract`,
      color: OK,
    },
    { label: 'Committed to date', value: f(rc.committedNow), sub: `${f(ac)} actual cost · ${f(rc.openCommit)} orders placed`, color: OK },
    {
      label: 'Recovery',
      value: f(rc.recNow, true),
      sub: rc.recNow < 0 ? 'we are financing the project' : 'the client is financing the project',
      color: rc.recNow < 0 ? LO : OK,
    },
    { label: 'Coverage', value: `${Math.round(coverage * 100)} %`, sub: 'received ÷ committed', color: coverage < 0.8 ? LO : OK },
    {
      label: 'Next receipt',
      value: rc.nextI >= 0 ? f(rc.recP[rc.nextI]) : '—',
      sub: rc.nextI >= 0 ? `${what(rc.nextI)} · ${month(rc.nextI)} · ${terms}` : 'nothing outstanding',
      color: OK,
    },
    {
      label: 'Lowest point',
      value: f(low, true),
      sub: month(rc.lowI) + (rc.lowI <= rc.todayM ? ' · already passed' : ' · still ahead'),
      color: low < 0 ? LO : OK,
    },
  ];

  return (
    <div className={s.stack}>
      <KpiGrid min={150}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={t(k.label)} value={k.value} sub={t(k.sub)} color={k.color} />
        ))}
      </KpiGrid>

      {/* Cash recovery chart (452–473) */}
      <SectionCard gap={10} scroll>
        <div className={s.cardHead}>
          <div className={s.titleCol}>
            <CardTitle>{t('Cash recovery')}</CardTitle>
            <span className={`${s.subtitle} ${s.pretty}`}>
              {t('Client payments received against what the project has committed · a negative gap is financed by Keystone')}
            </span>
          </div>
          <Legend>
            <LegendItem kind="line" color="var(--color-accent)">
              {t('Client receipts (cumulative)')}
            </LegendItem>
            <LegendItem kind="line" color="var(--color-neutral-100)">
              {t('Committed (actual + orders placed)')}
            </LegendItem>
            <LegendItem kind="line" lineStyle="dotted" color="var(--color-neutral-100)">
              {t('Forecast')}
            </LegendItem>
          </Legend>
        </div>
        <CashRecoveryChart recovery={rc} contractTotal={contractTotal} lang={lang} t={t} />
      </SectionCard>

      {/* Monthly schedule (474–477) — rows carry an inline background (today accent-900, else transparent), which
          also hides the DS row rule and hover tint as in the prototype. */}
      <SectionCard scroll title={t('Monthly schedule')}>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Month')}</Th>
              <Th align="right">{t('Receipts')}</Th>
              <Th>{t('Milestones')}</Th>
              <Th align="right">{t('Commitments')}</Th>
              <Th align="right">{t('Recovery (cumulative)')}</Th>
            </tr>
          </thead>
          <tbody>
            {RECOVERY_MONTHS.map((l, i) => {
              const rec = rc.recA[i] + rc.recP[i];
              const isNow = i === rc.todayM;
              return (
                <tr key={l} style={{ background: isNow ? 'var(--color-accent-900)' : 'transparent' }} aria-current={isNow ? 'date' : undefined}>
                  <Td numeric nowrap>
                    {t(l)}
                  </Td>
                  <Td align="right" numeric color={rc.recP[i] && !rc.recA[i] ? 'var(--color-neutral-400)' : 'var(--color-text)'}>
                    {rc.recA[i] || rc.recP[i] ? f(rec) : '—'}
                  </Td>
                  <Td tone="muted" nowrap>
                    {what(i)}
                  </Td>
                  <Td align="right" numeric>
                    <div className={s.comCell}>
                      <span>{f(i ? rc.cumCom[i] - rc.cumCom[i - 1] : rc.cumCom[0])}</span>
                      {isNow && rc.openCommit ? <span className={s.comNote}>{t(`incl. ${f(rc.openCommit)} orders placed`)}</span> : null}
                    </div>
                  </Td>
                  <Td align="right" numeric className={s.strong} color={rc.recov[i] < 0 ? LO : OK}>
                    {f(rc.recov[i], true)}
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
