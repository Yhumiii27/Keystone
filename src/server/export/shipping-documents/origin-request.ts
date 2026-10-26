// R-158 lot B — certificate of origin / EUR.1 request (demande de certificat d'origine / EUR.1): the data pre-filled for the
// chamber of commerce or the customs — exporter, consignee, countries of origin and destination, transport, the goods by HS code
// with their origin, weights and value — signed by the applicant. Keystone pre-fills the request; the certificate itself is issued
// by the chamber of commerce or the customs. Generic layout until EPC2i's standard format: replace this file to change it.
import { genericFootnote, header, hsGroups, hsSheet, hsTotals, partyFields, restrictionBlocks, transportFields, typed } from './common';
import type { ShippingTemplate } from './types';

export const originRequest: ShippingTemplate = (d, c) => {
  const groups = hsGroups(d, c);
  const origins = [...new Set(groups.flatMap((g) => g.origins.split(', ').filter(Boolean)))].sort().join(', ') || '—';
  return {
    ...header(d, c, c.t('Certificate of origin / EUR.1 request')),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        ...partyFields(d, c),
        [c.t('Country of origin'), origins], [c.t('Country of destination'), d.site ? typed(c, d.site.country) : '—'],
        ...transportFields(d, c),
      ] },
      { kind: 'heading', text: c.t('Goods by HS code') },
      { kind: 'table', sheet: hsSheet(c, groups, c.values), totals: hsTotals(c, groups) },
      ...restrictionBlocks(d, c),
      { kind: 'paragraph', text: c.t('The applicant declares that the goods described above originate in the country shown and asks for the certificate to be issued.'), muted: true },
      { kind: 'spacer', height: 14 },
      { kind: 'signatures', parties: [{ role: c.t('Applicant (EPC2i)') }, { role: c.t('Issuing authority') }] },
    ],
    footnote: genericFootnote(c, c.t('Pre-filled request: the certificate is issued by the chamber of commerce or the customs.')),
  };
};
