// Billing & payments — /projects/[code]/billing (docs/spec/04 §4, template 841–869, logic 4890–4903). Receivables
// KPIs, billing progress and retention, the planned milestones to invoice (late ones flagged) and the invoices (due
// date by the contract's payment rule — R-076, Mark paid), in the contract's currency (C-9). Header primary "Issue invoice"
// (AF `billing`) only while a billable milestone is Planned (NEW-D3-3: an unsigned amendment's are not), for viewers who may
// edit billing on this project. Breadcrumb extra = the payment terms in words.
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { BillingScreen } from '@/features/contract/billing-view';
import { FormButton } from '@/features/contract/form-button';
import { billingView, invoiceFormDef } from '@/features/contract/model';
import { getContract } from '@/server/dal/contract';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function BillingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'billing');
  const projectCode = ctx.project.code;
  const [{ t, lang }, contract] = await Promise.all([getI18n(), getContract(projectCode)]);

  if (!contract)
    return (
      <>
        <PageHeader screen="billing" projectCode={projectCode} crumbExtra="" />
        <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
      </>
    );

  const canEdit = ctx.canEdit('billing');
  const context = projectLabelText(ctx.project, lang);
  const view = billingView(contract, t, lang);
  const invoiceForm = invoiceFormDef(contract, t, lang);
  // R-077 (C-7): disabled, with the reason, when every planned milestone is blocked (its group exceeds 100 %).
  const allBlocked = view.toInvoice.length > 0 && view.toInvoice.every((m) => m.blocked);
  const primary =
    canEdit && view.toInvoice.length ? (
      <FormButton
        kind="invoice" code={projectCode} context={context} form={invoiceForm} label={t('Issue invoice')} variant="primary"
        disabledReason={allBlocked ? view.toInvoice[0].blocked : null}
      />
    ) : undefined;

  return (
    <>
      <PageHeader screen="billing" projectCode={projectCode} primary={primary} crumbExtra={view.terms} />
      <BillingScreen view={view} code={projectCode} canEdit={canEdit} context={context} invoiceForm={invoiceForm} t={t} />
    </>
  );
}
