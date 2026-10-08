// Billing & payments screen body (docs/spec/04 §4, template 841–869): 5 KPI tiles, "Billing progress" (stacked bar,
// legend, retention) | "To invoice" (planned milestones, late flag, "Issue invoice"), then "Invoices" (due dates in
// calendar days, status, "Mark paid"). Server Component; the buttons are client islands shown to editors only.
import { LockKey } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Stack } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { Card, CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { FormButton } from './form-button';
import { MarkPaidButton } from './mark-paid-button';
import type { BillingView } from './model';
import s from './contract.module.css';

const w = (v: string) => ({ '--w': v }) as CSSProperties;

export interface BillingScreenProps {
  view: BillingView;
  code: string;
  canEdit: boolean;
  context: string;
  /** "Issue invoice" (AF.billing), translated. */
  invoiceForm: FormDef;
  t: T;
}

export function BillingScreen({ view, code, canEdit, context, invoiceForm, t }: BillingScreenProps) {
  const p = view.progress;
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <div className={s.pair}>
        <Card className={s.progressCard}>
          <div className={s.headBaseline}>
            <CardTitle>{t('Billing progress')}</CardTitle>
            <span className={s.progressTotal}>
              {t('Contract value')} · <span>{p.total}</span>
            </span>
          </div>
          <div className={s.bar} role="img" aria-label={p.rows.map((r) => `${r.label} ${r.share}`).join(' · ')}>
            <div className={s.barPaid} style={w(p.paidW)} />
            <div className={s.barInvoiced} style={w(p.invW)} />
          </div>
          <div className={s.legend}>
            {p.rows.map((r) => (
              <div key={r.key} className={s.legendRow}>
                <span className={s.dot} style={{ '--dot': r.dot } as CSSProperties} aria-hidden />
                <span>{r.label}</span>
                <span className={s.legendShare}>{r.share}</span>
                <span className={s.legendAmount}>{r.amount}</span>
              </div>
            ))}
            <div className={cx(s.legendRow, s.legendRet)}>
              <LockKey className={s.lock} aria-hidden />
              <span className={s.stack}>
                <span>{t('Retention held by client')}</span>
                <span className={s.meta}>{p.retentionNote}</span>
              </span>
              <span className={s.legendAmount}>{p.retention}</span>
            </div>
          </div>
        </Card>

        <Card className={s.listCard}>
          <div className={s.titleCol}>
            <CardTitle>{t('To invoice')}</CardTitle>
            <span className={s.subtitle}>{t('Planned milestones in contractual order · a date already passed is flagged')}</span>
          </div>
          {view.toInvoice.map((m) => (
            <div key={m.id} className={cx(s.row, s.rowTall)}>
              <span className={s.stack}>
                <span className={s.strong}>
                  {m.id} · {m.label}
                </span>
                <span className={cx(s.dueLine, m.late && s.late)}>{m.line}</span>
              </span>
              <span className={s.num}>{m.amount}</span>
              {canEdit && (
                <FormButton
                  kind="invoice"
                  code={code}
                  context={context}
                  form={invoiceForm}
                  label={t('Issue invoice')}
                  ariaLabel={`${t('Issue invoice')} ${m.id}`}
                  variant="secondary"
                  size="xs"
                  icon={null}
                  nowrap
                  initialValues={{ ms: m.id }}
                />
              )}
            </div>
          ))}
          {!view.toInvoice.length && <EmptyState pad={6}>{t('All milestones invoiced')}</EmptyState>}
        </Card>
      </div>

      <Card className={s.listCard}>
        <CardTitle>{t('Invoices')}</CardTitle>
        <Table>
          <thead>
            <tr>
              <Th>{t('Invoice')}</Th>
              <Th>{t('Milestone')}</Th>
              <Th>{t('Issued on')}</Th>
              <Th align="right">{t('Amount')}</Th>
              <Th>{t('Payment due')}</Th>
              <Th>{t('Paid on')}</Th>
              <Th>{t('Status')}</Th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.invoices.map((i) => (
              <tr key={i.number}>
                <td className={s.invNo}>{i.number}</td>
                <td>
                  <div className={s.stack}>
                    <span>
                      {i.milestone} · {i.label}
                    </span>
                    {i.note && <span className={s.meta}>{i.note}</span>}
                  </div>
                </td>
                <td className={s.dateCell}>{i.issued}</td>
                <td className={cx(s.right, s.num)}>{i.amount}</td>
                <td className={cx(s.dateCell, i.overdue && s.late)}>{i.due}</td>
                <td className={s.paidCell}>{i.paid}</td>
                <td>
                  <span className={cx(i.tagClass, s.nowrap)}>{i.status}</span>
                </td>
                <td className={s.actionCell}>
                  {i.canPay && canEdit && <MarkPaidButton code={code} milestone={i.milestone} label={t('Mark paid')} ariaLabel={`${t('Mark paid')} ${i.number}`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!view.invoices.length && <EmptyState pad={6}>{t('No invoice issued yet')}</EmptyState>}
      </Card>
    </Stack>
  );
}
