// Contract screen body (docs/spec/04 §3, template 814–840): 4 KPI tiles, the "Contract sheet" form, "Amendments" |
// "Bonds & guarantees", "Payment milestones" with its total row. Server Component; the sheet form and the "Add …"
// buttons are client islands, rendered only for viewers who may edit (read-only viewers see disabled fields).
import { FileText } from '@phosphor-icons/react/dist/ssr';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Stack } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { ButtonLink } from '@/components/ds/Button';
import { Card, CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { documentsHref } from '@/features/docs/links';
import type { T } from '@/i18n/translate';
import { FormButton } from './form-button';
import type { ContractView } from './model';
import { ContractSheetForm } from './sheet-form';
import s from './contract.module.css';

/** Documents · Codex with the document record open (`setState({screen:'docs', dv:{open}})` → `?doc=`). */
export const docHref = (code: string, ref: string) => documentsHref(code, { doc: ref });

export interface ContractScreenProps {
  view: ContractView;
  code: string;
  canEdit: boolean;
  /** Translated project label, the dialogs' sub-line. */
  context: string;
  forms: { amendment: FormDef; bond: FormDef; milestone: FormDef };
  t: T;
}

export function ContractScreen({ view, code, canEdit, context, forms, t }: ContractScreenProps) {
  const add = (kind: 'amendment' | 'bond' | 'milestone', label: string) =>
    canEdit && <FormButton kind={kind} code={code} context={context} form={forms[kind]} label={t(label)} size="xs" push nowrap />;
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

      <div className={s.pair}>
        <Card className={s.listCard}>
          <div className={s.headCenter}>
            <CardTitle>{t('Amendments')}</CardTitle>
            {add('amendment', 'Add amendment')}
          </div>
          {view.amendments.map((a, i) => (
            <div key={i} className={s.row}>
              <span className={s.stack}>
                <span className={s.pretty}>{a.label}</span>
                <span className={s.meta}>{a.date}</span>
              </span>
              <span className={s.num}>{a.amount}</span>
              <span className={s.statusCell}>
                <span className={cx(a.tagClass, s.nowrap)}>{a.status}</span>
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
          {view.bonds.map((b, i) => (
            <div key={i} className={s.row}>
              <span className={s.pretty}>{b.label}</span>
              <span className={s.num}>{b.amount}</span>
              <span className={cx(s.bondState, b.released && s.bondReleased)}>{b.state}</span>
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
            {view.milestones.map((m) => (
              <tr key={m.id}>
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
            ))}
            <tr>
              <td className={s.totalCell}>{t('Total')}</td>
              <td className={cx(s.right, s.num, s.totalCell, !view.total.ok && s.alert)}>{view.total.share}</td>
              <td className={cx(s.right, s.num, s.totalCell)}>{view.total.amount}</td>
              <td className={s.totalHint} />
              <td className={cx(s.totalHint, !view.total.ok && s.alert)}>{view.total.hint}</td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </Stack>
  );
}
