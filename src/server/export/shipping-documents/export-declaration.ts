// R-158 lot B — export declaration data (données de la déclaration d'export) for the customs broker: exporter, consignee,
// Incoterm, mode, destination, totals (packages, net and gross weight, statistical value) and one line per HS code with its
// description, quantity, weights, origin and value; the export-restriction alerts. The declaration itself is lodged by the
// broker. Generic layout until EPC2i's standard format: replace this file to change it.
import { eurText, genericFootnote, header, hsGroups, hsSheet, hsTotals, kgText, partyFields, restrictionBlocks, transportFields, typed } from './common';
import type { ShippingTemplate } from './types';

export const exportDeclaration: ShippingTemplate = (d, c) => {
  const groups = hsGroups(d, c);
  const totals = hsTotals(c, groups);
  return {
    ...header(d, c, c.t('Export declaration data')),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [c.t('Exporter'), partyFields(d, c)[0][1]], ...partyFields(d, c).slice(1),
        [c.t('Country of destination'), d.site ? typed(c, d.site.country) : '—'],
        ...transportFields(d, c),
        [c.t('Total packages'), String(totals.packages)], [c.t('Total gross weight'), kgText(c, totals.gross as number)], [c.t('Total net weight'), kgText(c, totals.net as number)],
        ...(c.values ? [[c.t('Statistical value'), eurText(c, totals.value as number)] as [string, string]] : []),
      ] },
      { kind: 'heading', text: c.t('Goods by HS code') },
      { kind: 'table', sheet: hsSheet(c, groups, c.values), totals },
      ...restrictionBlocks(d, c),
    ],
    footnote: genericFootnote(c, c.t('Data for the customs broker: the export declaration is lodged by the broker.')),
  };
};
