// My projects body (docs/spec/03 §2, template 196–214). Server Components.
import { ArrowRight, Eye, Info } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { Tag } from '@/components/ds/Tag';
import { cx } from '@/components/ds/cx';
import { Callout } from '@/components/app/Callout';
import { KpiGrid } from '@/components/app/Kpi';
import { ProgressBar } from '@/components/app/Progress';
import { CardGrid, SectionCard, Stack } from '@/components/app/SectionCard';
import { LifecycleTag } from '@/components/app/StatusTag';
import { screenHref } from '@/config/screens';
import type { MyProjectCard, MyProjectsModel, Tint } from '@/domain/portfolio';
import type { Lang, T } from '@/i18n/translate';
import type { ProjectRow } from '@/server/dal/projects';
import { HealthBadge, Kpi, TINT, projectName } from './view';
import s from './portfolio.module.css';
import { dataText } from '@/i18n/data-text';

const tint = (x: Tint) => ({ '--tint': TINT[x] }) as CSSProperties;

export function MyProjectsBody({ data, t, lang }: { data: MyProjectsModel<ProjectRow>; t: T; lang: Lang }) {
  return (
    <Stack gap={14}>
      <KpiGrid min={160}>
        {data.kpis.map((k) => (
          <Kpi key={k.key} k={k} t={t} size="md" />
        ))}
      </KpiGrid>
      {data.fallback && (
        <Callout variant="outlined" icon={Info} iconSize={16} role="note">
          {t('No project is assigned to you — the whole portfolio is shown.')}
        </Callout>
      )}
      <CardGrid min={300} gap={12} fill align="stretch">
        {data.cards.map((c) => (
          <ProjectCard key={c.project.code} card={c} t={t} lang={lang} />
        ))}
      </CardGrid>
    </Stack>
  );
}

/** Whole card opens the project's Plan (`p.open`). */
function ProjectCard({ card: c, t, lang }: { card: MyProjectCard<ProjectRow>; t: T; lang: Lang }) {
  const p = c.project;
  const x = c.ind;
  return (
    <SectionCard href={screenHref('plan', { code: p.code })} gap={10}>
      <div className={s.head}>
        <div className={s.headText}>
          <span className={s.name}>{projectName(p, lang)}</span>
          <span className={s.sub}>{`${p.analytic || p.code} · ${p.pm} · ${dataText(p.client, lang)}`}</span>
        </div>
        <HealthBadge health={c.health} t={t} />
      </div>
      <div className={s.tags}>
        <LifecycleTag status={p.stage} label={t(p.status)} />
        {c.myRole && <Tag tone="outline">{t(c.myRole)}</Tag>}
        {c.readOnly && (
          <span className={s.readOnly}>
            <Eye aria-hidden />
            {t('Read-only')}
          </span>
        )}
      </div>
      <div className={s.progress}>
        <div className={s.progressHead}>
          <span>{t('Progress')}</span>
          <span className={s.progressValue}>{c.progressPct}</span>
        </div>
        <ProgressBar variant="card" value={c.progressBar} ariaLabel={t('Progress')} />
      </div>
      <div className={s.metrics}>
        <Metric label={t('SPI')} value={x.spiText} tint={x.spiTint} />
        <Metric label={t('CPI')} value={x.cpiText} tint={x.cpiTint} />
        <Metric label={t('Forecast finish')} value={t(x.finishForecast)} tint={x.finishTint} />
      </div>
      <div className={s.milestone}>
        <span className={s.metricLabel}>{t('Next milestone')}</span>
        <span className={s.milestoneName}>{dataText(x.msName, lang)}</span>
        <span className={s.milestoneLine} style={tint(x.msTint)}>
          {t(x.msLine || x.msDate || '—')}
        </span>
      </div>
      <div className={s.foot}>
        <span className={s.footLabel}>{t('My open tasks')}</span>
        <span className={cx(s.footCount, !c.myOpen && s.footCountNone)}>{c.myOpen}</span>
        <span className={s.open}>
          {t('Open project')}
          <ArrowRight aria-hidden />
        </span>
      </div>
    </SectionCard>
  );
}

function Metric({ label, value, tint: x }: { label: string; value: string; tint: Tint }) {
  return (
    <div className={s.metric}>
      <span className={s.metricLabel}>{label}</span>
      <span className={s.metricValue} style={tint(x)}>
        {value}
      </span>
    </div>
  );
}
