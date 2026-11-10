// R-162 (P4, D9-34) — FX exposure: per project and currency other than the euro, what is still to collect on the contract and to
// pay on the open orders, the net position valued at the budget rate and at the reference rate, the gain or loss of the rate move
// and the drift, with the hedging alerts (Settings thresholds). Project card (Contract screen) and portfolio card (Cash flow):
// Finance and the director read. Server-compatible (texts translated by the caller's `t`).
import { CurrencyEur, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { SectionCard } from '@/components/app/SectionCard';
import { Table, Th } from '@/components/ds/Table';
import { currencyOf, moneyIn } from '@/domain/currency';
import { FX_ALERT_TITLE, type FxThresholds, type ProjectFxExposure } from '@/domain/fx-exposure';
import { screenHref } from '@/config/screens';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import s from './fx.module.css';

export interface FxExposureLine extends ProjectFxExposure {
  code?: string;
  name?: string;
}

const rateText = (v: number | null, lang: Lang) => (v == null ? '—' : lang === 'fr' ? String(v).replace('.', ',') : String(v));
const pctText = (v: number | null, lang: Lang) => (v == null ? '—' : `${v > 0 ? '+' : ''}${lang === 'fr' ? String(v).replace('.', ',') : v} %`);

export function FxExposureCard({ lines, thresholds, t, lang, portfolio }: { lines: FxExposureLine[]; thresholds: FxThresholds; t: T; lang: Lang; portfolio?: boolean }) {
  const rows = lines.flatMap((l) => l.currencies.map((c) => ({ l, c, alerts: l.alerts.filter((a) => a.currency === c.currency) })));
  const hint = `${t('Alerts from')} ${money(thresholds.exposureKeur, lang)} · ${pctText(thresholds.driftPct, lang).replace('+', '±')}`;
  return (
    <SectionCard icon={CurrencyEur} title={t(portfolio ? 'FX exposure of the portfolio' : 'FX exposure')} hint={hint} scroll>
      {!rows.length ? (
        <p className={s.muted}>{t(portfolio ? 'No open position in another currency than the euro' : 'No open position in another currency than the euro on this project')}</p>
      ) : (
        <Table size={12.5}>
          <thead>
            <tr>
              {portfolio && <Th>{t('Project')}</Th>}
              <Th>{t('Currency')}</Th>
              <Th align="right">{t('To collect')}</Th>
              <Th align="right">{t('To pay')}</Th>
              <Th align="right">{t('Net position')}</Th>
              <Th align="right">{t('Budget rate')}</Th>
              <Th align="right">{t('Reference rate')}</Th>
              <Th align="right">{t('Drift')}</Th>
              <Th align="right">{t('At the reference rate')}</Th>
              <Th align="right">{t('Gain / loss')}</Th>
              <Th>{t('Alerts')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, c, alerts }) => {
              const cur = currencyOf(c.currency);
              return (
                <tr key={`${l.code ?? ''}:${c.currency}`}>
                  {portfolio && <td>{l.code ? <Link href={screenHref('contract', { code: l.code })}>{l.code}</Link> : '—'}</td>}
                  <td>{c.currency}</td>
                  <td className={s.num}>{moneyIn(c.receivableKeur, cur, lang)}</td>
                  <td className={s.num}>{moneyIn(c.payableKeur, cur, lang)}</td>
                  <td className={s.num}>{moneyIn(c.netKeur, cur, lang)}</td>
                  <td className={s.num}>{rateText(c.budgetRate, lang)}</td>
                  <td className={s.num}>{rateText(c.referenceRate, lang)}</td>
                  <td className={s.num}>{pctText(c.driftPct, lang)}</td>
                  <td className={s.num}>{money(c.netAtReferenceKeur, lang)}</td>
                  <td className={s.num}>{c.gainLossKeur == null ? '—' : money(c.gainLossKeur, lang, { signed: true })}</td>
                  <td>
                    <span className={s.alerts}>
                      {alerts.map((a) => (
                        <span key={a.kind} className="tag tag-accent">
                          <Warning aria-hidden /> {t(FX_ALERT_TITLE[a.kind])}
                        </span>
                      ))}
                      {!alerts.length && '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </SectionCard>
  );
}
