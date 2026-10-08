// PLM — parts catalogue screen body (docs/spec/09 §3.3–§3.6, template 2535–2580): KPI tiles, the filter card (client
// island) and the "Parts catalogue" table with its sortable headers (links to the next sort state) and row links that
// toggle the part record drawer (`?part=`). Server Component.
import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ClickableRow } from '@/components/app/ClickableRow';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table } from '@/components/ds/Table';
import { PlmFilterBar } from './filter-bar';
import type { CatalogueView, HeaderView } from './model';
import s from './plm.module.css';

const CARET = { up: CaretUp, down: CaretDown, updown: CaretUpDown } as const;

function Head({ h }: { h: HeaderView }) {
  const align = h.align === 'right' ? s.thRight : undefined;
  if (!h.sort) return <th className={align}>{h.label}</th>;
  const I = CARET[h.sort.icon];
  return (
    <th className={cx(s.sortHead, align)} aria-sort={h.sort.active ? (h.sort.icon === 'up' ? 'ascending' : 'descending') : undefined}>
      <Link href={h.sort.href} scroll={false} replace className={s.sortLink}>
        {h.label}
        <I className={cx(s.caret, h.sort.active && s.caretOn)} aria-hidden />
      </Link>
    </th>
  );
}

export function PlmCatalogue({ view }: { view: CatalogueView }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <PlmFilterBar view={{ searchPlaceholder: view.searchPlaceholder, selects: view.selects, restricted: view.restricted, clear: view.clear }} />

      <SectionCard title={view.title} hint={view.count} scroll>
        <Table>
          <thead>
            <tr>
              {view.headers.map((h) => (
                <Head key={h.key} h={h} />
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.ref} href={r.href}>
                <td className={cx(s.refCell, r.selected && s.refOn)}>{r.ref}</td>
                <td>{r.name}</td>
                <td className={cx(s.secondary, s.nowrap)}>{r.type}</td>
                <td className={s.secondary}>{r.makeBuy}</td>
                <td>
                  <span className={cx(r.puClass, s.nowrap)}>{r.pu}</span>
                </td>
                <td>
                  <div className={s.mfr}>
                    <span>{r.manufacturer}</span>
                    <span className={s.mfrRef}>{r.manufacturerRef}</span>
                  </div>
                </td>
                <td className={s.price}>{r.price}</td>
                <td className={cx(s.secondary, s.nowrap)}>{r.lead}</td>
                <td>
                  <div className={s.statusCol}>
                    <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                    {r.eco && (
                      <Link href={r.eco.href} className={cx('tag tag-outline', s.ecoTag)}>
                        {r.eco.number}
                      </Link>
                    )}
                  </div>
                </td>
                <td className={cx(s.restr, r.restrictionAlert && s.restrOn)}>{r.restriction}</td>
                <td className={s.used}>{r.usedIn}</td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </Stack>
  );
}
