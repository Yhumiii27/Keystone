// Trends & status report body (docs/spec/04 §2, template 1737–1770): KPI row, six selectable indicator cards
// (`?kpi=`), the 13-week trend chart of the selected indicator and the snapshot history (newest first).
// Server Component.
import { KpiGrid, KpiTile, TrendKpiCard } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { TrendChart } from '@/components/charts/trend-chart';
import { Table, Td, Th } from '@/components/ds/Table';
import { snapshotRows, trendCards, trendChart, trendDefs, trendKpis, type SnapshotLike, type TrendKey, type TrendSeries } from '@/domain/trends';
import type { Lang, T } from '@/i18n/translate';
import s from './changes.module.css';

export interface TrendsViewData {
  /** Chronological snapshots (W27 → W39). */
  snapshots: SnapshotLike[];
  series: TrendSeries;
  bac: number;
  contingency: number | null;
  /** "2 Oct". */
  nextReport: string | null;
}

export interface TrendsViewProps {
  data: TrendsViewData;
  selected: TrendKey;
  /** `?kpi=` URL of an indicator. */
  href: (key: TrendKey) => string;
  lang: Lang;
  t: T;
}

const color = (lo: boolean) => (lo ? LO : OK);

export function TrendsView({ data, selected, href, lang, t }: TrendsViewProps) {
  const defs = trendDefs(data.bac, data.contingency, lang);
  const def = defs.find((d) => d.key === selected) ?? defs[0];
  const kpis = trendKpis(data.snapshots, data.series, data.nextReport, lang);
  const cards = trendCards(defs, data.series, def.key, lang);
  const chart = trendChart(def, data.series[def.key], data.snapshots.map((x) => x.week));
  const rows = snapshotRows(data.snapshots, lang);
  const title = `${t(def.label)} — ${t(`${data.snapshots.length} weekly snapshots`)}`;

  return (
    <div className={s.stack}>
      <KpiGrid min={150}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={t(k.label)} value={t(k.value)} sub={t(k.sub)} color={color(k.alert)} />
        ))}
      </KpiGrid>

      <KpiGrid min={190}>
        {cards.map((c) => (
          <TrendKpiCard
            key={c.key}
            label={t(c.label)}
            target={t(c.targetText)}
            value={t(c.value)}
            series={c.series}
            delta={t(c.delta)}
            worse={c.worse}
            selected={c.selected}
            href={href(c.key)}
          />
        ))}
      </KpiGrid>

      <SectionCard title={title} subtitle={`${t('Status date every Friday · dashed line = target')} ${t(def.targetText)}`} gap={10}>
        <TrendChart model={{ ...chart, grid: chart.grid.map((g) => ({ ...g, label: t(g.label) })) }} label={title} />
      </SectionCard>

      <SectionCard title={t('Snapshot history')} hint={t('Frozen at each status date — “what did we forecast in July?”')} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Week')}</Th>
              <Th>{t('Status date')}</Th>
              <Th align="right">{t('CPI')}</Th>
              <Th align="right">{t('SPI')}</Th>
              <Th align="right">{t('EAC')}</Th>
              <Th align="right">{t('Float')}</Th>
              <Th align="right">{t('Risk exposure')}</Th>
              <Th align="right">{t('Milestone slip')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week}>
                <Td numeric>{r.week}</Td>
                <Td color="var(--color-neutral-300)">{t(r.date)}</Td>
                <Td align="right" numeric color={color(r.cpiLo)}>
                  {r.cpi}
                </Td>
                <Td align="right" numeric color={color(r.spiLo)}>
                  {r.spi}
                </Td>
                <Td align="right" numeric>
                  {r.eac}
                </Td>
                <Td align="right" numeric color={color(r.floatLo)}>
                  {t(r.float)}
                </Td>
                <Td align="right" numeric>
                  {r.risk}
                </Td>
                <Td align="right" numeric>
                  {t(r.slip)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
