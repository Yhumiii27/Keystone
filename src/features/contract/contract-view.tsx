// Contract screen body (docs/spec/04 §3, template 814–840): 4 KPI tiles, the "Contract sheet" form, "Amendments" |
// "Bonds & guarantees", "Payment milestones" with its total row. Server Component; the sheet form and the "Add …"
// buttons are client islands, rendered only for viewers who may edit (read-only viewers see disabled fields).
// Delivery 7: "Currency & budget rate" (C-9, R-075 — the portfolio director edits it), the amendments' signature cycle and
// the guarantees' release (R-079), and the amendments' own milestones grouped under them in the schedule (NEW-D3-3).
import { FileText } from '@phosphor-icons/react/dist/ssr';
import { Fragment } from 'react';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Stack } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { ButtonLink } from '@/components/ds/Button';
import { Card, CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { documentsHref } from '@/features/docs/links';
import type { T } from '@/i18n/translate';
import { BudgetRateForm } from './budget-rate-form';
import { FormButton } from './form-button';
import type { ContractView, CurrencyView } from './model';
import { ReleaseBondButton, SendAmendmentButton, SignAmendmentButton } from './row-actions';
import { ContractSheetForm } from './sheet-form';
import s from './contract.module.css';

/** Documents · Codex with the document record open (`setState({screen:'docs', dv:{open}})` → `?doc=`). */
export const docHref = (code: string, ref: string) => documentsHref(code, { doc: ref });

export interface ContractScreenProps {
  view: ContractView;
  code: string;
  canEdit: boolean;
  /** The viewer may set the project's currency and budget rate (portfolio director). */
  canSetRate: boolean;
  /** Translated project label, the dialogs' sub-line. */
  context: string;
  forms: { amendment: FormDef; bond: FormDef; milestone: FormDef; sign: (documentRef: string | null) => FormDef; release: FormDef };
  t: T;
}

/** "Currency & budget rate" card (C-9): read-only line for everyone, the editor for the portfolio director. */
export function CurrencyCard({ fx, code, canSetRate, t }: { fx: CurrencyView; code: string; canSetRate: boolean; t: T }) {
  return (
    <Card className={s.listCard}>
      <div className={s.headTop}>
        <div className={s.titleCol}>
          <CardTitle>{t('Currency & budget rate')}</CardTitle>
          <span className={s.subtitle}>{t('Budget, cash flow and portfolio finance are consolidated in euros at this rate')}</span>
        </div>
      </div>
      <div className={s.rateLine}>
        <span>{t('Project currency')}</span>
        <span className={s.num}>{fx.currency}</span>
        <span className={s.meta}>{fx.rateText === '—' ? t('Budget rate not set') : fx.rateText}</span>
      </div>
      {canSetRate && (
        <BudgetRateForm
          code={code}
          currency={fx.currency}
          rate={fx.rate}
          options={fx.options}
          labels={{
            currency: t('Project currency'), rate: t('Budget rate (€ per unit)'), save: t('Save rate'), saved: t('Budget rate saved'),
            eurNote: t('Euro projects need no rate'),
          }}
        />
      )}
    </Card>
  );
}

export function ContractScreen({ view, code, canEdit, canSetRate, context, forms, t }: ContractScreenProps) {
  const add = (kind: 'amendment' | 'bond' | 'milestone', label: string) =>
    canEdit && <FormButton kind={kind} code={code} context={context} form={forms[kind]} label={t(label)} size="xs" push nowrap />;
  const base = view.milestones.filter((m) => m.group == null);
  const row = (m: ContractView['milestones'][number]) => (
    <tr key={m.id} className={cx(!m.billable && s.muted)}>
      <td>
        <span className={s.strong}>
          {m.id} · {m.label}
        </span>
      </td>
      <td className={cx(s.right, s.num)}>{m.share}</td>
      <td className={cx(s.right, s.num)}>{m.amount}</td>
      <td className={cx(s.num, s.nowrap)}>{m.due}</td>
      <td className={s.condition}>{m.condition}</td>
    </tr>
  );
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <Card className={s.sheetCard}>
        <div className={s.headTop}>
          <div className={s.titleCol}>
            <CardTitle>{t('Contract sheet')}</CardTitle>
            <span className={s.subtitle}>{t('Fill in the terms once · billing, change control and the client portal read from here')}</span>
          </div>
          <ButtonLink href={docHref(code, view.reference)} variant="ghost" size="xs" icon={FileText} push nowrap>
            {t('Open contract')}
          </ButtonLink>
        </div>
        <ContractSheetForm code={code} fields={view.fields} canEdit={canEdit} />
      </Card>

      <CurrencyCard fx={view.fx} code={code} canSetRate={canSetRate} t={t} />

      <div className={s.pair}>
        <Card className={s.listCard}>
          <div className={s.headCenter}>
            <CardTitle>{t('Amendments')}</CardTitle>
            {add('amendment', 'Add amendment')}
          </div>
          {view.amendments.map((a) => (
            <div key={a.position} className={s.row}>
              <span className={s.stack}>
                <span className={s.pretty}>{a.label}</span>
                <span className={s.meta}>{a.date}</span>
              </span>
              <span className={s.num}>{a.amount}</span>
              <span className={s.statusCell}>
                <span className={cx(a.tagClass, s.nowrap)}>{a.status}</span>
                {canEdit && a.canSend && (
                  <SendAmendmentButton code={code} position={a.position} label={t('Send for signature')} ariaLabel={`${t('Send for signature')} · ${a.label}`} />
                )}
                {canEdit && a.canSign && (
                  <SignAmendmentButton
                    code={code} position={a.position} context={context} form={forms.sign(a.doc)} label={t('Mark signed')} ariaLabel={`${t('Mark signed')} · ${a.label}`}
                  />
                )}
                {a.doc && (
                  <ButtonLink href={docHref(code, a.doc)} variant="ghost" size="mini" icon={FileText} nowrap aria-label={`${t('Open document')} ${a.doc}`} title={a.doc} />
                )}
              </span>
            </div>
          ))}
        </Card>
        <Card className={s.listCard}>
          <div className={s.headCenter}>
            <CardTitle>{t('Bonds & guarantees')}</CardTitle>
            {add('bond', 'Add guarantee')}
          </div>
          {view.bonds.map((b) => (
            <div key={b.position} className={s.row}>
              <span className={s.pretty}>{b.label}</span>
              <span className={s.num}>{b.amount}</span>
              <span className={s.statusCell}>
                <span className={cx(s.bondState, b.released && s.bondReleased)}>{b.state}</span>
                {canEdit && !b.released && (
                  <ReleaseBondButton code={code} position={b.position} context={context} form={forms.release} label={t('Release')} ariaLabel={`${t('Release')} · ${b.label}`} />
                )}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <Card className={s.listCard}>
        <div className={s.headTop}>
          <div className={s.titleCol}>
            <CardTitle>{t('Payment milestones')}</CardTitle>
            <span className={s.subtitle}>{t('Contractual schedule · invoicing is tracked on the Billing page')}</span>
          </div>
          {add('milestone', 'Add payment milestone')}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t('Milestone')}</Th>
              <Th align="right">{t('Share')}</Th>
              <Th align="right">{t('Amount')}</Th>
              <Th>{t('Contractual date')}</Th>
              <Th>{t('Condition')}</Th>
            </tr>
          </thead>
          <tbody>
            {base.map(row)}
            <tr>
              <td className={s.totalCell}>{t(view.groups.length ? 'Base contract' : 'Total')}</td>
              <td className={cx(s.right, s.num, s.totalCell, !view.total.ok && s.alert)}>{view.total.share}</td>
              <td className={cx(s.right, s.num, s.totalCell)}>{view.groups.length ? view.baseTotal.amount : view.total.amount}</td>
              <td className={s.totalHint} />
              <td className={cx(s.totalHint, !view.total.ok && s.alert)}>{view.total.hint}</td>
            </tr>
            {view.groups.map((g) => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={5} className={s.groupHead}>
                    <span className={s.pretty}>{g.label}</span> <span className={cx(g.tagClass, s.nowrap)}>{g.status}</span>
                    {g.note && <span className={s.meta}> · {g.note}</span>}
                  </td>
                </tr>
                {view.milestones.filter((m) => m.group === g.key).map(row)}
                <tr>
                  <td className={s.subtotalCell}>{t('Amendment total')}</td>
                  <td className={cx(s.right, s.num, s.subtotalCell, !g.ok && s.alert)}>{g.share}</td>
                  <td className={cx(s.right, s.num, s.subtotalCell)}>{g.amount}</td>
                  <td className={s.subtotalHint} />
                  <td className={cx(s.subtotalHint, !g.ok && s.alert)}>{g.hint}</td>
                </tr>
              </Fragment>
            ))}
            {view.groups.length > 0 && (
              <tr>
                <td className={s.totalCell}>{t('Total billable')}</td>
                <td className={s.totalCell} />
                <td className={cx(s.right, s.num, s.totalCell)}>{view.total.amount}</td>
                <td className={s.totalHint} />
                <td className={s.totalHint} />
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </Stack>
  );
}
