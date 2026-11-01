// R-158 lot B — the shipping documents Keystone generates (owner's decision 3: every document needed but the invoices), one
// template per kind in this folder, each replaceable on its own by EPC2i's standard format (decision 10). `buildShippingDocument`
// applies the values rule (`canSeeShipmentValues`): without it, the € columns, totals and amounts are left out.
import type { ShippingDocKind } from '@/domain/shipping-documents';
import type { PdfDocument } from '../types';
import { withoutValues } from './common';
import { cmr } from './cmr';
import { containerPackingList } from './container-packing-list';
import { deliveryNote } from './delivery-note';
import { exportDeclaration } from './export-declaration';
import { marking } from './marking';
import { originRequest } from './origin-request';
import { packingList } from './packing-list';
import { shippingInstructions } from './shipping-instructions';
import type { ShippingDocData, ShippingTemplate, TemplateCtx } from './types';

export type { ShippingDocData, TemplateCtx } from './types';

export const SHIPPING_TEMPLATES: Record<ShippingDocKind, ShippingTemplate> = {
  packing_list: packingList,
  container_packing_list: containerPackingList,
  delivery_note: deliveryNote,
  marking,
  cmr,
  shipping_instructions: shippingInstructions,
  origin_request: originRequest,
  export_declaration: exportDeclaration,
};

export function buildShippingDocument(kind: ShippingDocKind, data: ShippingDocData, ctx: TemplateCtx): PdfDocument {
  const doc = SHIPPING_TEMPLATES[kind](data, ctx);
  return ctx.values ? doc : withoutValues(doc);
}
