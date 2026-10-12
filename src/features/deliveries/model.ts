// View model of the Deliveries & goods receipt screen (docs/spec/08 §3, template 1598–1657, logic 4447–4467): the
// domain rows / drawer / KPIs (src/domain/deliveries.ts) rendered in the viewer's language, the screen's URLs
// (`?status=` chip, `?receipt=` drawer; BOM and Orders cross-links through those screens' URL helpers) and the two
// forms (Announce a delivery, Register receipt) as FormDialog definitions already translated (their labels mix UI
// text and data).
import type { FormDef } from '@/components/app/form-def';
import { LO, OK } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  deliveryChips, deliveryKpis, filterReceipts, qtyFieldId, receiptDrawerView, receiptRowView, type DrawerKv, type ReceiptLike, type ReceiptTone,
} from '@/domain/deliveries';
import { bomHref } from '@/features/bom/links';
import { ordersHref } from '@/features/orders/links';
import type { Lang, T } from '@/i18n/translate';
import { STATUS_ISO, displayOfIso, fmtDOfIso, type ReceiptStatus } from '@/server/db/codes';
import { vigieReportNcrUrl } from '@/server/integrations/vigie/links';
import { DECLARE_NCR_LINK, dataText, qcResultText, statusText } from './i18n';

// ── URLs ───────────────────────────────────────────────────────────────────────────────────────────────

export interface DeliveriesQuery {
  status?: ReceiptStatus | null;
  receipt?: string | null;
}

/** `/projects/{code}/deliveries?status=…&receipt=…` (status chip, then the open drawer). */
export function deliveriesHref(code: string, q: DeliveriesQuery = {}): string {
  const qs = new URLSearchParams();
  if (q.status) qs.set('status', q.status);
  if (q.receipt) qs.set('receipt', q.receipt);
  const s = qs.toString();
  return screenHref('deliveries', { code }) + (s ? '?' + s : '');
}

/** Drawer line → Project BOM, flat list, part record of the article (`{screen:'bom', part, bomView:'flat'}`; the BOM's own URL helper). */
export const bomPartHref = (code: string, ref: string) => bomHref(code, { view: 'flat', part: ref });
/** "Open purchase order" → Purchase orders with the order's drawer (`{screen:'orders', po}`; the Orders URL helper). */
export const orderHref = (code: string, po: string) => ordersHref(code, { po });

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────────────

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: string;
  label: string;
  count: string;
  href: string;
}

export interface RowView {
  id: string;
  href: string;
  selected: boolean;
  /** "{date} · {note}". */
  sub: string;
  po: string;
  supplier: string;
  lines: string;
  qty: string;
  acc: string;
  rej: string;
  rejColor: string;
  qc: string;
  loc: string;
  status: string;
  tone: ReceiptTone;
  canReceive: boolean;
  canQc: boolean;
}

export interface KvView {
  k: string;
  v: string;
  color: string;
}

export interface DrawerLineRow {
  ref: string;
  name: string;
  o: string;
  d: string;
  a: string;
  r: string;
  rColor: string;
  loc: string;
  href: string;
}

export interface DrawerView {
  id: string;
  /** "{id} · {po}". */
  head: string;
  po: string;
  supplier: string;
  status: string;
  tone: ReceiptTone;
  lines: DrawerLineRow[];
  meta: KvView[];
  qc: KvView[];
  docs: string[];
  canReceive: boolean;
  canQc: boolean;
  closeHref: string;
  poHref: string;
  /** Lines of the QC decision (partial rejection dialog). */
  qcLines: { ref: string; name: string; delivered: number }[];
  /**
   * R-096 (NEW-D4-3 "a", SC-3b "a"): "Declare the supplier NCR in Vigie", one link per line with rejected units of a
   * Rejected or Partially rejected receipt, Vigie's report form prefilled (V-3 proposal). Internal viewers only; nothing
   * is recorded in Keystone.
   */
  ncrLinks: { href: string; label: string }[];
}

export interface DeliveriesView {
  kpis: KpiView[];
  chips: ChipView[];
  /** Active chip value ('all' = All). */
  chip: string;
  rows: RowView[];
  /** "No delivery in this status". */
  empty: boolean;
  drawer: DrawerView | null;
}

const kvText = (x: DrawerKv, t: T, lang: Lang) => {
  if (x.kind === 'id') return x.v;
  if (x.kind === 'ui' || x.kind === 'date') return t(x.v);
  return x.k === 'Result' ? qcResultText(x.v, lang) : dataText(x.v, lang);
};

/**
 * KPI tiles, chips, rows (filtered by `?status=`) and the drawer of `?receipt=` (null when unknown). Every string is
 * rendered for `lang`; data text (notes, carriers, remarks, names, locations) on an exact dictionary match only.
 */
export function deliveriesView(
  code: string,
  data: { receipts: readonly (ReceiptLike & { supplierCode?: string | null })[]; openOrdersToReceive: number; onTimePct?: number | null },
  q: { status: ReceiptStatus | null; receipt: string | null },
  t: T,
  lang: Lang,
  opts: { vigieLinks?: boolean } = {},
): DeliveriesView {
  const { receipts } = data;
  const open = q.receipt ? (receipts.find((r) => r.number === q.receipt) ?? null) : null;
  const rows = filterReceipts(receipts, q.status).map((r) => {
    const v = receiptRowView(r, lang);
    const selected = v.id === open?.number;
    return {
      id: v.id, href: deliveriesHref(code, { status: q.status, receipt: selected ? null : v.id }), selected,
      sub: `${t(v.date)} · ${dataText(v.note, lang)}`, po: v.po, supplier: dataText(v.supplier, lang), lines: v.lines, qty: v.qty, acc: v.acc,
      rej: v.rej, rejColor: v.rejLo ? LO : 'var(--color-neutral-400)', qc: qcResultText(v.qc, lang), loc: dataText(v.loc, lang),
      status: statusText(v.status, t, lang), tone: v.tone, canReceive: v.canReceive, canQc: v.canQc,
    };
  });
  let drawer: DrawerView | null = null;
  if (open) {
    const d = receiptDrawerView(open, lang);
    drawer = {
      id: d.id, head: `${d.id} · ${d.po}`, po: d.po, supplier: dataText(d.supplier, lang), status: statusText(d.status, t, lang), tone: d.tone,
      lines: d.lines.map((l) => ({
        ref: l.ref, name: dataText(l.name, lang), o: l.o, d: l.d, a: l.a, r: l.r, rColor: l.rLo ? LO : 'var(--color-neutral-500)', loc: dataText(l.loc, lang),
        href: bomPartHref(code, l.ref),
      })),
      meta: d.meta.map((x) => ({ k: t(x.k), v: kvText(x, t, lang), color: x.lo ? LO : OK })),
      qc: d.qc.map((x) => ({ k: t(x.k), v: kvText(x, t, lang), color: x.lo ? LO : OK })),
      docs: d.docs.map((x) => dataText(x, lang)), canReceive: d.canReceive, canQc: d.canQc,
      closeHref: deliveriesHref(code, { status: q.status }), poHref: orderHref(code, d.po),
      qcLines: open.lines.map((l) => ({ ref: l.ref, name: dataText(l.name, lang), delivered: l.delivered })),
      ncrLinks: opts.vigieLinks ? supplierNcrLinks(code, open, t, lang) : [],
    };
  }
  return {
    kpis: deliveryKpis(receipts, data.openOrdersToReceive, lang, data.onTimePct ?? null).map((k) => ({ label: t(k.label), value: k.value, sub: t(k.sub), color: k.lo ? LO : OK })),
    chips: deliveryChips(receipts).map((c) => ({
      value: c.value ?? 'all', label: c.value ? statusText(c.value, t, lang) : t(c.label), count: String(c.count), href: deliveriesHref(code, { status: c.value, receipt: open?.number }),
    })),
    chip: q.status ?? 'all',
    rows,
    empty: !rows.length,
    drawer,
  };
}

/**
 * R-096: the supplier NCR links of a rejected receipt — one per line with rejected units, labelled "· <ref> × <qty>"
 * when several. The title prefilled in Vigie is data (receipt, part, article name), not UI text.
 */
export function supplierNcrLinks(
  code: string, r: ReceiptLike & { supplierCode?: string | null }, t: T, lang: Lang,
): { href: string; label: string }[] {
  if (r.status !== 'rejected' && r.status !== 'partially_rejected') return [];
  const lines = r.lines.filter((l) => l.rejected > 0);
  const qty = (n: number) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
  return lines.map((l) => ({
    href: vigieReportNcrUrl({
      projectCode: code, partRef: l.ref, title: `${r.number} · ${l.ref} · ${l.name}`, supplier: r.supplier, supplierCode: r.supplierCode ?? null,
      order: r.poNumber, receipt: r.number, quantity: l.rejected,
    }),
    label: lines.length > 1 ? `${t(DECLARE_NCR_LINK)} · ${l.ref} × ${qty(l.rejected)}` : t(DECLARE_NCR_LINK),
  }));
}

// ── Forms ──────────────────────────────────────────────────────────────────────────────────────────────

export interface AnnounceOrderLike {
  number: string;
  supplier: string;
  expectedOn: string | null;
  lines: { ref: string; qty: number }[];
}

/** "Announce a delivery" (SC-4): order still expecting goods · expected on (blank = the order's date) · carrier · put-away. */
export function announceFormDef(orders: readonly AnnounceOrderLike[], putAway: { locations: readonly string[]; defaultLocation: string }, t: T, lang: Lang): FormDef {
  return {
    title: t('Announce a delivery'),
    submit: t('Announce'),
    kind: 'create',
    fields: [
      {
        id: 'po', label: t('Purchase order'), type: 'select', span: 'full',
        options: orders.map((o) => ({
          value: o.number,
          label: `${o.number} · ${dataText(o.supplier, lang)} · ${o.lines.map((l) => `${l.ref} × ${l.qty.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}`).join(', ')}${o.expectedOn ? ` · ${t(fmtDOfIso(o.expectedOn))}` : ''}`,
        })),
      },
      { id: 'expected', label: t('Expected on'), type: 'text', placeholder: t('Expected date of the order') },
      { id: 'carrier', label: t('Carrier'), type: 'text' },
      { id: 'location', label: t('Put-away'), type: 'select', defaultValue: putAway.defaultLocation, options: putAway.locations.map((l) => ({ value: l, label: dataText(l, lang) })), span: 'full' },
    ],
  };
}

export interface RegisterReceiptLike {
  number: string;
  supplier: string;
  carrier: string | null;
  supplierDeliveryNote: string | null;
  lines: { ref: string; name: string; ordered: number }[];
}

/** "Register receipt": delivered on (the status date) · carrier · supplier delivery note · delivered quantity per article. */
export function registerFormDef(r: RegisterReceiptLike, t: T, lang: Lang): { def: FormDef; context: string } {
  return {
    context: `${r.number} · ${dataText(r.supplier, lang)}`,
    def: {
      title: t('Register receipt'),
      submit: t('Register receipt'),
      kind: 'create',
      fields: [
        { id: 'date', label: t('Delivered on'), type: 'text', required: true, defaultValue: t(displayOfIso(STATUS_ISO)) },
        { id: 'carrier', label: t('Carrier'), type: 'text', defaultValue: r.carrier ?? '' },
        { id: 'note', label: t('Supplier delivery note'), type: 'text', defaultValue: r.supplierDeliveryNote ?? '', span: 'full' },
        ...r.lines.map((l) => ({ id: qtyFieldId(l.ref), label: `${l.ref} · ${dataText(l.name, lang)}`, type: 'number' as const, required: true, defaultValue: String(l.ordered), span: 'full' as const })),
      ],
    },
  };
}
