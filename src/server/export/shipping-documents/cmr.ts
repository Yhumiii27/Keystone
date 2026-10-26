// R-158 lot B — CMR consignment note (lettre de voiture CMR) for road transport, with the boxes of the CMR convention's form:
// sender, consignee, place of delivery, place and date of taking over, documents attached, the goods (marks, packages, nature,
// statistical number, gross weight, volume), the sender's instructions, the carrier and the three signatures. No value.
// Generic layout until EPC2i's standard (pre-printed) form: replace this file to change it.
import { col, sheet } from '../providers/common';
import { consigneeText, contentRows, day, genericFootnote, header, incotermText, SHIPPER, typed } from './common';
import type { ShippingTemplate } from './types';

export const cmr: ShippingTemplate = (d, c) => {
  const s = d.shipment;
  const rows = contentRows(d, c);
  const goods = sheet(c.t('Goods'), [
    col('marks', `6 · ${c.t('Marks and numbers')}`, 'text', 16), col('packages', `7 · ${c.t('Packages')}`, 'integer', 8), col('packing', `8 · ${c.t('Method of packing')}`, 'text', 12),
    col('nature', `9 · ${c.t('Nature of the goods')}`, 'text', 32), col('hs', `10 · ${c.t('Statistical number')}`, 'text', 10),
    col('gross', `11 · ${c.t('Gross weight (kg)')}`, 'number', 9), col('volume', '12 · m³', 'number', 7, { decimals: 3 }),
  ], rows.map((r) => {
    const l = s.loads.find((x) => `#${x.number}` === r.load)!;
    return { marks: `${s.ref} ${r.load}${l.identifier ? ` ${typed(c, l.identifier)}` : ''}`, packages: r.packages, packing: c.t('Crates'), nature: `${r.article} · ${r.description}`, hs: r.hs, gross: r.gross, volume: r.volume };
  }));
  const docs = [c.t('Packing list'), c.t('Delivery note')].join(', ');
  return {
    ...header(d, c, c.t('CMR consignment note')),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [`1 · ${c.t('Sender')}`, `${SHIPPER} · ${typed(c, s.origin)}`], [`2 · ${c.t('Consignee')}`, consigneeText(d, c)],
        [`3 · ${c.t('Place of delivery of the goods')}`, typed(c, s.destination)], [`4 · ${c.t('Place and date of taking over the goods')}`, `${typed(c, s.origin)} · ${day(c, s.atd ?? s.etd)}`],
        [`5 · ${c.t('Documents attached')}`, docs], [`13 · ${c.t('Sender’s instructions')}`, incotermText(d, c)],
        [`16 · ${c.t('Carrier')}`, typed(c, s.forwarder)], [`17 · ${c.t('Successive carriers')}`, '—'],
        [c.t('Vehicle / container'), s.loads.map((l) => typed(c, l.identifier)).join(', ') || '—'], [`21 · ${c.t('Established in')}`, `${typed(c, s.origin)} · ${day(c, c.today)}`],
      ] },
      { kind: 'table', sheet: goods, totals: { nature: c.t('Total'), packages: rows.reduce((a, r) => a + (r.packages ?? 0), 0), gross: Math.round(rows.reduce((a, r) => a + (r.gross ?? 0), 0) * 1000) / 1000, volume: Math.round(rows.reduce((a, r) => a + (r.volume ?? 0), 0) * 1000) / 1000 } },
      { kind: 'paragraph', text: c.t('This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the International Carriage of Goods by Road (CMR).'), muted: true },
      { kind: 'spacer', height: 14 },
      { kind: 'signatures', parties: [{ role: `22 · ${c.t('Sender')}` }, { role: `23 · ${c.t('Carrier')}` }, { role: `24 · ${c.t('Consignee — goods received')}` }] },
    ],
    footnote: genericFootnote(c),
  };
};
