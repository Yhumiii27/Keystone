// R-158 lot B — packing list (liste de colisage) of a shipment: parties, transport, then each load with its content (HS code,
// quantities, packages, dimensions, weights, origin, customs value) and the shipment's totals. Generic layout until EPC2i's
// standard format (owner's decision 10): replace this file to change it.
import type { PdfBlock } from '../types';
import {
  contentRows, contentSheet, contentTotals, eurText, genericFootnote, header, kgText, loadLabel, numText, partyFields, restrictionBlocks, transportFields, typed,
} from './common';
import type { ShippingTemplate } from './types';

export const packingList: ShippingTemplate = (d, c) => {
  const s = d.shipment;
  const all = contentRows(d, c);
  const totals = contentTotals(c, all);
  const keys = ['article', 'description', 'hs', 'quantity', 'packages', 'dims', 'net', 'gross', 'origin', ...(c.values ? ['value' as const] : [])] as const;
  const loads: PdfBlock[] = s.loads.flatMap((l): PdfBlock[] => {
    const rows = contentRows(d, c, l.number);
    return [
      { kind: 'heading', text: `${c.t('Truck / container')} ${loadLabel(c, l)}` },
      { kind: 'fields', columns: 3, items: [[c.t('Seal'), typed(c, l.seal)], [c.t('Declared gross weight'), kgText(c, l.grossKg)], [c.t('Note'), typed(c, l.note)]] },
      { kind: 'table', sheet: contentSheet(c, rows, [...keys]), totals: contentTotals(c, rows) },
    ];
  });
  return {
    ...header(d, c, c.t('Packing list')),
    landscape: true,
    blocks: [
      { kind: 'fields', columns: 2, items: [...partyFields(d, c), ...transportFields(d, c)] },
      ...restrictionBlocks(d, c),
      ...loads,
      { kind: 'heading', text: c.t('Shipment totals') },
      { kind: 'fields', columns: 3, items: [
        [c.t('Content lines'), String(all.length)], [c.t('Packages'), numText(c, totals.packages as number)], [c.t('Loads'), String(s.loads.length)],
        [c.t('Total net weight'), kgText(c, totals.net as number)], [c.t('Total gross weight'), kgText(c, totals.gross as number)],
        ...(c.values ? [[c.t('Customs value'), eurText(c, totals.value as number)] as [string, string]] : []),
      ] },
    ],
    footnote: genericFootnote(c),
  };
};
