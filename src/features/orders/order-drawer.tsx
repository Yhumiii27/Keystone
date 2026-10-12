// Order drawer (docs/spec/08 §2.4 poVals, template 2663–2686): opened by `?po=PO-1052`, closed (×, scrim, Esc) to
// the list URL. Header "PO-1052 · Halvorsen Cranes" + status tag; stepper Draft · Approved · Ordered; part-status
// warning; lines (a row opens the part in the Project BOM); "Order details" with the receipts, invoices and Sage X3
// state added to the prototype's five rows; buttons Open activity · Export PO · Push to X3 (editors, local orders) ·
// R-095 Cancel order / Withdraw from approval (a Keystone-drafted order before it is placed, for whom `poCancelRight` allows);
// a cancelled order shows why, by whom and when.
// C-9 (R-075): a Draft's currency (EUR or the project currency) for editors when the project has another currency.
import { TreeStructure, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Callout } from '@/components/app/Callout';
import { ClickableRow } from '@/components/app/ClickableRow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { FlowStepper } from '@/components/app/Stepper';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { OrderDrawerView } from './model';
import { CancelOrderButton, ExportPoButton, PushToX3Button } from './order-buttons';
import { OrderCurrencySelect } from './order-currency';
import s from './orders.module.css';

export interface OrderDrawerProps {
  code: string;
  view: OrderDrawerView;
  /** "Push to X3" allowed (not outside the workspace, not a read-only project). */
  canEdit: boolean;
  t: T;
}

export function OrderDrawer({ code, view, canEdit, t }: OrderDrawerProps) {
  return (
    <Drawer open closeHref={view.closeHref} id={view.head} meta={<span className={view.statusClass}>{view.status}</span>}>
      <FlowStepper steps={view.steps} />
      {view.warn && (
        <Callout variant="emphasis" icon={Warning} role="note">
          {view.warn}
        </Callout>
      )}
      <div className={s.body}>
        <div className={s.lines}>
          <Table size={12.5} className={s.linesTable}>
            <thead>
              <tr>
                <Th>{t('Reference')}</Th>
                <Th>{t('Article')}</Th>
                <Th align="right">{t('Ordered')}</Th>
                <Th align="right">{t('Unit price')}</Th>
                <Th align="right">{t('Total')}</Th>
                <Th>{t('Part status')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => (
                <ClickableRow key={l.ref} href={l.href}>
                  <td className={s.ref}>{l.ref}</td>
                  <td>{l.name}</td>
                  <td className={s.num}>{l.qty}</td>
                  <td className={s.numNowrap}>{l.price}</td>
                  <td className={s.numNowrap}>{l.total}</td>
                  <td>
                    <span className={cx(l.statusClass, s.nowrap)}>{l.status}</span>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        </div>
        <div className={s.details}>
          <KeyValueList
            title={t('Order details')}
            items={view.meta.map((m) => ({
              id: m.k,
              k: m.k,
              color: m.color,
              v: m.links ? (
                <span className={s.links}>
                  {m.links.map((l) => (
                    <Link key={l.label} href={l.href} title={l.title} className={s.link}>
                      {l.label}
                    </Link>
                  ))}
                </span>
              ) : (
                m.v
              ),
            }))}
          />
          {canEdit && view.currency.canSet && <OrderCurrencySelect code={code} number={view.number} value={view.currency.value} options={view.currency.options} />}
          <div className={s.buttons}>
            <ButtonLink variant="secondary" size="sm" icon={TreeStructure} href={view.activityHref}>
              {t('Open activity')}
            </ButtonLink>
            <ExportPoButton code={code} number={view.number} />
            {canEdit && view.canPush && <PushToX3Button code={code} number={view.number} />}
            {canEdit && view.cancel && <CancelOrderButton code={code} number={view.number} kind={view.cancel} />}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
