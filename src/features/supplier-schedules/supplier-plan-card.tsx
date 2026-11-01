// R-204 — « Supplier schedules » card of the Plan screen (read-only): one collapsible line per purchase order with a supplier
// schedule — on time or slipping (largest finish slip in working days), forecast vs committed finish, the project activities it
// is tied to — and, unfolded, its activities. Edited on the purchase order (Purchase orders screen, `?po=`).
import { Truck, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { SectionCard } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import type { SupplierScheduleView } from './model';
import s from './supplier-schedules.module.css';

export interface SupplierPlanCardProps {
  schedules: SupplierScheduleView[];
  /** Purchase orders screen of the project (`?po=` opens the order). */
  ordersHref: string;
  t: T;
  lang: Lang;
}

export function SupplierPlanCard({ schedules, ordersHref, t, lang }: SupplierPlanCardProps) {
  if (!schedules.length) return null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const day = (iso: string | null) => (iso ? fmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
  const slip = (n: number | null) => (n == null ? '—' : n === 0 ? t('On time') : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${t('wd')}`);
  return (
    <SectionCard title={t('Supplier schedules')} hint={t('Consolidated into the project schedule through their ties · edited on the purchase order')}>
      <div className={s.card}>
        {schedules.map((x) => {
          const last = x.activities.at(-1);
          return (
            <details key={x.po} className={s.item}>
              <summary>
                <Truck aria-hidden />
                <span className={s.po}>{x.po}</span>
                <span>{dataText(x.supplier, lang)}</span>
                <span className={cx('tag', x.late ? 'tag-accent' : 'tag-neutral')}>
                  {x.invalid ? t('Cannot be dated') : x.late ? `${t('Slipping')} · ${slip(x.slip)}` : t('On time')}
                </span>
                <span className={s.muted}>
                  {t('Forecast finish')} · {day(x.finish)}
                  {last?.committedFinish ? ` · ${t('Supplier commitment')} · ${day(last.committedFinish)}` : ''}
                </span>
                <span className={s.muted}>
                  {x.ties.length ? `${t('Drives')} · ${[...new Set(x.ties.filter((y) => y.direction === 'to_project').map((y) => y.activity))].join(', ') || '—'}` : t('Not tied to the project schedule yet')}
                </span>
                <span className={s.spacer} />
                <Link className={s.link} href={`${ordersHref}?po=${encodeURIComponent(x.po)}`}>
                  {t('Open the order')}
                </Link>
              </summary>
              <div className={s.scroll}>
                <Table size={12.5}>
                  <thead>
                    <tr>
                      <Th>{t('Activity')}</Th>
                      <Th>{t('Supplier commitment')}</Th>
                      <Th>{t('Forecast')}</Th>
                      <Th align="right">%</Th>
                      <Th>{t('Slip')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.activities.map((a) => (
                      <tr key={a.code} className={cx(a.late && s.lateRow)}>
                        <td>
                          <span className={s.code}>{a.code}</span> {dataText(a.name, lang)}
                        </td>
                        <td className={s.nowrap}>{a.duration === 0 ? day(a.committedFinish ?? a.committedStart) : `${day(a.committedStart)} → ${day(a.committedFinish)}`}</td>
                        <td className={s.nowrap}>{a.duration === 0 ? day(a.forecastFinish) : `${day(a.forecastStart)} → ${day(a.forecastFinish)}`}</td>
                        <td className={s.num}>{a.pct}</td>
                        <td className={cx(s.nowrap, a.late && s.late)}>
                          {a.late && <Warning aria-hidden className={s.warnIcon} />}
                          {slip(a.finishSlip)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </details>
          );
        })}
      </div>
    </SectionCard>
  );
}
