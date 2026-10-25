// Machine catalogue body (owner, 25 Oct 2026; R-186, AC-4): KPI tiles, the Machine type and Status chips (URL state), the list of
// every catalogue entry (a row opens it, `?entry=`) and the selected entry's detail (client island). Server Component.
import { Funnel, Package } from '@phosphor-icons/react/dist/ssr';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { Table, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { CatalogueEntryDetail } from './entry-detail';
import type { CatalogueScreenView } from './model';
import s from './catalogue.module.css';

export function MachineCatalogueBody({ view, t }: { view: CatalogueScreenView; t: T }) {
  return (
    <div className={s.root}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} />
        ))}
      </KpiGrid>
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Package}>{t('Machine type')}</FilterLabel>
          <FilterChips label={t('Machine type')} value={view.typeValue} options={view.typeChips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} value={view.status} options={view.statusChips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        {view.readNote && <FilterNote>{view.readNote}</FilterNote>}
      </FilterBar>
      <SectionCard title={t('Catalogue entries')} hint={t('Click an entry for its versions')} scroll>
        {view.rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t('Code')}</Th>
                <Th>{t('Machine type')}</Th>
                <Th>{t('Variant')}</Th>
                <Th>{t('Label')}</Th>
                <Th>{t('Version')}</Th>
                <Th>{t('Status')}</Th>
                <Th align="right">{t('Indicative price')}</Th>
                <Th align="right">{t('Typical lead time')}</Th>
                <Th>{t('Updated')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <ClickableRow key={r.code} href={r.href} selected={r.selected}>
                  <td className={cx(s.codeCell, r.selected && s.codeOn)} aria-current={r.selected ? 'true' : undefined}>
                    {r.code}
                  </td>
                  <td className={s.cell12}>{r.typeLabel}</td>
                  <td className={s.cell12}>{r.variant}</td>
                  <td>{r.label}</td>
                  <td className={s.num}>{r.current}</td>
                  <td>
                    <span className={s.statusCol}>
                      <Tag tone={r.tone} size="sm">{r.statusText}</Tag>
                      {r.draftNote && <span className={s.sub}>{r.draftNote}</span>}
                    </span>
                  </td>
                  <td className={cx(s.right, s.num)}>{r.price}</td>
                  <td className={cx(s.right, s.num)}>{r.leadTime}</td>
                  <td className={cx(s.cell12, s.num)}>{r.updated}</td>
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <span className={s.empty}>{t('No catalogue entry matches these filters')}</span>
        )}
      </SectionCard>
      {view.detail && <CatalogueEntryDetail key={view.detail.code} detail={view.detail} canEdit={view.canEdit} />}
    </div>
  );
}
