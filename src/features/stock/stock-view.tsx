// Stock & storages screen body (docs/spec/08 §4.3–4.4, template 1658–1693): KPI tiles, location chips + search, the
// "Stock by location" table and the "Recent movements" card. Server Component; the chips are links (`?loc=`), the
// search is debounced into `?q=`, a row opens / closes the stock-line drawer (`?stock=`).
import { ArrowsClockwise, MapPin, PushPin, Warning } from '@phosphor-icons/react/dist/ssr';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SearchField } from '@/components/app/SearchField';
import { Stack } from '@/components/app/SectionCard';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { StockScreenView } from './model';
import s from './stock.module.css';

export function StockBody({ view, t }: { view: StockScreenView; t: T }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={MapPin}>{t('Location')}</FilterLabel>
          <FilterChips label={t('Location')} options={view.chips} value={view.chipValue} />
        </FilterGroup>
        <SearchField param="q" placeholder={t('Search article or location')} minWidth={260} push />
      </FilterBar>

      <div className={s.cards}>
        <div className={cx('card', 'elev-sm', s.tableCard)}>
          <div className={s.cardHead}>
            <CardTitle push>{t('Stock by location')}</CardTitle>
            <span className={s.hint}>
              <ArrowsClockwise aria-hidden />
              {t('Imported from Sage X3 · local changes are flagged until pushed back')}
            </span>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>{t('Reference')}</Th>
                <Th>{t('Article')}</Th>
                <Th>{t('Location')}</Th>
                <Th align="right">{t('On hand')}</Th>
                <Th align="right">{t('Reserved')}</Th>
                <Th align="right">{t('Available')}</Th>
                <Th align="right">{t('Min')}</Th>
                <Th align="right">{t('Value')}</Th>
                <Th>{t('Source')}</Th>
                <Th>{t('Last movement')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <ClickableRow key={r.id} href={r.href}>
                  <td className={cx(s.ref, r.selected && s.refOn)}>{r.ref}</td>
                  <td className={s.article}>
                    <span className={s.name} title={r.name}>
                      {r.name}
                    </span>
                    {r.pinned && (
                      <span className={s.pin}>
                        <PushPin aria-hidden />
                        {r.pinned}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className={s.locCell}>
                      <span className={s.locName}>{r.location}</span>
                      <span className={s.locType}>{r.locationType}</span>
                    </div>
                  </td>
                  <td className={s.num}>{r.onHand}</td>
                  <td className={cx(s.num, s.muted)}>{r.reserved}</td>
                  <td className={s.num} style={{ color: r.availableColor }}>
                    {r.available}
                  </td>
                  <td className={cx(s.num, s.minCell)}>
                    <span className={s.minInner}>
                      {r.min}
                      {r.belowMin && <Warning className={s.warn} role="img" aria-label={t('Below minimum')} />}
                    </span>
                  </td>
                  <td className={cx(s.num, s.nowrap)}>{r.value}</td>
                  <td>
                    <span className={cx('tag', r.sourceTone === 'neutral' ? 'tag-neutral' : 'tag-accent')}>{r.source}</span>
                  </td>
                  <td className={s.last}>{r.last}</td>
                </ClickableRow>
              ))}
            </tbody>
          </Table>
          {view.empty && <span className={s.empty}>{view.empty}</span>}
        </div>

        <div className={cx('card', 'elev-sm', s.movesCard)}>
          <CardTitle className={s.movesTitle}>{t('Recent movements')}</CardTitle>
          {view.moves.map((m) => (
            <div key={m.key} className={s.move}>
              <div className={s.moveBody}>
                <span className={s.moveLine}>
                  <span className={s.moveType}>{m.type}</span> · {m.ref} × {m.qty}
                </span>
                <span className={s.moveWhere}>{m.where}</span>
                <span className={s.moveWho}>
                  {m.who} · {m.when}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Stack>
  );
}
