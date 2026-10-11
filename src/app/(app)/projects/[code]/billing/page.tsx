// Billing & payments — /projects/[code]/billing (docs/spec/04 §4, template 841–869, logic 4890–4903). Receivables
// KPIs, billing progress and retention, the planned milestones to invoice (late ones flagged) and the invoices (due
// date = issue date + payment terms in calendar days, Mark paid). Header primary "Issue invoice" (AF `billing`) only
// while a milestone is Planned, for viewers who may edit billing on this project. Breadcrumb extra = payment terms.
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
  const primary =
    canEdit && view.toInvoice.length ? (
      <FormButton kind="invoice" code={projectCode} context={context} form={invoiceForm} label={t('Issue invoice')} variant="primary" />
    ) : undefined;

  return (
    <>
      <PageHeader screen="billing" projectCode={projectCode} primary={primary} crumbExtra={contract.sheet.paymentTerms} />
      <BillingScreen view={view} code={projectCode} canEdit={canEdit} context={context} invoiceForm={invoiceForm} t={t} />
    </>
  );
}
