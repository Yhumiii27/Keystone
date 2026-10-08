// RFQ and invoice drawers of Sourcing (docs/spec/08 §1.4.1 `rfqVals` / template 1999–2015, §1.4.2 `invVals` /
// template 2043–2052): opened by `?rfq=` / `?inv=`, closed (×, scrim, Esc) to the tab's URL. Server Components around
// the shared Drawer; the decision buttons are client islands, the cross-screen buttons plain links.
import { Cube, ShoppingCart, Truck } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { SourcingActionButton } from './action-button';
import type { InvoiceDrawerView, RfqDrawerView } from './model';
import s from './procurement.module.css';

const vars = (v: Record<string, string>) => v as CSSProperties;

export function RfqDrawer({ view, t }: { view: RfqDrawerView; t: T }) {
  return (
    <Drawer open closeHref={view.closeHref} id={view.number} title={view.title} meta={<span className={view.tagClass}>{view.status}</span>}>
      <div className={s.section}>
        <Eyebrow>{t('Quote comparison')}</Eyebrow>
        <div className={s.quoteWrap}>
          <Table size={12.5} className={s.quoteTable}>
            <thead>
              <tr>
                <Th>{t('Supplier')}</Th>
                <Th align="right">{t('Unit')}</Th>
                <Th align="right">{t('Total')}</Th>
                <Th align="right">{t('vs best')}</Th>
                <Th>{t('Lead time')}</Th>
                <Th>{t('Terms')}</Th>
                <Th>{t('Rating')}</Th>
                <Th aria-label={t('Actions')} />
              </tr>
            </thead>
            <tbody>
              {view.quotes.map((q) => (
                <tr key={q.supplier}>
                  <Td>
                    <span className={s.supplierCell}>
                      {q.supplier}
                      {q.awarded && <span className="tag tag-accent">{t('Awarded')}</span>}
                    </span>
                  </Td>
                  <Td align="right" numeric nowrap className={s.price} style={vars({ '--price-color': q.best ? 'var(--color-accent-300)' : 'var(--color-text)' })}>
                    {q.price}
                  </Td>
                  <Td align="right" numeric nowrap>
                    {q.total}
                  </Td>
                  <Td align="right" numeric nowrap className={s.delta}>
                    {q.delta}
                  </Td>
                  <Td className={s.lead} style={vars({ '--lead-color': q.fastest ? 'var(--color-accent-300)' : 'var(--color-neutral-300)' })}>
                    {q.lead}
                  </Td>
                  <Td nowrap>{q.terms}</Td>
                  <Td numeric>{q.rating}</Td>
                  <Td>
                    {q.canAward && (
                      <SourcingActionButton op="award" number={view.number} supplier={q.supplier} label={t('Award')} ariaLabel={`${t('Award')} · ${q.supplier}`} variant="primary" size="row" icon="check" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {view.noQuotes && <span className={s.empty}>{t('No quote received yet — send the RFQ to at least three suppliers')}</span>}
        <span className={s.footnote}>{view.footnote}</span>
      </div>
      <KeyValueList title={t('Request')} items={view.meta.map((m) => ({ k: m.k, v: m.v, color: 'var(--color-text)' }))} />
      <div className={s.buttons}>
        {view.canSend && <SourcingActionButton op="send" number={view.number} label={t('Send to suppliers')} variant="primary" size="sm" icon="send" />}
        {view.partHref && (
          <ButtonLink variant="secondary" size="sm" icon={Cube} href={view.partHref}>
            {t('Part record')}
          </ButtonLink>
        )}
        <ButtonLink variant="secondary" size="sm" icon={ShoppingCart} href={view.ordersHref}>
          {t('Purchase orders')}
        </ButtonLink>
      </div>
    </Drawer>
  );
}

export function InvoiceDrawer({ view, t }: { view: InvoiceDrawerView; t: T }) {
  return (
    <Drawer open closeHref={view.closeHref} id={view.number} title={view.supplier} meta={<span className={view.tagClass}>{view.status}</span>}>
      <div className={s.section}>
        <Eyebrow>{t('3-way match')}</Eyebrow>
        {view.legs.map((l) => (
          <div key={l.label} className={s.leg}>
            <span className={s.legDot} style={vars({ '--dot': l.dot })} />
            <span className={s.legLabel}>
              <span>{l.label}</span>
              <span className={s.legRef}>{l.ref}</span>
            </span>
            <span className={s.legAmount}>{l.amount}</span>
            <span className={s.legState} style={vars({ '--state-color': l.color })}>
              {l.state}
            </span>
          </div>
        ))}
      </div>
      <KeyValueList title={t('Invoice')} items={view.meta} />
      <div className={s.buttons}>
        {view.canApprove && <SourcingActionButton op="approve" number={view.number} label={t('Approve payment')} variant="primary" size="sm" icon="check" />}
        {view.canApprovePart && <SourcingActionButton op="approve_part" number={view.number} label={view.partialLabel} variant="primary" size="sm" icon="check" />}
        {view.poHref && (
          <ButtonLink variant="secondary" size="sm" icon={ShoppingCart} href={view.poHref}>
            {t('Purchase order')}
          </ButtonLink>
        )}
        {view.grHref && (
          <ButtonLink variant="secondary" size="sm" icon={Truck} href={view.grHref}>
            {t('Goods receipt')}
          </ButtonLink>
        )}
        {view.canReject && <SourcingActionButton op="reject" number={view.number} label={t('Reject invoice')} variant="ghost" size="sm" />}
      </div>
    </Drawer>
  );
}
