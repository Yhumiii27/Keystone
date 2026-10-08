// Contract — /projects/[code]/contract (docs/spec/04 §3, template 814–840, logic 4869–4889). Contract value and
// terms, the editable contract sheet, amendments, bonds & guarantees and the contractual payment schedule, read from
// the Contract DAL. Header primary "Add amendment" (AF `amendment`) for viewers who may edit the project's contract
// (hidden when the screen is outside their workspace, the project is read-only for them, or there is no contract).
// Breadcrumb extra = the contract reference as stored (it follows sheet edits).
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { ContractScreen } from '@/features/contract/contract-view';
import { FormButton } from '@/features/contract/form-button';
import { amendmentFormDef, bondFormDef, contractView, milestoneFormDef } from '@/features/contract/model';
import { getContract } from '@/server/dal/contract';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function ContractPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'contract');
  const projectCode = ctx.project.code;
  const [{ t, lang }, contract] = await Promise.all([getI18n(), getContract(projectCode)]);

  if (!contract)
    return (
      <>
        <PageHeader screen="contract" projectCode={projectCode} crumbExtra="" />
        <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
      </>
    );

  const canEdit = ctx.canEdit('contract');
  const context = t(projectLabel(ctx.project));
  const forms = { amendment: amendmentFormDef(t), bond: bondFormDef(t), milestone: milestoneFormDef(t) };
  const primary = canEdit ? (
    <FormButton kind="amendment" code={projectCode} context={context} form={forms.amendment} label={t('Add amendment')} variant="primary" />
  ) : undefined;

  return (
    <>
      <PageHeader screen="contract" projectCode={projectCode} primary={primary} crumbExtra={contract.sheet.reference} />
      <ContractScreen view={contractView(contract, t, lang)} code={projectCode} canEdit={canEdit} context={context} forms={forms} t={t} />
    </>
  );
}
