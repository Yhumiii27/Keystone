// Portfolio overview body (docs/spec/03 §4, template 237–285). Server Components.
import { ArrowRight, GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import { ButtonLink } from '@/components/ds/Button';
import { CellStack, Table, Td, Th } from '@/components/ds/Table';
import { IconTile } from '@/components/app/Badges';
import { Callout } from '@/components/app/Callout';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid } from '@/components/app/Kpi';
import { Legend, LegendItem } from '@/components/app/Legend';
import { ProgressBar, SpendVsEarned } from '@/components/app/Progress';
import { CardGrid, SectionCard, Stack } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import { activeProjectsHint } from '@/domain/portfolio';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { PortfolioOverview } from '@/server/dal/portfolio';
import { RowLink } from './row-link';
import { ALERT_ICON, HealthBadge, Kpi, projectName } from './view';
import s from './portfolio.module.css';

const N300 = 'var(--color-neutral-300)';

export function OverviewBody({ data, zoneSelected, t, lang }: { data: PortfolioOverview; zoneSelected: boolean; t: T; lang: Lang }) {
  return (
    <Stack gap={18}>
      <KpiGrid min={160}>
        {data.kpis.map((k) => (
          <Kpi key={k.key} k={k} t={t} size="lg" />
        ))}
      </KpiGrid>
      {zoneSelected && data.rows.length === 0 && (
        <Callout icon={GlobeHemisphereEast} role="status">
          {t('No project in this zone for this view')}
        </Callout>
      )}
      <Stack gap={14}>
        <ActiveProjectsCard data={data} t={t} lang={lang} />
        <NeedsAttentionCard data={data} t={t} />
      </Stack>
    </Stack>
  );
}

/** "Active projects" (line 3793): one row per project, click → the project's Plan. Seed order, no sorting. */
function ActiveProjectsCard({ data, t, lang }: { data: PortfolioOverview; t: T; lang: Lang }) {
  return (
    <SectionCard title={t('Active projects')} hint={t(activeProjectsHint(data.rows.length))} scroll>
      <Table size={13}>
        <thead>
          <tr>
            <Th>{t('Project')}</Th>
            <Th>{t('Health')}</Th>
            <Th>{t('Progress')}</Th>
            <Th>{t('Spend vs earned')}</Th>
            <Th>{t('CPI')}</Th>
            <Th>{t('SPI')}</Th>
            <Th>{t('EAC')}</Th>
            <Th>{t('Variance')}</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((p) => {
            const m = p.metrics;
            return (
              <RowLink key={p.code} href={screenHref('plan', { code: p.code })}>
                <Td>
                  <CellStack title={projectName(p, lang)} sub={`${p.pm} ${t('· due')} ${t(p.finish)}`} />
                </Td>
                <Td>
                  <HealthBadge health={m.health} t={t} nowrap={false} />
                </Td>
                <Td>
                  <ProgressBar variant="inline" value={m.progressBar} label={m.progressPct} ariaLabel={t('Progress')} />
                </Td>
                <Td>
                  <SpendVsEarned spent={m.spentBar} earned={m.progressBar} label={m.spentPct} />
                </Td>
                <Td numeric color={m.cpiAlert ? LO : OK}>
                  {m.cpi.toFixed(2)}
                </Td>
                <Td numeric color={m.spiAlert ? LO : OK}>
                  {m.spi.toFixed(2)}
                </Td>
                <Td numeric>{money(m.eac, lang)}</Td>
                <Td numeric color={m.variance < 0 ? LO : N300}>
                  {money(m.variance, lang, { signed: true })}
                </Td>
              </RowLink>
            );
          })}
        </tbody>
      </Table>
      <Legend variant="footer">
        <LegendItem kind="block" color={N300} width={12} height={5}>
          {t('Budget spent')}
        </LegendItem>
        <LegendItem kind="tick" color="var(--color-accent)">
          {t('Work earned')}
        </LegendItem>
        <span>{t('Spend past the mark = paying more than the work is worth')}</span>
      </Legend>
    </SectionCard>
  );
}

/**
 * "Needs attention" (line 3809): alerts computed by rules (R-130, NEW-D1-1 — were the prototype's static texts), zone-filtered,
 * each with a link to the screen that resolves it. Their title and detail come in the render language.
 */
function NeedsAttentionCard({ data, t }: { data: PortfolioOverview; t: T }) {
  return (
    <SectionCard title={t('Needs attention')} gap={10}>
      {!data.alerts.length && <EmptyState pad={6}>{t('Nothing needs attention')}</EmptyState>}
      <CardGrid min={260} gap="0 24px" align="stretch">
        {data.alerts.map((a) => (
          <div key={a.key} className={s.alert}>
            <IconTile icon={ALERT_ICON[a.icon]} variant="alert" />
            <div className={s.alertBody}>
              {/* The alert texts are written in the viewer's language with the typed names as typed (R-130, R-148). */}
              <span className={s.alertTitle}>{a.title}</span>
              <span className={s.alertDetail}>{a.detail}</span>
              <ButtonLink variant="ghost" size="inline" iconRight={ArrowRight} href={screenHref(a.target.screen, { code: a.target.code })}>
                {t(a.action)}
              </ButtonLink>
            </div>
          </div>
        ))}
      </CardGrid>
    </SectionCard>
  );
}
