// Delivery / terms of a purchase order drafted in Keystone (R-169). The prototype wrote the constant
// "Site gate 2 · DAP · Net 30" on every new order; Keystone now writes only what the data says:
//   - an order from an awarded RFQ: the RFQ's Incoterm ("DAP site") and the winning quote's payment terms ("Net 45");
//   - an order drafted from the BOM shortfall or the spares list: nothing is known yet — the terms are agreed with the
//     supplier before approval, and the screens say "To be agreed".
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import { incoterm, type Incoterm } from '@/server/db/codes';

/** Shown (and exported) for an order whose delivery terms are still empty. */
export const TERMS_TO_AGREE = 'To be agreed';

/** "DAP site · Net 45" from the RFQ and the quote; '' when neither is known. */
export function orderDeliveryTerms(input: { incoterm?: Incoterm | null; paymentTerms?: string | null } = {}): string {
  const parts = [input.incoterm && incoterm.isCode(input.incoterm) ? incoterm.label(input.incoterm) : '', (input.paymentTerms ?? '').trim()];
  return parts.filter(Boolean).join(' · ');
}

/** Delivery terms in the viewer's language: as typed (or the seeded demo entry), "To be agreed" when empty. */
export const deliveryTermsText = (terms: string, lang: Lang, t: T) => (terms.trim() ? dataText(terms, lang) : t(TERMS_TO_AGREE));
