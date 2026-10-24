// Contract — /projects/[code]/contract (docs/spec/04 §3, template 814–840, logic 4869–4889). Contract value and
// terms, the editable contract sheet, amendments, bonds & guarantees and the contractual payment schedule, read from
// the Contract DAL. Header primary "Add amendment" (AF `amendment`) for viewers who may edit the project's contract
// (hidden when the screen is outside their workspace, the project is read-only for them, or there is no contract).
// Breadcrumb extra = the contract reference as stored (it follows sheet edits).
// Delivery 7: amounts in the contract's currency and the project's "Currency & budget rate" (C-9, R-075 — set by the
// portfolio director and, since R-044, Finance; also on a project without contract), the payment rule (R-076), the amendments' signature cycle and own
// milestones, the guarantees' release (R-079). Delivery 9 (R-185): the project's "Equipment" card (equipment lines); R-190: the
// "Client" card (external client or group subsidiary — the director sets it).
import { EmptyState } from '@/components/app/EmptyState';
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { CapexLinkCard, ContractScreen, CurrencyCard, ProjectClientCard } from '@/features/contract/contract-view';
import { FormButton } from '@/features/contract/form-button';
import {
  amendmentFormDef, bondFormDef, contractView, currencyView, editMilestoneFormDef, milestoneFormDef, releaseFormDef, signFormDef,
} from '@/features/contract/model';
import { EquipmentCard } from '@/features/contract/equipment-card';
import { canSetInternalClient } from '@/domain/internal-client';
import { canSetBudgetRate, canSetCapexLink, canSetProjectEquipment } from '@/domain/rights';
import { listCatalogueChoices } from '@/server/dal/machine-catalogue';
import { listMachineTypeOptions } from '@/server/dal/mtypes';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import { getCapexLink } from '@/server/dal/capex-link';
import { getProjectClient, listSubsidiaries } from '@/server/dal/internal-client';
import { getContract } from '@/server/dal/contract';
import { getProjectFx } from '@/server/dal/currency';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function ContractPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'contract');
  const projectCode = ctx.project.code;
  const canSetClient = canSetInternalClient(ctx.viewer.role) && ctx.canEdit('contract');
  const [{ t, lang }, contract, capexLink, equipment, types, catalogue, client, subsidiaries] = await Promise.all([
    getI18n(), getContract(projectCode), getCapexLink(projectCode), listProjectEquipments(projectCode), listMachineTypeOptions(), listCatalogueChoices(),
    getProjectClient(projectCode), canSetClient ? listSubsidiaries() : Promise.resolve([]),
  ]);
  // C-9: the portfolio director and Finance (R-044) set the project's currency and budget rate.
  const canSetRate = canSetBudgetRate(ctx.viewer.role) && ctx.canEdit('contract');
  // R-190: the director and the project's leads set its CAPEX link (also on a project without contract).
  const capexCard = <CapexLinkCard link={capexLink} code={projectCode} canEdit={canSetCapexLink(ctx.viewer.role, ctx.access) && ctx.canEdit('contract')} t={t} />;
  // R-190: the project's client, external or a group subsidiary; the director sets it (also on a project without contract).
  const clientCard = <ProjectClientCard client={client} code={projectCode} canEdit={canSetClient} subsidiaries={subsidiaries} t={t} lang={lang} />;
  // R-185: the project's equipment lines; the director and the project's leads edit them (also on a project without contract).
  const equipmentCard = (
    <EquipmentCard
      lines={equipment} code={projectCode} canEdit={canSetProjectEquipment(ctx.viewer.role, ctx.access) && ctx.canEdit('contract')} types={types} catalogue={catalogue}
      context={projectLabelText(ctx.project, lang)} t={t} lang={lang}
    />
  );

  if (!contract)
    return (
      <>
        <PageHeader screen="contract" projectCode={projectCode} crumbExtra="" />
        <Stack>
          <EmptyState variant="boxed">{t('No contract registered for this project')}</EmptyState>
          <CurrencyCard fx={currencyView(await getProjectFx(projectCode), lang)} code={projectCode} canSetRate={canSetRate} t={t} />
          {equipmentCard}
          {capexCard}
          {clientCard}
        </Stack>
      </>
    );

  const canEdit = ctx.canEdit('contract');
  const context = projectLabelText(ctx.project, lang);
  const currency = contract.sheet.currency;
  const forms = {
    amendment: amendmentFormDef(t, currency),
    bond: bondFormDef(t, currency),
    milestone: milestoneFormDef(t, contract.amendments, lang),
    sign: (doc: string | null) => signFormDef(t, contract.today, doc),
    release: releaseFormDef(t, contract.today),
    // Delivery 8 (R-077, C-7a): correcting a planned milestone (its basis stays).
    editMilestone: (onAmendment: boolean) => editMilestoneFormDef(t, onAmendment),
  };
  const primary = canEdit ? (
    <FormButton kind="amendment" code={projectCode} context={context} form={forms.amendment} label={t('Add amendment')} variant="primary" />
  ) : undefined;

  return (
    <>
      <PageHeader screen="contract" projectCode={projectCode} primary={primary} crumbExtra={contract.sheet.reference} />
      <ContractScreen view={contractView(contract, t, lang)} code={projectCode} canEdit={canEdit} canSetRate={canSetRate} context={context} forms={forms} t={t} capexCard={<>{equipmentCard}{capexCard}{clientCard}</>} />
    </>
  );
}
