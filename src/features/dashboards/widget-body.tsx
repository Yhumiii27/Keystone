// R-203 (K-203): the body of one dashboard widget, from the data resolved for the viewer (src/server/dal/dashboard-data.ts).
// Server Component. The KPI tile, the alerts and the S-curve are the components of the screens they come from; a widget the
// viewer may not see (or whose project they cannot read) shows a short notice and nothing of its data.
import { ArrowRight, LockSimple } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { IconTile } from '@/components/app/Badges';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiTile } from '@/components/app/Kpi';
import { LO, OK } from '@/components/app/tones';
import { EvmSCurve } from '@/components/charts/evm-s-curve';
import { ButtonLink } from '@/components/ds/Button';
import { Tag } from '@/components/ds/Tag';
import { screenHref } from '@/config/screens';
import { ALERT_ICON, KPI_ICON } from '@/features/portfolio/view';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import type { WidgetData } from '@/server/dal/dashboard-data';
import s from './dashboards.module.css';

export function WidgetBody({ data, t, lang }: { data: WidgetData; t: T; lang: Lang }) {
  if (data.state === 'denied')
    return (
      <p className={s.notice}>
        <LockSimple aria-hidden />
        {t('Not available for your role')}
      </p>
    );
  if (data.state === 'unavailable') return <EmptyState pad={6}>{t('No data for this project')}</EmptyState>;
  const v = data.view;
  switch (v.type) {
    case 'kpi':
      return (
        <KpiTile
          className={s.kpi}
          label={t(v.kpi.label)}
          value={t(v.kpi.value)}
          sub={data.projectLabel ? v.kpi.sub : t(v.kpi.sub)}
          color={v.kpi.alert ? LO : OK}
          icon={v.kpi.icon ? KPI_ICON[v.kpi.icon] : undefined}
          alertLabel={t('Needs attention')}
          size="lg"
        />
      );
    case 'alerts':
      if (!v.alerts.length) return <EmptyState pad={6}>{t('Nothing needs attention')}</EmptyState>;
      return (
        <ul className={s.list}>
          {v.alerts.map((a) => (
            <li key={a.key} className={s.alert}>
              <IconTile icon={ALERT_ICON[a.icon]} variant="alert" />
              <div className={s.alertBody}>
                {/* Written in the viewer's language with the typed names as typed (R-130, R-148). */}
                <span className={s.rowText}>{a.title}</span>
                <span className={s.rowSub}>{a.detail}</span>
                <ButtonLink variant="ghost" size="inline" iconRight={ArrowRight} href={screenHref(a.target.screen, { code: a.target.code })}>
                  {t(a.action)}
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      );
    case 'list':
      return (
        <>
          {!v.rows.length ? (
            <EmptyState pad={6}>{t('Nothing to show')}</EmptyState>
          ) : (
            <ul className={s.list}>
              {v.rows.map((r) => (
                <li key={r.key} className={s.row}>
                  <div className={s.rowMain}>
                    <Link href={r.href} className={s.rowLink}>
                      {r.ref && <span className={s.ref}>{r.ref}</span>}
                      <span className={s.rowText}>{dataText(r.text, lang)}</span>
                    </Link>
                    {r.sub && <span className={s.rowSub}>{dataText(r.sub, lang)}</span>}
                  </div>
                  <div className={s.rowSide}>
                    <Tag size="sm" tone={r.alert ? 'accent' : 'neutral'}>
                      {t(r.status)}
                    </Tag>
                    {r.date && <span className={r.alert ? s.dateLate : s.date}>{t(r.date)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {v.total > v.rows.length && (
            <ButtonLink variant="ghost" size="inline" iconRight={ArrowRight} href={v.href}>
              {`${t('See all')} (${v.total})`}
            </ButtonLink>
          )}
        </>
      );
    case 'evm':
      return (
        <div className={s.chart}>
          <EvmSCurve series={v.series} eac={v.eac} points={v.points} chartMonths={v.chartMonths} lang={lang} t={t} />
          <ButtonLink variant="ghost" size="inline" iconRight={ArrowRight} href={v.href}>
            {t('Open the Budget')}
          </ButtonLink>
        </div>
      );
  }
}
