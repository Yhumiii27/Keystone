// R-158 lot B — shipping instructions to the forwarder (instructions d'expédition): what the forwarder needs to draw up the bill of
// lading (sea), the air waybill (air) or the consignment note (road) — parties, Incoterm, places, dates, the loads (type, number,
// seal, packages, gross weight), the goods by HS code and the declared value, the special instructions. Generic layout until
// EPC2i's standard format: replace this file to change it.
import { LOAD_TYPE_LABEL } from '@/domain/shipments';
import { col, sheet } from '../providers/common';
import { day, eurText, genericFootnote, header, hsGroups, hsSheet, hsTotals, incotermText, partyFields, restrictionBlocks, typed } from './common';
import type { ShippingTemplate } from './types';

export const shippingInstructions: ShippingTemplate = (d, c) => {
  const s = d.shipment;
  const transportDoc = s.mode === 'sea' ? c.t('Bill of lading (B/L)') : s.mode === 'air' ? c.t('Air waybill (AWB)') : s.mode === 'road' ? c.t('CMR consignment note') : c.t('Multimodal transport document');
  const loads = sheet(c.t('Loads'), [
    col('number', c.t('Truck / container'), 'text', 6), col('type', c.t('Load type'), 'text', 16), col('identifier', c.t('Container number or plate'), 'text', 18), col('seal', c.t('Seal'), 'text', 12),
    col('packages', c.t('Packages'), 'integer', 8), col('gross', c.t('Declared gross weight'), 'number', 10),
  ], s.loads.map((l) => ({
    number: `#${l.number}`, type: c.t(LOAD_TYPE_LABEL[l.type]), identifier: typed(c, l.identifier), seal: typed(c, l.seal),
    packages: l.items.reduce((a, it) => a + (it.packages ?? 0), 0), gross: l.grossKg,
  })));
  const groups = hsGroups(d, c);
  const value = groups.reduce((a, g) => a + g.value, 0);
  return {
    ...header(d, c, c.t('Shipping instructions to the forwarder')),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [c.t('Addressed to'), typed(c, s.forwarder)], [c.t('Transport document requested'), transportDoc],
        ...partyFields(d, c),
        [c.t('Incoterm'), incotermText(d, c)], [c.t('Place of loading'), typed(c, s.origin)],
        [c.t('Place of discharge'), typed(c, s.destination)], ['ETD · ETA', `${day(c, s.etd)} · ${day(c, s.eta)}`],
        ...(c.values ? [[c.t('Declared value'), eurText(c, value)] as [string, string]] : []),
        [c.t('Freight'), d.incoterm && ['EXW', 'FCA', 'FAS', 'FOB'].includes(d.incoterm.code) ? c.t('Collect (buyer)') : c.t('Prepaid (EPC2i)')],
      ] },
      { kind: 'heading', text: c.t('Loads') },
      { kind: 'table', sheet: loads },
      { kind: 'heading', text: c.t('Goods by HS code') },
      { kind: 'table', sheet: hsSheet(c, groups, c.values), totals: hsTotals(c, groups) },
      ...restrictionBlocks(d, c),
      ...(s.note ? [{ kind: 'paragraph' as const, text: `${c.t('Special instructions')} · ${typed(c, s.note)}` }] : []),
    ],
    footnote: genericFootnote(c, c.t('The commercial invoice is issued by the accounting department, not by Keystone.')),
  };
};
