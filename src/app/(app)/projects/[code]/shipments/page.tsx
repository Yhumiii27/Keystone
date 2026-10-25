// Shipments — /projects/[code]/shipments (R-158 lot A; owner's decisions of 25 Oct 2026, docs/delivery-9/cadrage-r158-expeditions.md
// § 5; notes docs/delivery-9/notes-r158-shipments.md). The project's shipments of its equipment to the site: transport organised
// from the contract's Incoterm (decision 2), loads and their content declared by EPC2i (decision 10), the packing control against
// the BOM of the shipment's equipment lines with its per-HS-code summary (decision 4). Editors: the director, Logistics (every
// project) and the project's leads (`canEditShipments`); the team and the other internal roles read; the client is refused
// (R-042). Header primary "New shipment" for the editors when the project has an equipment line.
import { PageHeader } from '@/components/app/shell/page-header';
import { ShipmentFormButton } from '@/features/shipments/buttons';
import { gapFormDef, itemFormDef, loadFormDef, shipmentFormDef, shipmentsView, stepFormDef } from '@/features/shipments/model';
import { ShipmentsBody } from '@/features/shipments/shipments-view';
import { projectLabelText } from '@/i18n/data-text';
import { canSeeShipmentValues } from '@/domain/rights';
import { businessToday } from '@/server/clock';
import { getProjectShipments } from '@/server/dal/shipments';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function ShipmentsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'shipments');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, today] = await Promise.all([getI18n(), getProjectShipments(projectCode), businessToday()]);
  const canEdit = ctx.canEdit('shipments');
  const context = projectLabelText(ctx.project, lang);
  // R-158: the customs values follow NEW-D2-1, plus Logistics (`canSeeShipmentValues`).
  const view = shipmentsView(data!, today, t, lang, canSeeShipmentValues(ctx.viewer.role));
  const equipment = data!.equipment;
  const loadsOf = (ref: string) => data!.shipments.find((s) => s.ref === ref)?.loads.map((l) => l.number) ?? [];
  const packedParts = (ref: string) =>
    (data!.shipments.find((s) => s.ref === ref)?.loads ?? []).flatMap((l) => l.items.filter((i) => i.partRef).map((i) => ({ ref: i.partRef!, name: i.description })));
  // The dialogs of one shipment (its own loads are the content forms' choices).
  const formsFor = (ref: string) => ({
    edit: shipmentFormDef(t, equipment, true, data!.shipments.find((s) => s.ref === ref)?.equipment.map((e) => e.ref)),
    load: loadFormDef(t, false),
    editLoad: loadFormDef(t, true),
    item: itemFormDef(t, loadsOf(ref), data!.bom, lang, false),
    editItem: itemFormDef(t, loadsOf(ref), data!.bom, lang, true, packedParts(ref)),
    gap: gapFormDef(t),
    step: (step: Parameters<typeof stepFormDef>[1]) => stepFormDef(t, step),
  });
  const primary = canEdit && equipment.length ? (
    <ShipmentFormButton kind="create" code={projectCode} context={context} form={shipmentFormDef(t, equipment, false)} label={t('New shipment')} variant="primary" size="md" />
  ) : undefined;
  return (
    <>
      <PageHeader screen="shipments" projectCode={projectCode} primary={primary} crumbExtra="" />
      <ShipmentsBody view={view} code={projectCode} canEdit={canEdit} context={context} formsFor={formsFor} t={t} />
    </>
  );
}
