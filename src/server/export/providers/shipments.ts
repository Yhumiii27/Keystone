// Export provider — Shipments (R-158 lot A): the project's shipments (facts, the contract's Incoterm), their transport steps,
// the content of their loads, the packing control and the per-HS-code customs summary. Typed text as typed (dataText). The
// customs values follow the screen (`canSeeShipmentValues`: NEW-D2-1 roles and Logistics): the € columns are left out for the
// other viewers. Lot B adds the shipping documents (packing list, CMR…) as PDF variants deposited in Codex.
import { INCOTERM_STEP_LABEL } from '@/domain/incoterms';
import { canSeeShipmentValues } from '@/domain/rights';
import { CATEGORY_LABEL, GAP_LABEL, LOAD_TYPE_LABEL, SHIPMENT_MODE_LABEL, SHIPMENT_STATUS_LABEL, shipmentSteps } from '@/domain/shipments';
import { dataText } from '@/i18n/data-text';
import { getProjectShipments } from '@/server/dal/shipments';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, sheet, stripPriceColumns, todayIso } from './common';

async function shipmentsWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getProjectShipments(ctx.project.code);
  if (!data) return null;
  const { t, lang } = ctx;
  const dt = (s: string | null | undefined) => (s ? dataText(s, lang) : '');
  const inc = data.incoterm;
  const eqRef = (ids: { ref: string }[]) => ids.map((e) => e.ref).join(', ');
  const sheets = [
    sheet(t('Shipments'), [
      col('ref', t('Shipment'), 'text', 10), col('label', t('Title'), 'text', 30), col('status', t('Status'), 'text', 12), col('equipment', t('Equipment'), 'text', 14),
      col('incoterm', t('Incoterm'), 'text', 30), col('mode', t('Mode'), 'text', 10), col('forwarder', t('Forwarder'), 'text', 24), col('origin', t('Origin'), 'text', 24),
      col('destination', t('Destination'), 'text', 24), col('etd', 'ETD', 'date'), col('eta', 'ETA', 'date'), col('atd', t('Actual departure'), 'date'),
      col('ata', t('Actual arrival'), 'date'), col('loads', t('Loads'), 'integer'), col('validated', t('Packing list validated'), 'datetime'),
      col('cleared', t('Packing control cleared'), 'boolean'), col('value', t('Customs value'), 'money_eur'),
    ], data.shipments.map((s) => ({
      ref: s.ref, label: dt(s.label), status: t(SHIPMENT_STATUS_LABEL[s.status]), equipment: eqRef(s.equipment),
      incoterm: inc ? `${inc.code}${data.incotermPlace ? ` ${dataText(data.incotermPlace, lang)}` : ''}` : '', mode: s.mode ? t(SHIPMENT_MODE_LABEL[s.mode]) : '',
      forwarder: dt(s.forwarder), origin: dt(s.origin), destination: dt(s.destination), etd: s.etd, eta: s.eta, atd: s.atd, ata: s.ata, loads: s.loads.length,
      validated: s.packingValidatedAt, cleared: s.control.cleared, value: s.control.totals.valueEur,
    }))),
    sheet(t('Transport steps'), [
      col('ref', t('Shipment'), 'text', 10), col('step', t('Step'), 'text', 28), col('party', t('Party'), 'text', 14), col('planned', t('Planned'), 'date'),
      col('actual', t('Done on'), 'date'), col('note', t('Note'), 'text', 30),
    ], data.shipments.flatMap((s) => shipmentSteps(inc?.split ?? null, s.steps, todayIso(ctx)).map((st) => ({
      ref: s.ref, step: t(INCOTERM_STEP_LABEL[st.step]), party: st.tracked ? t('EPC2i (seller)') : t('Buyer'), planned: st.plannedOn, actual: st.actualOn, note: dt(st.note),
    })))),
    sheet(t('Loads and content'), [
      col('ref', t('Shipment'), 'text', 10), col('load', t('Load number'), 'integer'), col('type', t('Load type'), 'text', 16), col('identifier', t('Container number or plate'), 'text', 18),
      col('article', t('Article'), 'text', 16), col('description', t('Description'), 'text', 34), col('hs', t('HS code'), 'text', 10), col('quantity', t('Quantity'), 'number'),
      col('packages', t('Packages'), 'integer'), col('dims', t('Dimensions'), 'text', 16), col('net', t('Net weight (kg)'), 'number'), col('gross', t('Gross weight (kg)'), 'number'),
      col('origin', t('Origin'), 'text', 8), col('value', t('Customs value'), 'money_eur'),
    ], data.shipments.flatMap((s) => s.loads.flatMap((l) => l.items.map((it) => ({
      ref: s.ref, load: l.number, type: t(LOAD_TYPE_LABEL[l.type]), identifier: dt(l.identifier), article: it.partRef ?? t('Free item'), description: dataText(it.description, lang),
      hs: it.hsCode ?? '', quantity: it.quantity, packages: it.packages,
      dims: it.lengthCm != null && it.widthCm != null && it.heightCm != null ? `${it.lengthCm} × ${it.widthCm} × ${it.heightCm} cm` : '',
      net: it.netKg, gross: it.grossKg, origin: it.originCountry ?? '', value: it.unitValueEur == null ? null : it.unitValueEur * it.quantity,
    }))))),
    sheet(t('Packing control against the BOM'), [
      col('ref', t('Shipment'), 'text', 10), col('article', t('Article'), 'text', 40), col('category', t('BOM'), 'text', 24), col('expected', t('Expected'), 'number'),
      col('packed', t('Packed'), 'number'), col('gap', t('Gap'), 'text', 16), col('delta', t('Difference'), 'number'), col('reason', t('Reason'), 'text', 40),
    ], data.shipments.flatMap((s) => s.control.lines.map((l) => ({
      ref: s.ref, article: l.partRef ? `${l.partRef} · ${dataText(l.name, lang)}` : dataText(l.name, lang), category: t(CATEGORY_LABEL[l.category]), expected: l.expected,
      packed: l.packed, gap: l.gap ? t(GAP_LABEL[l.gap]) : '', delta: l.gap ? l.delta : null, reason: l.justification ? dataText(l.justification.reason, lang) : '',
    })))),
    sheet(t('Customs summary by HS code'), [
      col('ref', t('Shipment'), 'text', 10), col('hs', t('HS code'), 'text', 10), col('lines', t('Lines'), 'integer'), col('quantity', t('Quantity'), 'number'),
      col('value', t('Customs value'), 'money_eur'), col('net', t('Net weight (kg)'), 'number'), col('gross', t('Gross weight (kg)'), 'number'), col('origins', t('Origin'), 'text', 12),
      col('restricted', t('Export restriction'), 'boolean'),
    ], data.shipments.flatMap((s) => s.control.hsSummary.map((h) => ({
      ref: s.ref, hs: h.hsCode || t('No HS code'), lines: h.lines, quantity: h.quantity, value: h.valueEur, net: h.netKg, gross: h.grossKg, origins: h.origins.join(', '), restricted: h.restricted,
    })))),
  ];
  return {
    title: t('Shipments'),
    filters: inc ? [`${t('Incoterm')}: ${inc.code}${data.incotermPlace ? ` ${dataText(data.incotermPlace, lang)}` : ''}`] : [],
    sheets: canSeeShipmentValues(ctx.viewer.role) ? sheets : sheets.map(stripPriceColumns),
  };
}

registerExportProvider({ screen: 'shipments', table: shipmentsWorkbook });
