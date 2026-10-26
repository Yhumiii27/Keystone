// R-158 lot B — building blocks shared by the shipping-document templates: the parties (EPC2i as shipper, the client's site as
// consignee), the transport facts, the content table of the loads, the per-HS-code groups and the masking of the customs values.
// Pure. Typed text (places, forwarders, descriptions) as typed (`dataText`); Keystone's words through t().
import { LOAD_TYPE_LABEL, SHIPMENT_MODE_LABEL } from '@/domain/shipments';
import { dataText } from '@/i18n/data-text';
import { intlLocale } from '@/i18n/translate';
import { formatDate } from '../format';
import { col, sheet, showsAmount, stripPriceColumns } from '../providers/common';
import type { CellValue, ExportSheet, PdfBlock, PdfDocument } from '../types';
import type { ShippingDocData, TemplateCtx } from './types';

/** The shipper: EPC2i (its legal identity and addresses come with the standard formats — notes § Lot B). */
export const SHIPPER = 'EPC2i';

export const typed = (c: TemplateCtx, s: string | null | undefined) => (s ? dataText(s, c.lang) : '—');
export const day = (c: TemplateCtx, iso: string | null | undefined) => (iso ? formatDate(iso, c.lang) : '—');
export const numText = (c: TemplateCtx, n: number | null | undefined, digits = 3) =>
  n == null ? '—' : new Intl.NumberFormat(intlLocale(c.lang), { maximumFractionDigits: digits }).format(n);
export const kgText = (c: TemplateCtx, n: number | null | undefined) => (n == null || n === 0 ? '—' : `${numText(c, n)} kg`);
export const eurText = (c: TemplateCtx, n: number) =>
  new Intl.NumberFormat(intlLocale(c.lang), { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

/** "#2 · Container 40′ HC · TCLU 905514-8" */
export const loadLabel = (c: TemplateCtx, l: ShippingDocData['shipment']['loads'][number]) =>
  [`#${l.number}`, c.t(LOAD_TYPE_LABEL[l.type]), l.identifier ? dataText(l.identifier, c.lang) : null].filter(Boolean).join(' · ');

/** Consignee: the client, its site (site sheet), the destination typed on the shipment. */
export const consigneeText = (d: ShippingDocData, c: TemplateCtx) =>
  [d.project.client ? dataText(d.project.client, c.lang) : null, d.site ? `${dataText(d.site.name, c.lang)} (${dataText(d.site.country, c.lang)})` : null].filter(Boolean).join(' · ') || '—';

export const incotermText = (d: ShippingDocData, c: TemplateCtx) =>
  d.incoterm ? `${d.incoterm.code}${d.incoterm.place ? ` ${dataText(d.incoterm.place, c.lang)}` : ''} (Incoterms® 2020)` : c.t('Not set');

/** Parties of the shipment. */
export function partyFields(d: ShippingDocData, c: TemplateCtx): [string, string][] {
  const s = d.shipment;
  return [
    [c.t('Shipper'), `${SHIPPER} · ${typed(c, s.origin)}`],
    [c.t('Consignee'), consigneeText(d, c)],
    [c.t('Place of delivery'), typed(c, s.destination)],
    [c.t('Contact on site'), d.site ? typed(c, d.site.contact) : '—'],
  ];
}

/** Transport facts. */
export function transportFields(d: ShippingDocData, c: TemplateCtx): [string, string][] {
  const s = d.shipment;
  return [
    [c.t('Mode'), s.mode ? c.t(SHIPMENT_MODE_LABEL[s.mode]) : '—'],
    [c.t('Forwarder'), typed(c, s.forwarder)],
    [c.t('Incoterm'), incotermText(d, c)],
    [c.t('Equipment'), d.equipment.join(', ') || '—'],
    ['ETD · ETA', `${day(c, s.etd)} · ${day(c, s.eta)}`],
    [c.t('Loads'), String(s.loads.length)],
  ];
}

export interface ContentRow {
  load: string;
  article: string;
  description: string;
  hs: string;
  quantity: number;
  packages: number | null;
  dims: string;
  volume: number | null;
  net: number | null;
  gross: number | null;
  origin: string;
  value: number | null;
  restricted: string | null;
}

/** m³ of a content line's packages (L × W × H × packages). */
const volumeOf = (it: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; packages: number | null }) =>
  it.lengthCm != null && it.widthCm != null && it.heightCm != null ? Math.round((it.lengthCm * it.widthCm * it.heightCm * (it.packages ?? 1)) / 1e3) / 1e3 : null;

/** Every content line of the shipment (or of one load), with its load. */
export function contentRows(d: ShippingDocData, c: TemplateCtx, loadNumber?: number): ContentRow[] {
  return d.shipment.loads.filter((l) => loadNumber == null || l.number === loadNumber).flatMap((l) => l.items.map((it) => ({
    load: `#${l.number}`, article: it.partRef ?? c.t('Free item'), description: dataText(it.description, c.lang), hs: it.hsCode ?? '', quantity: it.quantity,
    packages: it.packages,
    dims: it.lengthCm != null && it.widthCm != null && it.heightCm != null ? `${numText(c, it.lengthCm)} × ${numText(c, it.widthCm)} × ${numText(c, it.heightCm)} cm` : '',
    volume: volumeOf(it), net: it.netKg, gross: it.grossKg, origin: it.originCountry ?? '',
    value: it.unitValueEur == null ? null : Math.round(it.unitValueEur * it.quantity * 100) / 100, restricted: it.exportRestriction ? c.t(it.exportRestriction) : null,
  })));
}

/** The content table; `keys` picks the columns (values only when shown). */
export function contentSheet(c: TemplateCtx, rows: ContentRow[], keys: (keyof ContentRow)[]): ExportSheet {
  const all = {
    load: col('load', c.t('Truck / container'), 'text', 6), article: col('article', c.t('Article'), 'text', 14), description: col('description', c.t('Description'), 'text', 34),
    hs: col('hs', c.t('HS code'), 'text', 10), quantity: col('quantity', c.t('Quantity'), 'number', 8), packages: col('packages', c.t('Packages'), 'integer', 8),
    dims: col('dims', c.t('Dimensions'), 'text', 16), volume: col('volume', 'm³', 'number', 7, { decimals: 3 }), net: col('net', c.t('Net weight (kg)'), 'number', 9),
    gross: col('gross', c.t('Gross weight (kg)'), 'number', 9), origin: col('origin', c.t('Origin'), 'text', 6), value: col('value', c.t('Customs value'), 'money_eur', 11),
    restricted: col('restricted', c.t('Export restriction'), 'text', 18),
  } as const;
  return sheet(c.t('Content'), keys.map((k) => all[k]), rows.map((r) => r as unknown as Record<string, CellValue>));
}

const total = (rows: ContentRow[], k: 'quantity' | 'packages' | 'net' | 'gross' | 'value' | 'volume') =>
  Math.round(rows.reduce((a, r) => a + ((r[k] as number | null) ?? 0), 0) * 1000) / 1000;
/** The totals row of a content table. */
export const contentTotals = (c: TemplateCtx, rows: ContentRow[]): Record<string, CellValue> => ({
  description: c.t('Total'), quantity: total(rows, 'quantity'), packages: total(rows, 'packages'), net: total(rows, 'net'), gross: total(rows, 'gross'),
  value: total(rows, 'value'), volume: total(rows, 'volume'),
});

export interface HsGroup {
  hs: string;
  description: string;
  quantity: number;
  packages: number;
  net: number;
  gross: number;
  value: number;
  origins: string;
  restricted: boolean;
}

/** The content grouped by HS code (the customs documents' lines): the descriptions, quantities, weights, value and origins. */
export function hsGroups(d: ShippingDocData, c: TemplateCtx): HsGroup[] {
  const rows = contentRows(d, c);
  const by = new Map<string, ContentRow[]>();
  for (const r of rows) by.set(r.hs, [...(by.get(r.hs) ?? []), r]);
  return [...by.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0)).map(([hs, rs]) => ({
    hs: hs || c.t('No HS code'), description: [...new Set(rs.map((r) => r.description))].join(' · '), quantity: total(rs, 'quantity'), packages: total(rs, 'packages'),
    net: total(rs, 'net'), gross: total(rs, 'gross'), value: total(rs, 'value'), origins: [...new Set(rs.map((r) => r.origin).filter(Boolean))].sort().join(', '),
    restricted: rs.some((r) => !!r.restricted),
  }));
}

export function hsSheet(c: TemplateCtx, groups: HsGroup[], withValue: boolean): ExportSheet {
  return sheet(c.t('Customs summary by HS code'), [
    col('hs', c.t('HS code'), 'text', 10), col('description', c.t('Description of goods'), 'text', 38), col('quantity', c.t('Quantity'), 'number', 8),
    col('packages', c.t('Packages'), 'integer', 8), col('net', c.t('Net weight (kg)'), 'number', 9), col('gross', c.t('Gross weight (kg)'), 'number', 9),
    col('origins', c.t('Origin'), 'text', 7), ...(withValue ? [col('value', c.t('Customs value'), 'money_eur', 11)] : []),
  ], groups.map((g) => ({ ...g, description: g.restricted ? `${g.description} (!)` : g.description })));
}

export const hsTotals = (c: TemplateCtx, groups: HsGroup[]): Record<string, CellValue> => ({
  description: c.t('Total'), quantity: groups.reduce((a, g) => a + g.quantity, 0), packages: groups.reduce((a, g) => a + g.packages, 0),
  net: Math.round(groups.reduce((a, g) => a + g.net, 0) * 1000) / 1000, gross: Math.round(groups.reduce((a, g) => a + g.gross, 0) * 1000) / 1000,
  value: Math.round(groups.reduce((a, g) => a + g.value, 0) * 100) / 100,
});

/** Export-restriction alert lines of the content (none: nothing). */
export function restrictionBlocks(d: ShippingDocData, c: TemplateCtx): PdfBlock[] {
  const r = d.shipment.control.restricted;
  return r.length ? [{ kind: 'paragraph', text: `${c.t('Export restriction')} · ${r.map((x) => `${dataText(x.label, c.lang)} — ${c.t(x.restriction)}`).join(' · ')}` }] : [];
}

/** The common footnote: a generic layout until EPC2i's standard format. */
export const genericFootnote = (c: TemplateCtx, extra?: string) =>
  [extra, c.t('Generic layout generated by Keystone from the shipment’s data — to be replaced by EPC2i’s standard format.')].filter(Boolean).join(' ');

/** The common header of a shipping document. */
export const header = (d: ShippingDocData, c: TemplateCtx, title: string) => ({
  title: `${title} ${d.shipment.ref}`,
  subtitle: [d.shipment.label ? dataText(d.shipment.label, c.lang) : null, d.equipment.join(', ')].filter(Boolean).join(' · ') || undefined,
  project: { code: d.project.code, name: dataText(d.project.name, c.lang) },
  reference: d.shipment.ref,
  date: c.today,
});

/** A document without its customs values (a viewer who may not see them): € columns and totals left out, amounts masked. */
export function withoutValues(doc: PdfDocument): PdfDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b): PdfBlock => {
      if (b.kind === 'table') {
        const stripped = stripPriceColumns(b.sheet);
        const keys = new Set(stripped.columns.map((k) => k.key));
        return { kind: 'table', sheet: stripped, ...(b.totals ? { totals: Object.fromEntries(Object.entries(b.totals).filter(([k]) => keys.has(k))) } : {}) };
      }
      if (b.kind === 'fields') return { ...b, items: b.items.map(([k, v]): [string, string] => [k, showsAmount(v) ? '•••' : v]) };
      return b;
    }),
  };
}
