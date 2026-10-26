// R-158 lot B — packing list per container (liste de colisage par conteneur), owner's decision 10: one page per load EPC2i
// declared — its type, number, seal, declared gross weight and content — signed by who loaded and who checked. No value.
// Generic layout until EPC2i's standard format: replace this file to change it.
import type { PdfBlock } from '../types';
import { contentRows, contentSheet, contentTotals, genericFootnote, header, kgText, loadLabel, typed } from './common';
import type { ShippingTemplate } from './types';

export const containerPackingList: ShippingTemplate = (d, c) => {
  const s = d.shipment;
  const blocks = s.loads.flatMap((l, i): PdfBlock[] => {
    const rows = contentRows(d, c, l.number);
    return [
      ...(i > 0 ? [{ kind: 'pageBreak' } as const] : []),
      { kind: 'heading', text: `${c.t('Truck / container')} ${loadLabel(c, l)} · ${i + 1} / ${s.loads.length}` },
      { kind: 'fields', columns: 2, items: [
        [c.t('Container number or plate'), typed(c, l.identifier)], [c.t('Seal'), typed(c, l.seal)],
        [c.t('Declared gross weight'), kgText(c, l.grossKg)], [c.t('Packages'), String(rows.reduce((a, r) => a + (r.packages ?? 0), 0))],
        [c.t('Destination'), typed(c, s.destination)], [c.t('Note'), typed(c, l.note)],
      ] },
      { kind: 'table', sheet: contentSheet(c, rows, ['article', 'description', 'hs', 'quantity', 'packages', 'dims', 'net', 'gross']), totals: contentTotals(c, rows) },
      { kind: 'spacer', height: 14 },
      { kind: 'signatures', parties: [{ role: c.t('Loaded by') }, { role: c.t('Checked by') }] },
    ];
  });
  return {
    ...header(d, c, c.t('Packing list per container')),
    landscape: true,
    blocks: blocks.length ? blocks : [{ kind: 'paragraph', text: c.t('No load declared yet') }],
    footnote: genericFootnote(c),
  };
};
