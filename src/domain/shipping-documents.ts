// R-158 lot B — the shipping documents Keystone generates (owner's decision 3, docs/delivery-9/cadrage-r158-expeditions.md § 5:
// every document needed, EXCEPT the invoices — no commercial invoice, no customs / proforma invoice). Pure rules, no I/O: the
// kinds, their EN labels (FR in src/i18n/extra/d9-shipments-b.json), when one can be generated, which ones carry customs values
// and the Codex document type they are filed under. The layouts are in src/server/export/shipping-documents/ (one template per
// kind, generic until EPC2i provides its standard formats — decision 10).
import type { ShipmentMode } from './shipments';

export const SHIPPING_DOC_KINDS = [
  'packing_list', 'container_packing_list', 'delivery_note', 'marking', 'cmr', 'shipping_instructions', 'origin_request', 'export_declaration',
] as const;
export type ShippingDocKind = (typeof SHIPPING_DOC_KINDS)[number];
export const isShippingDocKind = (v: unknown): v is ShippingDocKind => typeof v === 'string' && (SHIPPING_DOC_KINDS as readonly string[]).includes(v);

export const SHIPPING_DOC_LABEL: Record<ShippingDocKind, string> = {
  packing_list: 'Packing list',
  container_packing_list: 'Packing list per container',
  delivery_note: 'Delivery note',
  marking: 'Package marking labels',
  cmr: 'CMR consignment note',
  shipping_instructions: 'Shipping instructions to the forwarder',
  origin_request: 'Certificate of origin / EUR.1 request',
  export_declaration: 'Export declaration data',
};

/** One line under each label on the screen (EN source). */
export const SHIPPING_DOC_HINT: Record<ShippingDocKind, string> = {
  packing_list: 'Every load and its content, weights and HS codes',
  container_packing_list: 'One page per container or truck, with its number and seal',
  delivery_note: 'Delivered quantities, signed by the consignee on site',
  marking: 'One label per package',
  cmr: 'Road transport (CMR convention)',
  shipping_instructions: 'Basis for the bill of lading or the air waybill',
  origin_request: 'Pre-filled data for the chamber of commerce or customs',
  export_declaration: 'Per HS code, for the customs broker',
};

/** Codex document type of the shipping documents (R-158; created in Keystone's register, to be created in Codex — notes § Lot B). */
export const SHIPPING_DOC_TYPE = 'SHP';

/** The documents that carry customs values (left out for a viewer who may not see them, `canSeeShipmentValues`). */
export const SHIPPING_DOC_WITH_VALUES: readonly ShippingDocKind[] = ['packing_list', 'shipping_instructions', 'origin_request', 'export_declaration'];

/**
 * Why a document cannot be generated for the shipment (EN source), null when it can: every document needs at least one load
 * with content; the CMR consignment note is for road transport (road or multimodal).
 */
export function shippingDocBlocker(kind: ShippingDocKind, s: { mode: ShipmentMode | null; loads: { items: unknown[] }[] }): string | null {
  if (!s.loads.some((l) => l.items.length > 0)) return 'Declare the loads and their content first';
  if (kind === 'cmr' && s.mode !== 'road' && s.mode !== 'multimodal') return 'The CMR consignment note is for road transport';
  return null;
}

/** Next revision letter of a Codex record: A → B … Z → AA. */
export function nextRevisionLetter(rev: string): string {
  const s = rev.toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 'A';
  const chars = [...s];
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
  }
  return `A${chars.join('')}`;
}

/** Variant of the export URL (`?variant=packing_list&id=EXP-01`) — the kind itself. */
export const shippingDocVariant = (kind: ShippingDocKind) => kind;
