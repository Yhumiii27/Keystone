// Purchase orders screen body (docs/spec/08 §2, template 2615–2688): KPI row, BOM shortfall banner (when articles
// are short, with "Create draft POs by supplier" for editors), status chips with the workflow hint, the orders table
// (rows open the order drawer through `?po=`; "Send for approval" / "Approve & order" for editors) and the order
// drawer. Server Component; the buttons are client islands.
import { Cube } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, ReactNode } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { OrdersView } from './model';
import { CreateDraftsButton, OrderRowActions } from './order-buttons';
import { OrderDrawer } from './order-drawer';
import s from './orders.module.css';

export interface OrdersBodyProps {
  view: OrdersView;
  /** Edit controls allowed (not outside the workspace, not a read-only project). */
  canEdit: boolean;
  t: T;
  /** R-204: supplier schedule section of the open order's drawer. */
  supplierSchedule?: ReactNode;
}

export function OrdersBody({ view, canEdit, t, supplierSchedule }: OrdersBodyProps) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      {view.shortfall && (
        <div className={cx('card', 'elev-sm', s.banner)}>
          <div className={s.bannerRow}>
            <Cube className={s.bannerIcon} aria-hidden />
            <div className={s.bannerText}>
              <span className={s.bannerTitle}>{view.shortfall.title}</span>
              <span className={s.bannerSub}>{view.shortfall.sub}</span>
            </div>
            {canEdit && <CreateDraftsButton code={view.code} place="banner" afterHref={view.afterDraftsHref} />}
          </div>
          <div className={s.bannerChips}>
            {view.shortfall.chips.map((c) => (
              <span key={c} className={cx('tag', 'tag-neutral', s.chip)}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} options={view.chips} value={view.filter ?? 'all'} />
        </FilterGroup>
        <FilterNote>{t('Draft → awaiting approval → ordered → received · deliveries checked against the activity that needs them')}</FilterNote>
      </FilterBar>

      <SectionCard title={view.title} hint={t('Click an order for its lines')} scroll>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Order')}</Th>
              <Th>{t('Supplier')}</Th>
              <Th>{t('Articles')}</Th>
              <Th align="right">{t('Value')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Ordered')}</Th>
              <Th>{t('Expected')}</Th>
              <Th>{t('Needed by')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const submit = canEdit && r.canSubmit;
              const approve = canEdit && r.canApprove && view.canApprove;
              return (
                <ClickableRow key={r.number} href={r.href}>
                  <td className={cx(s.id, r.selected && s.idOn)}>{r.number}</td>
                  <td>{r.supplier}</td>
                  <td>
                    <div className={s.stack}>
                      <span className={s.summary}>{r.lineSummary}</span>
                      <span className={s.count}>{r.lineCount}</span>
                    </div>
                  </td>
                  <td className={s.value}>{r.value}</td>
                  <td>
                    <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                  </td>
                  <td className={s.ordered}>{r.ordered}</td>
                  <td className={s.expected} style={{ '--exp-color': r.expColor } as CSSProperties}>
                    {r.expected}
                  </td>
                  <td>
                    <div className={s.stack}>
                      <span className={s.need}>{r.need}</span>
                      <span className={s.risk} style={{ '--risk-color': r.riskColor } as CSSProperties}>
                        {r.risk}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={s.actions}>{(submit || approve) && <OrderRowActions code={view.code} number={r.number} canSubmit={submit} canApprove={approve} />}</div>
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </Table>
        {view.empty && <span className={s.empty}>{view.empty}</span>}
      </SectionCard>

      {view.drawer && <OrderDrawer code={view.code} view={view.drawer} canEdit={canEdit} t={t} supplierSchedule={supplierSchedule} />}
    </Stack>
  );
}
