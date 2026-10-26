// R-158 lot B — package marking labels (marquage des colis): one label per package — consignee, destination, shipment and project,
// load, content, package number "n / N", gross weight per package, dimensions and handling marks. Four labels a page. No value.
// Generic layout until EPC2i's standard format (label size, logos, barcodes): replace this file to change it.
import type { PdfBlock } from '../types';
import { consigneeText, genericFootnote, header, kgText, numText, typed } from './common';
import type { ShippingTemplate } from './types';

const PER_PAGE = 4;

export const marking: ShippingTemplate = (d, c) => {
  const s = d.shipment;
  const labels = s.loads.flatMap((l) => l.items.flatMap((it) => {
    const n = Math.max(1, it.packages ?? 1);
    return Array.from({ length: n }, () => ({ l, it, n }));
  }));
  const blocks = labels.flatMap(({ l, it, n }, i): PdfBlock[] => [
    ...(i > 0 && i % PER_PAGE === 0 ? [{ kind: 'pageBreak' } as const] : []),
    { kind: 'heading', text: `${c.t('Package')} ${i + 1} / ${labels.length} · ${s.ref} · ${d.project.code}` },
    { kind: 'fields', columns: 2, items: [
      [c.t('Consignee'), consigneeText(d, c)], [c.t('Destination'), typed(c, s.destination)],
      [c.t('Truck / container'), `#${l.number}${l.identifier ? ` · ${typed(c, l.identifier)}` : ''}`],
      [c.t('Content'), `${it.partRef ? `${it.partRef} · ` : ''}${typed(c, it.description)} · ${numText(c, it.quantity / n)}`],
      [c.t('Gross weight'), it.grossKg == null ? '—' : kgText(c, Math.round((it.grossKg / n) * 1000) / 1000)],
      [c.t('Dimensions'), it.lengthCm != null && it.widthCm != null && it.heightCm != null ? `${numText(c, it.lengthCm)} × ${numText(c, it.widthCm)} × ${numText(c, it.heightCm)} cm` : '—'],
      [c.t('Handling'), c.t('Handle with care · This side up · Keep dry')], [c.t('Origin'), it.originCountry ?? '—'],
    ] },
    { kind: 'spacer', height: 8 },
  ]);
  return {
    ...header(d, c, c.t('Package marking labels')),
    blocks: blocks.length ? blocks : [{ kind: 'paragraph', text: c.t('No load declared yet') }],
    footnote: genericFootnote(c),
  };
};
