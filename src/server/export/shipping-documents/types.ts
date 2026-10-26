// R-158 lot B — what the shipping-document templates read (src/server/export/shipping-documents/): one shipment of a project with
// its parties, transport, loads and content, as Keystone holds them. Pure types: the templates are pure functions of this data and
// of the language (tests render them without a database); `data.ts` loads it.
import type { Lang, T } from '@/i18n/translate';
import type { ShipmentRow } from '@/server/dal/shipments';
import type { PdfDocument } from '../types';

export interface ShippingDocData {
  project: { code: string; name: string; client: string | null };
  /** The project's site sheet (consignee's site, its contact on site), when there is one. */
  site: { name: string; country: string; contact: string } | null;
  /** The contract's Incoterm and named place. */
  incoterm: { code: string; name: string; place: string | null } | null;
  shipment: ShipmentRow;
  /** The shipment's equipment lines as labels ("EQ-02 · 3 × MEMU"). */
  equipment: string[];
}

export interface TemplateCtx {
  t: T;
  lang: Lang;
  /** Customs values shown (`canSeeShipmentValues`); otherwise every € column and amount is left out. */
  values: boolean;
  /** Business date (the document date). */
  today: string;
}

/** One template per document kind (decision 3) — generic layouts, each replaceable by EPC2i's standard format on its own. */
export type ShippingTemplate = (d: ShippingDocData, c: TemplateCtx) => PdfDocument;
