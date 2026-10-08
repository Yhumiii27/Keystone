// Drawings — PDM vault register body (docs/spec/09 §5.4–5.6, template 1377–1403): KPI tiles, the State chips with the
// search (`?q=`, number + title + part), and the register card mirrored from SolidWorks PDM. A row opens the drawing
// drawer (`?dwg=`). Read-only: revisions and states change in the vault. Server Component (the search is a client
// island).
import { ArrowsClockwise, Funnel } from '@phosphor-icons/react/dist/ssr';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SearchField } from '@/components/app/SearchField';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { DrawingsView } from './model';
import s from './drawings.module.css';

export function DrawingsRegister({ view, t }: { view: DrawingsView; t: T }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('State')}</FilterLabel>
          <FilterChips label={t('State')} value={view.filter} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <SearchField param="q" placeholder={t('Drawing number, title or part')} minWidth={260} push />
      </FilterBar>

      <div className={s.registerGrid}>
        <SectionCard
          title={t('Drawing register')}
          hint={
            <span className={s.hint}>
              <ArrowsClockwise aria-hidden />
              {t('Mirrored from SolidWorks PDM — revisions are changed in the vault')}
            </span>
          }
          scroll
        >
          <Table>
            <thead>
              <tr>
                <Th>{t('Drawing')}</Th>
                <Th>{t('Title')}</Th>
                <Th>{t('Part')}</Th>
                <Th>{t('Rev')}</Th>
                <Th>{t('State')}</Th>
                <Th>{t('Checked in')}</Th>
                <Th>{t('ECO')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <ClickableRow key={r.number} href={r.href}>
                  <td className={cx(s.idCell, r.selected && s.idOn)} aria-current={r.selected ? 'true' : undefined}>
                    {r.number}
                  </td>
                  <td>
                    <div className={s.stack}>
                      <span>{r.title}</span>
                      <span className={s.sub}>{r.path}</span>
                    </div>
                  </td>
                  <td>
                    <div className={s.partCell}>
                      <span className={s.num}>{r.part}</span>
                      <span className={s.partName}>{r.partName}</span>
                    </div>
                  </td>
                  <td className={s.num}>{r.rev}</td>
                  <td>
                    <span className={cx(r.stateClass, s.nowrap)}>{r.state}</span>
                  </td>
                  <td className={s.checked}>{r.byLine}</td>
                  <td className={s.eco}>{r.eco}</td>
                </ClickableRow>
              ))}
            </tbody>
          </Table>
          {view.empty && <span className={s.empty}>{view.empty}</span>}
        </SectionCard>
      </div>
    </Stack>
  );
}
