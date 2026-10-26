// R-158 lot B — delivery note (bon de livraison): what is delivered to the site, by load, with blank columns for the consignee to
// check the quantities received, and the signatures of the shipper, the carrier and the consignee. No value. Generic layout until
// EPC2i's standard format: replace this file to change it.
import { col, sheet } from '../providers/common';
import { contentRows, genericFootnote, header, partyFields, transportFields } from './common';
import type { ShippingTemplate } from './types';

export const deliveryNote: ShippingTemplate = (d, c) => {
  const rows = contentRows(d, c);
  const lines = sheet(c.t('Delivered items'), [
    col('load', c.t('Truck / container'), 'text', 6), col('article', c.t('Article'), 'text', 14), col('description', c.t('Description'), 'text', 38),
    col('quantity', c.t('Quantity delivered'), 'number', 10), col('packages', c.t('Packages'), 'integer', 8), col('received', c.t('Quantity received'), 'text', 10),
    col('remarks', c.t('Remarks'), 'text', 20),
  ], rows.map((r) => ({ load: r.load, article: r.article, description: r.description, quantity: r.quantity, packages: r.packages, received: '', remarks: '' })));
  return {
    ...header(d, c, c.t('Delivery note')),
    blocks: [
      { kind: 'fields', columns: 2, items: [...partyFields(d, c), ...transportFields(d, c)] },
      { kind: 'heading', text: c.t('Delivered items') },
      { kind: 'table', sheet: lines, totals: { description: c.t('Total'), quantity: rows.reduce((a, r) => a + r.quantity, 0), packages: rows.reduce((a, r) => a + (r.packages ?? 0), 0) } },
      { kind: 'paragraph', text: c.t('Received in apparent good order except as noted. Any missing or damaged item is to be written on this note and reported within 48 hours.'), muted: true },
      { kind: 'spacer', height: 14 },
      { kind: 'signatures', parties: [{ role: c.t('Shipper') }, { role: c.t('Carrier') }, { role: c.t('Consignee — received on and by') }] },
    ],
    footnote: genericFootnote(c),
  };
};
