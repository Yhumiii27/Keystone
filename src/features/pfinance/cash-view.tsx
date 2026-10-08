// Cash flow & billing — next 6 months (docs/spec/03 §7, template 2143–2179): zone notice, KPI tiles, "Billing by
// project" and the 6-month cash-flow chart. Server Component.
import { GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { LegendItem } from '@/components/app/Legend';
import { OverlayBar } from '@/components/app/Progress';
import { FlexRow, SectionCard, Stack } from '@/components/app/SectionCard';
import { CashFlowBars } from '@/components/charts/cash-flow-bars';
import { cx } from '@/components/ds/cx';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { CashView as CashViewModel } from './model';
import s from './pfinance.module.css';

const N400 = 'var(--color-neutral-400)';
const ACCENT = 'var(--color-accent)';

export function CashView({ view: v, t }: { view: CashViewModel; t: T }) {
  return (
    <Stack gap={14}>
      {v.zoneEmpty && (
        <Callout icon={GlobeHemisphereEast} role="status">
          {t('No project in this zone for this view')}
        </Callout>
      )}
      <KpiGrid min={150}>
        {v.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <FlexRow gap={14}>
        <SectionCard
          title={t('Billing by project')}
          hint={t('Client projects bill on milestones or monthly progress · internal projects carry no revenue')}
          flex="2.2 1 1010px"
          scroll
        >
          <Table size={13}>
            <thead>
              <tr>
                <Th>{t('Project')}</Th>
                <Th>{t('Billing model')}</Th>
                <Th align="right">{t('Contract')}</Th>
                <Th width="20%">{t('Invoiced · paid')}</Th>
                <Th align="right">{t('Outstanding')}</Th>
                <Th align="right">{t('Cost to date')}</Th>
                <Th align="right">{t('Margin')}</Th>
                <Th>{t('Next milestone')}</Th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.code}>
                  <Td>
                    <div className={cx(s.project, s.cashProject)}>
                      <span className={s.projectName} title={r.name}>
                        {r.name}
                      </span>
                      <span className={s.projectCode}>{r.code}</span>
                    </div>
                  </Td>
                  <Td tone="secondary" nowrap>
                    {r.model}
                  </Td>
                  <Td align="right" numeric nowrap>
                    {r.contract}
                  </Td>
                  <Td>
                    <OverlayBar
                      layers={[
                        { value: r.invoicedPct / 100, color: N400, title: `${t('Invoiced')} · ${r.invoiced}` },
                        { value: r.paidPct / 100, color: ACCENT, title: `${t('Paid')} · ${r.paid}` },
                      ]}
                    />
                  </Td>
                  <Td align="right" numeric nowrap color={r.outColor}>
                    {r.outstanding}
                  </Td>
                  <Td align="right" numeric nowrap>
                    {r.cost}
                  </Td>
                  <Td align="right" numeric color={r.marginColor}>
                    {r.marginText}
                  </Td>
                  <Td tone="secondary" nowrap>
                    {r.next}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className={s.legend}>
            <LegendItem kind="block" color={ACCENT} width={12} height={6}>
              {t('Paid')}
            </LegendItem>
            <LegendItem kind="block" color={N400} width={12} height={6}>
              {t('Invoiced')}
            </LegendItem>
          </div>
        </SectionCard>
        <SectionCard title={t('Cash flow — next 6 months')} subtitle={t('Billing plan in · forecast spend out')} gap={10} flex="1 1 280px">
          <CashFlowBars bars={v.bars} label={t('Cash flow — next 6 months')} />
          <div className={cx(s.legend, s.legendWrap)}>
            <LegendItem kind="block" color={ACCENT}>
              {t('Cash in')}
            </LegendItem>
            <LegendItem kind="block" color="var(--color-neutral-600)">
              {t('Cash out')}
            </LegendItem>
          </div>
          <span className={s.caption}>{t('Net per month above bars')}</span>
        </SectionCard>
      </FlexRow>
    </Stack>
  );
}
