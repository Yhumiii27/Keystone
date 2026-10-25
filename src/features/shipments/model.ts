// R-158 lot A — view model of the Shipments screen (docs/delivery-9/notes-r158-shipments.md § 6): the contract's Incoterm and
// its split, and per shipment its facts, transport steps, loads with their content, the packing control and the per-HS-code
// summary, plus the translated form definitions of the screen's dialogs. Pure apart from the translator: typed text (labels,
// forwarders, places, descriptions, reasons) is shown as typed (`dataText`), Keystone's vocabulary through t().
import type { FormDef, FormValues } from '@/components/app/form-def';
import {
  INCOTERM_MODES_LABEL, INCOTERM_STEP_LABEL, incotermText, type IncotermStep,
} from '@/domain/incoterms';
import {
  ADVANCE_LABEL, CATEGORY_LABEL, GAP_LABEL, LOAD_TYPES, LOAD_TYPE_LABEL, SHIPMENT_MODES, SHIPMENT_MODE_LABEL, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE,
  contentEditable, incotermModeMismatch, nextShipmentStatus, packingBlocker, shipmentSteps, type ShipmentStatus,
} from '@/domain/shipments';
import { PRICE_MASK } from '@/domain/rights';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { moneyEur } from '@/lib/format';
import { displayOfIso } from '@/server/db/codes';
import type { ProjectShipments, ShipmentRow } from '@/server/dal/shipments';

export interface StepRowView {
  step: IncotermStep;
  label: string;
  party: string;
  tracked: boolean;
  planned: string;
  actual: string;
  note: string;
  state: 'done' | 'late' | 'planned' | 'todo' | 'buyer';
  stateLabel: string;
  form: FormValues;
}

export interface ItemRowView {
  id: string;
  article: string;
  description: string;
  hs: string;
  quantity: string;
  packages: string;
  dims: string;
  net: string;
  gross: string;
  origin: string;
  value: string;
  restricted: string | null;
  form: FormValues;
}

export interface LoadView {
  number: number;
  title: string;
  sub: string;
  items: ItemRowView[];
  form: FormValues;
}

export interface ControlRowView {
  key: string;
  article: string;
  category: string;
  expected: string;
  packed: string;
  gap: string | null;
  gapLabel: string;
  justification: string | null;
  open: boolean;
}

export interface ShipmentView {
  ref: string;
  title: string;
  status: ShipmentStatus;
  statusLabel: string;
  tone: 'accent' | 'outline' | 'neutral';
  equipment: string;
  facts: { k: string; v: string }[];
  modeWarning: string | null;
  steps: StepRowView[];
  loads: LoadView[];
  control: {
    summary: string;
    cleared: boolean;
    rows: ControlRowView[];
    missingHs: string[];
    restricted: string[];
    hs: { code: string; lines: string; quantity: string; value: string; net: string; gross: string; origins: string; restricted: boolean }[];
    totals: { lines: string; quantity: string; value: string; net: string; gross: string };
  };
  editableContent: boolean;
  canRemove: boolean;
  canValidate: boolean;
  validateBlocker: string | null;
  canReopen: boolean;
  advance: { from: ShipmentStatus; label: string } | null;
  form: FormValues;
}

export interface ShipmentsScreenView {
  kpis: { label: string; value: string; sub: string }[];
  incoterm: {
    state: 'none' | 'unset' | 'set';
    code: string;
    name: string;
    place: string;
    description: string;
    modes: string;
    split: { label: string; party: string; seller: boolean }[];
  };
  shipments: ShipmentView[];
  hasEquipment: boolean;
}

const dash = '—';

/** `values` false: the customs values are masked (`canSeeShipmentValues`: NEW-D2-1 roles and Logistics). */
export function shipmentsView(data: ProjectShipments, today: string, t: T, lang: Lang, values = true): ShipmentsScreenView {
  const eur = (v: number) => (values ? moneyEur(v, lang) : PRICE_MASK);
  const nf = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 3 });
  const n = (v: number | null | undefined) => (v == null ? dash : nf.format(v));
  const kg = (v: number | null | undefined) => (v == null || v === 0 ? dash : `${nf.format(v)} kg`);
  const date = (iso: string | null) => (iso ? t(displayOfIso(iso)) : dash);
  const dt = (s: string | null | undefined) => (s ? dataText(s, lang) : dash);
  const inc = data.incoterm;
  const split = inc ? inc.split : null;
  const eqLabel = (id: string) => {
    const e = data.equipment.find((x) => x.id === id);
    return e ? `${e.ref} · ${e.quantity > 1 ? `${e.quantity} × ` : ''}${e.machineTypeCode}` : dash;
  };

  const shipments = data.shipments.map((s): ShipmentView => shipmentView(s));
  function shipmentView(s: ShipmentRow): ShipmentView {
    const c = s.control;
    const steps = shipmentSteps(split, s.steps, today).map((st): StepRowView => ({
      step: st.step, label: t(INCOTERM_STEP_LABEL[st.step]), party: st.tracked ? t('EPC2i (seller)') : t('Buyer'), tracked: st.tracked,
      planned: date(st.plannedOn), actual: date(st.actualOn), note: dt(st.note), state: st.state,
      stateLabel: t({ done: 'Done', late: 'Late', planned: 'Planned', todo: 'To plan', buyer: 'Buyer’s step' }[st.state]),
      form: { plannedOn: st.plannedOn ?? '', actualOn: st.actualOn ?? '', note: st.note ?? '' },
    }));
    const loads = s.loads.map((l): LoadView => ({
      number: l.number,
      title: `#${l.number} · ${t(LOAD_TYPE_LABEL[l.type])}${l.identifier ? ` · ${dataText(l.identifier, lang)}` : ''}`,
      sub: [l.seal ? `${t('Seal')} ${dataText(l.seal, lang)}` : null, l.grossKg != null ? `${t('Gross')} ${kg(l.grossKg)}` : null, l.note ? dataText(l.note, lang) : null]
        .filter(Boolean).join(' · '),
      form: { type: l.type, identifier: l.identifier ?? '', seal: l.seal ?? '', grossKg: l.grossKg == null ? '' : String(l.grossKg), note: l.note ?? '' },
      items: l.items.map((it) => ({
        id: it.id, article: it.partRef ?? t('Free item'), description: dataText(it.description, lang), hs: it.hsCode ?? dash, quantity: n(it.quantity),
        packages: n(it.packages),
        dims: it.lengthCm != null && it.widthCm != null && it.heightCm != null ? `${n(it.lengthCm)} × ${n(it.widthCm)} × ${n(it.heightCm)} cm` : dash,
        net: kg(it.netKg), gross: kg(it.grossKg), origin: it.originCountry ?? dash,
        value: it.unitValueEur == null ? dash : eur(it.unitValueEur * it.quantity), restricted: it.exportRestriction ? t(it.exportRestriction) : null,
        form: {
          load: String(l.number), part: it.partRef ?? '', description: it.free ? it.description : '', hsCode: it.free ? (it.hsCode ?? '') : '',
          unitValueEur: it.free && it.unitValueEur != null && values ? String(it.unitValueEur) : '', quantity: String(it.quantity), packages: it.packages == null ? '' : String(it.packages),
          lengthCm: it.lengthCm == null ? '' : String(it.lengthCm), widthCm: it.widthCm == null ? '' : String(it.widthCm), heightCm: it.heightCm == null ? '' : String(it.heightCm),
          netKg: it.netKg == null ? '' : String(it.netKg), grossKg: it.grossKg == null ? '' : String(it.grossKg), originCountry: it.originCountry ?? '',
        },
      })),
    }));
    const blocker = packingBlocker(c);
    const next = nextShipmentStatus(s.status);
    const summary = c.empty
      ? t('Nothing is packed yet')
      : c.cleared
        ? t('Packing control cleared')
        : [c.openGaps ? `${c.openGaps} ${t(c.openGaps > 1 ? 'gaps to justify' : 'gap to justify')}` : null, c.missingHs.length ? `${c.missingHs.length} ${t(c.missingHs.length > 1 ? 'items without HS code' : 'item without HS code')}` : null]
          .filter(Boolean).join(' · ');
    return {
      ref: s.ref,
      title: s.label ? `${s.ref} · ${dataText(s.label, lang)}` : s.ref,
      status: s.status, statusLabel: t(SHIPMENT_STATUS_LABEL[s.status]), tone: SHIPMENT_STATUS_TONE[s.status],
      equipment: s.equipment.map((e) => eqLabel(e.id)).join(', ') || dash,
      facts: [
        { k: t('Mode'), v: s.mode ? t(SHIPMENT_MODE_LABEL[s.mode]) : dash },
        { k: t('Forwarder'), v: dt(s.forwarder) },
        { k: t('Origin'), v: dt(s.origin) },
        { k: t('Destination'), v: dt(s.destination) },
        { k: t('ETD · ETA'), v: `${date(s.etd)} · ${date(s.eta)}` },
        { k: t('Actual departure · arrival'), v: `${date(s.atd)} · ${date(s.ata)}` },
        { k: t('Packing list'), v: s.packingValidatedAt ? `${t('Validated on')} ${date(s.packingValidatedAt.slice(0, 10))}${s.packingValidatedBy ? ` · ${dataText(s.packingValidatedBy, lang)}` : ''}` : t('To validate') },
        ...(s.note ? [{ k: t('Note'), v: dataText(s.note, lang) }] : []),
      ],
      modeWarning: inc && incotermModeMismatch(inc.modes, s.mode) ? `${inc.code} · ${t('applies to sea and inland waterway transport only')}` : null,
      steps, loads,
      control: {
        summary, cleared: c.cleared,
        rows: c.lines.map((l) => ({
          key: l.key, article: l.partRef ? `${l.partRef} · ${dataText(l.name, lang)}` : dataText(l.name, lang), category: t(CATEGORY_LABEL[l.category]),
          expected: l.expected == null ? dash : n(l.expected), packed: n(l.packed), gap: l.gap,
          gapLabel: l.gap ? `${t(GAP_LABEL[l.gap])}${l.gap === 'not_in_bom' ? '' : ` ${l.delta > 0 ? '+' : ''}${n(l.delta)}`}` : t('OK'),
          justification: l.justification ? dataText(l.justification.reason, lang) : null, open: !!l.gap && !l.justification,
        })),
        missingHs: c.missingHs.map((m) => `${m.loadLabel} · ${dataText(m.label, lang)}`),
        restricted: c.restricted.map((r) => `${dataText(r.label, lang)} · ${t(r.restriction)}`),
        hs: c.hsSummary.map((h) => ({
          code: h.hsCode || t('No HS code'), lines: n(h.lines), quantity: n(h.quantity), value: eur(h.valueEur), net: kg(h.netKg), gross: kg(h.grossKg),
          origins: h.origins.join(', ') || dash, restricted: h.restricted,
        })),
        totals: { lines: n(c.totals.lines), quantity: n(c.totals.quantity), value: eur(c.totals.valueEur), net: kg(c.totals.netKg), gross: kg(c.totals.grossKg) },
      },
      editableContent: contentEditable(s.status),
      canRemove: s.status === 'draft',
      canValidate: s.status === 'draft',
      validateBlocker: s.status === 'draft' && blocker ? t(blocker) : null,
      canReopen: s.status === 'prepared',
      advance: next ? { from: s.status, label: t(ADVANCE_LABEL[next] ?? 'Advance') } : null,
      form: {
        label: s.label ?? '', equipment: s.equipment.map((e) => e.ref).join(', '), mode: s.mode ?? '', forwarder: s.forwarder ?? '', origin: s.origin ?? '',
        destination: s.destination ?? '', etd: s.etd ?? '', eta: s.eta ?? '', atd: s.atd ?? '', ata: s.ata ?? '', note: s.note ?? '',
      },
    };
  }

  const all = data.shipments;
  const onTheWay = all.filter((s) => s.status === 'picked_up' || s.status === 'in_transit').length;
  const validated = all.filter((s) => !!s.packingValidatedAt).length;
  const nextEta = all.filter((s) => s.eta && s.status !== 'received' && s.status !== 'closed').map((s) => s.eta!).sort()[0] ?? null;
  return {
    kpis: [
      { label: t('Shipments'), value: String(all.length), sub: data.equipment.length ? `${data.equipment.length} ${t(data.equipment.length > 1 ? 'equipment lines' : 'equipment line')}` : t('No equipment line') },
      { label: t('Packing lists validated'), value: `${validated} / ${all.length}`, sub: t('Packing control against the BOM') },
      { label: t('On the way'), value: String(onTheWay), sub: t('Picked up or in transit') },
      { label: t('Next arrival'), value: date(nextEta), sub: t('ETA of the shipments under way') },
    ],
    incoterm: {
      state: !data.hasContract ? 'none' : inc ? 'set' : 'unset',
      code: inc?.code ?? '', name: inc ? incotermText(lang, inc.nameEn, inc.nameFr) : '', place: data.incotermPlace ? dataText(data.incotermPlace, lang) : '',
      description: inc ? incotermText(lang, inc.descriptionEn, inc.descriptionFr) : '', modes: inc ? t(INCOTERM_MODES_LABEL[inc.modes]) : '',
      split: split ? (Object.keys(INCOTERM_STEP_LABEL) as IncotermStep[]).map((k) => ({ label: t(INCOTERM_STEP_LABEL[k]), party: split[k] === 'seller' ? t('EPC2i (seller)') : t('Buyer'), seller: split[k] === 'seller' })) : [],
    },
    shipments,
    hasEquipment: data.equipment.length > 0,
  };
}

// ── Form definitions (translated) ───────────────────────────────────────────────────────────────────────────────────

/**
 * "New shipment" / "Edit shipment". The equipment choice lists each line and, with several lines, all of them together; an edited
 * shipment's own combination is offered too (values are comma lists of refs, parsed by `parseShipmentForm`).
 */
export function shipmentFormDef(t: T, equipment: { ref: string; machineTypeCode: string; quantity: number }[], edit: boolean, current: string[] = []): FormDef {
  const lineLabel = (e: { ref: string; machineTypeCode: string; quantity: number }) => `${e.ref} · ${e.quantity > 1 ? `${e.quantity} × ` : ''}${e.machineTypeCode}`;
  const options = equipment.map((e) => ({ value: e.ref, label: lineLabel(e) }));
  if (equipment.length > 1) options.push({ value: equipment.map((e) => e.ref).join(', '), label: `${t('All equipment lines')} (${equipment.map((e) => e.ref).join(', ')})` });
  const cur = current.join(', ');
  if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: cur });
  return {
    title: t(edit ? 'Edit shipment' : 'New shipment'),
    submit: t(edit ? 'Save' : 'Create shipment'),
    fields: [
      { id: 'label', label: t('Title'), type: 'text' },
      { id: 'equipment', label: t('Equipment line(s)'), type: 'select', required: true, options },
      { id: 'mode', label: t('Mode'), type: 'select', options: [{ value: '', label: '—' }, ...SHIPMENT_MODES.map((m) => ({ value: m, label: t(SHIPMENT_MODE_LABEL[m]) }))] },
      { id: 'forwarder', label: t('Forwarder (external)'), type: 'text' },
      { id: 'origin', label: t('Origin (port or place)'), type: 'text' },
      { id: 'destination', label: t('Destination (port or place)'), type: 'text' },
      { id: 'etd', label: t('ETD (YYYY-MM-DD)'), type: 'text' },
      { id: 'eta', label: t('ETA (YYYY-MM-DD)'), type: 'text' },
      ...(edit ? [
        { id: 'atd', label: t('Actual departure (YYYY-MM-DD)'), type: 'text' as const },
        { id: 'ata', label: t('Actual arrival (YYYY-MM-DD)'), type: 'text' as const },
      ] : []),
      { id: 'note', label: t('Note'), type: 'textarea' },
    ],
  };
}

export function loadFormDef(t: T, edit: boolean): FormDef {
  return {
    title: t(edit ? 'Edit load' : 'Add load'),
    submit: t(edit ? 'Save' : 'Add load'),
    fields: [
      { id: 'type', label: t('Load type'), type: 'select', options: LOAD_TYPES.map((l) => ({ value: l, label: t(LOAD_TYPE_LABEL[l]) })), defaultValue: 'c40hc' },
      { id: 'identifier', label: t('Container number or plate'), type: 'text' },
      { id: 'seal', label: t('Seal'), type: 'text' },
      { id: 'grossKg', label: t('Gross weight (kg)'), type: 'number' },
      { id: 'note', label: t('Note'), type: 'textarea' },
    ],
  };
}

/**
 * "Add content" / "Edit content": the shipment's loads, the project's BOM articles (and, on an edit, the catalogue parts already
 * packed outside the BOM, so they stay chosen) or a free item.
 */
export function itemFormDef(
  t: T, loads: number[], bom: { ref: string; name: string; equipmentRef: string | null }[], lang: Lang, edit: boolean, packed: { ref: string; name: string }[] = [],
): FormDef {
  const outside = packed.filter((p) => !bom.some((b) => b.ref === p.ref)).filter((p, i, a) => a.findIndex((x) => x.ref === p.ref) === i);
  return {
    title: t(edit ? 'Edit content' : 'Add content'),
    submit: t(edit ? 'Save' : 'Add content'),
    fields: [
      { id: 'load', label: t('Load number'), type: 'select', options: loads.map((nb) => ({ value: String(nb), label: `#${nb}` })) },
      {
        id: 'part', label: t('BOM article'), type: 'select',
        options: [
          { value: '', label: t('Free item (described below)') },
          ...bom.map((b) => ({ value: b.ref, label: `${b.ref} · ${dataText(b.name, lang)}${b.equipmentRef ? ` · ${b.equipmentRef}` : ''}` })),
          ...(edit ? outside.map((p) => ({ value: p.ref, label: `${p.ref} · ${dataText(p.name, lang)} · ${t('Not in the BOM')}` })) : []),
        ],
      },
      { id: 'description', label: t('Free item: description'), type: 'text' },
      { id: 'hsCode', label: t('Free item: HS code'), type: 'text', placeholder: '8536.10' },
      { id: 'unitValueEur', label: t('Free item: unit value (€)'), type: 'number' },
      { id: 'quantity', label: t('Quantity'), type: 'number', required: true },
      { id: 'packages', label: t('Packages'), type: 'number' },
      { id: 'lengthCm', label: t('Length (cm)'), type: 'number' },
      { id: 'widthCm', label: t('Width (cm)'), type: 'number' },
      { id: 'heightCm', label: t('Height (cm)'), type: 'number' },
      { id: 'netKg', label: t('Net weight (kg)'), type: 'number' },
      { id: 'grossKg', label: t('Gross weight (kg)'), type: 'number' },
      { id: 'originCountry', label: t('Origin (country code)'), type: 'text', defaultValue: 'FR' },
    ],
  };
}

export const gapFormDef = (t: T): FormDef => ({
  title: t('Justify the gap'), submit: t('Justify'), fields: [{ id: 'reason', label: t('Reason'), type: 'textarea', required: true }],
});

export const stepFormDef = (t: T, step: IncotermStep): FormDef => ({
  title: `${t('Edit step')} · ${t(INCOTERM_STEP_LABEL[step])}`,
  submit: t('Save'),
  fields: [
    { id: 'plannedOn', label: t('Planned (YYYY-MM-DD)'), type: 'text' },
    { id: 'actualOn', label: t('Done on (YYYY-MM-DD)'), type: 'text' },
    { id: 'note', label: t('Note'), type: 'textarea' },
  ],
});
