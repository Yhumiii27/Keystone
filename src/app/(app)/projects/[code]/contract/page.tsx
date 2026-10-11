// Contract — /projects/[code]/contract (docs/spec/04 §3, template 814–840, logic 4869–4889). Contract value and
// terms, the editable contract sheet, amendments, bonds & guarantees and the contractual payment schedule, read from
// the Contract DAL. Header primary "Add amendment" (AF `amendment`) for viewers who may edit the project's contract
// (hidden when the screen is outside their workspace, the project is read-only for them, or there is no contract).
// Breadcrumb extra = the contract reference as stored (it follows sheet edits).
// Delivery 7: amounts in the contract's currency and the project's "Currency & budget rate" (C-9, R-075 — set by the
// portfolio director, also on a project without contract), the payment rule (R-076), the amendments' signature cycle and own
// milestones, the guarantees' release (R-079).
import { EmptyState } from '@/components/app/EmptyState';
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { ContractScreen, CurrencyCard } from '@/features/contract/contract-view';
import { FormButton } from '@/features/contract/form-button';
import {
  amendmentFormDef, bondFormDef, contractView, currencyView, milestoneFormDef, releaseFormDef, signFormDef,
} from '@/features/contract/model';
import { getContract } from '@/server/dal/contract';
import { getProjectFx } from '@/server/dal/currency';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function ContractPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'contract');
  const projectCode = ctx.project.code;
  const [{ t, lang }, contract] = await Promise.all([getI18n(), getContract(projectCode)]);
  // C-9: the portfolio director sets the project's currency and budget rate (not on a read-only project).
  const canSetRate = ctx.viewer.role === 'director' && ctx.canEdit('contract');

  if (!contract)
    return (
      <>
        <PageHeader screen="contract" projectCode={projectCode} crumbExtra="" />
        <Stack>
          <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
          <CurrencyCard fx={currencyView(await getProjectFx(projectCode), lang)} code={projectCode} canSetRate={canSetRate} t={t} />
        </Stack>
      </>
    );

  const canEdit = ctx.canEdit('contract');
  const context = t(projectLabel(ctx.project));
  const currency = contract.sheet.currency;
  const forms = {
    amendment: amendmentFormDef(t, currency),
    bond: bondFormDef(t, currency),
    milestone: milestoneFormDef(t, contract.amendments, lang),
    sign: (doc: string | null) => signFormDef(t, doc),
    release: releaseFormDef(t),
  };
  const primary = canEdit ? (
    <FormButton kind="amendment" code={projectCode} context={context} form={forms.amendment} label={t('Add amendment')} variant="primary" />
  ) : undefined;

  return (
    <>
      <PageHeader screen="contract" projectCode={projectCode} primary={primary} crumbExtra={contract.sheet.reference} />
      <ContractScreen view={contractView(contract, t, lang)} code={projectCode} canEdit={canEdit} canSetRate={canSetRate} context={context} forms={forms} t={t} />
    </>
  );
}
