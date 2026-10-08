// Sourcing, invoices & suppliers — screen body (docs/spec/08 §1.3–§1.4, template 1972–2078). Server Component: the
// "Display" switch (`?tab=rfq|inv|sup`), then the selected tab — KPI tiles, the table card and, when one is open
// (`?rfq=` / `?inv=`), its drawer. Row clicks toggle the drawer through the URL; action buttons are client islands
// rendered only for viewers allowed to act.
import { Eye, Funnel } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Segmented } from '@/components/ds/Segmented';
import { IdText, Table, Td, Th } from '@/components/ds/Table';
import type { SourcingTab } from '@/domain/procurement';
import type { T } from '@/i18n/translate';
import { SourcingActionButton } from './action-button';
import { InvoiceDrawer, RfqDrawer } from './drawers';
import type { InvoiceDrawerView, InvoiceTabView, KpiView, RfqDrawerView, RfqTabView, SupplierTabView } from './model';
import s from './procurement.module.css';

const vars = (v: Record<string, string>) => v as CSSProperties;

function Kpis({ kpis }: { kpis: KpiView[] }) {
  return (
    <KpiGrid>
      {kpis.map((k) => (
        <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
      ))}
    </KpiGrid>
  );
}

export interface SourcingBodyProps {
  tab: SourcingTab;
  seg: { value: SourcingTab; label: string; href: string }[];
  rfq?: { view: RfqTabView; drawer: RfqDrawerView | null };
  inv?: { view: InvoiceTabView; drawer: InvoiceDrawerView | null };
  sup?: SupplierTabView;
  t: T;
}

export function SourcingBody({ tab, seg, rfq, inv, sup, t }: SourcingBodyProps) {
  return (
    <Stack>
      <FilterBar>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented wrap value={tab} label={t('Display')} options={seg} />
      </FilterBar>
      {tab === 'rfq' && rfq && <RfqTab view={rfq.view} drawer={rfq.drawer} t={t} />}
      {tab === 'inv' && inv && <InvoiceTab view={inv.view} drawer={inv.drawer} t={t} />}
      {tab === 'sup' && sup && <SupplierTab view={sup} t={t} />}
    </Stack>
  );
}

// ── RFQ & quotes (1975–2016) ───────────────────────────────────────────────────────────────────────────

function RfqTab({ view, drawer, t }: { view: RfqTabView; drawer: RfqDrawerView | null; t: T }) {
  return (
    <>
      <Kpis kpis={view.kpis} />
      <SectionCard scroll title={t('Requests for quotation')} hint={t('Draft → sent → comparing → awarded · the award creates a draft purchase order')}>
        <Table>
          <thead>
            <tr>
              <Th>{t('RFQ')}</Th>
              <Th>{t('Part')}</Th>
              <Th align="right">{t('Qty')}</Th>
              <Th>{t('Quotes due')}</Th>
              <Th>{t('Buyer')}</Th>
              <Th>{t('Quotes')}</Th>
              <Th>{t('Award rule')}</Th>
              <Th>{t('Awarded to')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.number} href={r.href}>
                <Td>
                  <div className={s.rfqCell}>
                    <IdText selected={r.selected}>{r.number}</IdText>
                    <span className={s.rfqTitle}>{r.title}</span>
                  </div>
                </Td>
                <Td tone="secondary" numeric>
                  {r.part}
                </Td>
                <Td align="right" numeric>
                  {r.qty}
                </Td>
                <Td className={s.fs12} nowrap>
                  {r.due}
                </Td>
                <Td className={s.fs12} nowrap>
                  {r.owner}
                </Td>
                <Td tone="secondary" nowrap>
                  {r.quotes}
                </Td>
                <Td tone="muted">{r.rule}</Td>
                <Td className={s.fs12}>{r.awardedTo}</Td>
                <Td>
                  <span className={`${r.tagClass} ${s.nowrap}`}>{r.status}</span>
                </Td>
                <Td>
                  <div className={s.rowActions}>
                    {r.canSend && (
                      <SourcingActionButton op="send" number={r.number} label={t('Send to suppliers')} ariaLabel={`${t('Send to suppliers')} · ${r.number}`} variant="secondary" size="row" icon="send" />
                    )}
                    {r.canCompare && (
                      <SourcingActionButton op="compare" number={r.number} label={t('Compare quotes')} ariaLabel={`${t('Compare quotes')} · ${r.number}`} variant="primary" size="row" />
                    )}
                  </div>
                </Td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
      </SectionCard>
      {drawer && <RfqDrawer view={drawer} t={t} />}
    </>
  );
}

// ── Invoices — 3-way match (2017–2053) ─────────────────────────────────────────────────────────────────

function InvoiceTab({ view, drawer, t }: { view: InvoiceTabView; drawer: InvoiceDrawerView | null; t: T }) {
  return (
    <>
      <Kpis kpis={view.kpis} />
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} value={view.filter} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <FilterNote>{t('3-way match: purchase order · goods receipt · invoice — approved invoices are pushed to X3 accounts payable')}</FilterNote>
      </FilterBar>
      <SectionCard scroll title={t('Supplier invoices')}>
        <Table>
          <thead>
            <tr>
              <Th>{t('Invoice')}</Th>
              <Th>{t('Supplier')}</Th>
              <Th>{t('Purchase order')}</Th>
              <Th>{t('Goods receipt')}</Th>
              <Th align="right">{t('Amount')}</Th>
              <Th align="right">{t('Not covered by receipt')}</Th>
              <Th>{t('Match')}</Th>
              <Th>{t('Due')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.number} href={r.href}>
                <Td>
                  <div className={s.invCell}>
                    <IdText selected={r.selected}>{r.number}</IdText>
                    <span className={s.invDate}>{r.date}</span>
                  </div>
                </Td>
                <Td>{r.supplier}</Td>
                <Td className={s.fs12} numeric nowrap>
                  {r.po}
                </Td>
                <Td className={s.fs12} numeric nowrap>
                  {r.gr}
                </Td>
                <Td align="right" numeric nowrap>
                  {r.amount}
                </Td>
                <Td align="right" numeric nowrap className={s.gap} style={vars({ '--gap-color': r.gapColor })}>
                  {r.gap}
                </Td>
                <Td>
                  <div className={s.dots}>
                    {r.dots.map((d) => (
                      <span key={d.label} className={s.dotItem} title={d.state}>
                        <span className={s.dot} style={vars({ '--dot': d.color })} aria-hidden />
                        {d.label}
                        <span className={s.srOnly}>{` · ${d.state}`}</span>
                      </span>
                    ))}
                  </div>
                </Td>
                <Td className={s.fs12} nowrap>
                  {r.due}
                </Td>
                <Td>
                  <span className={`${r.tagClass} ${s.nowrap}`}>{r.status}</span>
                </Td>
                <Td>
                  <div className={s.rowActions}>
                    {r.canApprove && (
                      <SourcingActionButton op="approve" number={r.number} label={t('Approve payment')} ariaLabel={`${t('Approve payment')} · ${r.number}`} variant="primary" size="row" icon="check" />
                    )}
                    {r.canApprovePart && (
                      <SourcingActionButton
                        op="approve_part"
                        number={r.number}
                        label={t('Approve received part')}
                        ariaLabel={`${t('Approve received part')} · ${r.number}`}
                        variant="secondary"
                        size="row"
                      />
                    )}
                  </div>
                </Td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {!view.rows.length && <span className={s.noRows}>{t('No invoice in this status')}</span>}
      </SectionCard>
      {drawer && <InvoiceDrawer view={drawer} t={t} />}
    </>
  );
}

// ── Supplier performance (2054–2075) ───────────────────────────────────────────────────────────────────

function SupplierTab({ view, t }: { view: SupplierTabView; t: T }) {
  return (
    <>
      <Kpis kpis={view.kpis} />
      <SectionCard scroll title={t('Supplier scorecard')} hint={t('On-time from deliveries · quality from goods receipt · NCR rate per unit · rating feeds RFQ comparison')}>
        <Table>
          <thead>
            <tr>
              <Th>{t('Supplier')}</Th>
              <Th width="22%">{t('On-time delivery')}</Th>
              <Th width="22%">{t('Quality acceptance')}</Th>
              <Th align="right">{t('NCR rate')}</Th>
              <Th align="right">{t('Open POs')}</Th>
              <Th align="right">{t('NCRs this quarter')}</Th>
              <Th>{t('Rating')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.name}>
                <Td className={s.supplierName}>{r.name}</Td>
                <Td>
                  <div className={s.barCell}>
                    <div className={s.track}>
                      <div className={s.fill} style={vars({ '--w': r.onTimeWidth, '--fill': 'var(--color-accent)' })} />
                    </div>
                    <span className={s.barValue} style={vars({ '--bar-color': r.onTimeColor })}>
                      {r.onTime}
                    </span>
                  </div>
                </Td>
                <Td>
                  <div className={s.barCell}>
                    <div className={s.track}>
                      <div className={s.fill} style={vars({ '--w': r.qualityWidth, '--fill': 'var(--color-neutral-300)' })} />
                    </div>
                    <span className={s.barValue}>{r.quality}</span>
                  </div>
                </Td>
                <Td align="right" numeric className={s.ncrRate} style={vars({ '--ncr-color': r.ncrRateColor })}>
                  {r.ncrRate}
                </Td>
                <Td align="right" numeric>
                  {r.openPos}
                </Td>
                <Td align="right" numeric>
                  {r.ncrs}
                </Td>
                <Td>
                  <span className={r.gradeClass}>{r.grade}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </>
  );
}
