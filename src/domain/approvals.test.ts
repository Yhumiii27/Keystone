// Golden values of the My approvals builders (docs/spec/08 §7.4–7.5, 00 §8.8) on the prototype data set:
// item text per kind (apprItems 4721–4732), the change-request routing rule, and the inbox view model
// (myApprKpis 4737) — including the fixed "Oldest" (00 §7.16, 08 OQ22).
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import {
  canDecideStep, changeRequestItems, changeRequestSub, codexDocItems, deliverableItems, deliverablesOf, deliveriesOf, deliveryItems, ecoDecided,
  ecoItems, ecoKeyOf, inboxView, invoiceItems, isoOfWhen, kpiTexts, ncrItems, ncrsOf, oldestItem, pendingStepFor, poValue, purchaseOrderItems, rfqItems,
  type ApprovalItem, type ChangeRequestForInbox, type ProtoDeliverable, type ProtoDelivery, type ProtoDoc, type ProtoEco, type ProtoInvoice,
  type ProtoNcr, type ProtoPurchaseOrder, type ProtoRfq,
} from './approvals';

const PRICES: Record<string, number> = Object.fromEntries((PROTO.PARTS as { ref: string; price: number }[]).map((p) => [p.ref, p.price]));
const pos = (code: string) => PROTO_GEN.genPOs[code] as (ProtoPurchaseOrder & { expected: string })[];
const ids = (xs: ApprovalItem[]) => xs.map((x) => x.id);

describe('purchase orders (apprItems 4723)', () => {
  it('PO-1082 awaiting approval: Cotswold Fire Systems · €9k (180 × €48 list price)', () => {
    const po = pos('HLT-026').find((o) => o.id === 'PO-1082')!;
    expect(poValue(po, PRICES)).toBe(8640);
    const [en] = purchaseOrderItems(pos('HLT-026'), PRICES, 'HLT-026', 'en');
    expect(en).toEqual({
      kind: 'po', id: 'PO-1082', title: 'Cotswold Fire Systems · €9k', sub: 'FD-DET-OPT', when: '24 Sep', whenIso: '2026-09-24', who: 'Fabien Bertrand',
      href: '/projects/HLT-026/orders?po=PO-1082', decision: { mode: 'preview' },
    });
    expect(purchaseOrderItems(pos('HLT-026'), PRICES, 'HLT-026', 'fr')[0].title).toBe('Cotswold Fire Systems · 9 k€');
    expect(ids(purchaseOrderItems(pos('HLT-026'), PRICES, 'HLT-026', 'en'))).toEqual(['PO-1082']);
  });
  it('other projects: WSA-044 has PO-5141 (Jan ’27), NDC-031 none', () => {
    const [w] = purchaseOrderItems(pos('WSA-044'), PRICES, 'WSA-044', 'en');
    expect([w.id, w.when, w.whenIso, w.href]).toEqual(['PO-5141', '9 Jan ’27', '2027-01-09', '/projects/WSA-044/orders?po=PO-5141']);
    expect(purchaseOrderItems(pos('NDC-031'), PRICES, 'NDC-031', 'en')).toEqual([]);
  });
});

describe('ECOs (apprItems 4724, ecoRoleKey 4341)', () => {
  const ecos = PROTO.ECOS as ProtoEco[];
  it('only ECO-2026-015 is in approval, pending on the pm key', () => {
    expect(ecoKeyOf('pm')).toBe('pm');
    expect(ecoKeyOf('director')).toBeNull();
    const [e] = ecoItems(ecos, 'pm', PROTO.ECO_TYPES, PROTO.PROJ_NAMES);
    expect(e).toMatchObject({
      kind: 'eco', id: 'ECO-2026-015', sub: 'Obsolescence notice · Harbor Line, Clinique Pasteur Lyon', when: '19 Sep', who: 'Gabriel Comte',
      href: '/reference/eco?eco=ECO-2026-015', decision: { mode: 'preview' },
    });
    expect(ecoItems(ecos, 'englead', PROTO.ECO_TYPES, PROTO.PROJ_NAMES)).toEqual([]);
    expect(ecoItems(ecos, 'quality', PROTO.ECO_TYPES, PROTO.PROJ_NAMES)).toEqual([]);
  });
  it('ECO approvals given per key ("Decided this week" ECO term)', () => {
    expect([ecoDecided(ecos, 'pm'), ecoDecided(ecos, 'englead'), ecoDecided(ecos, 'quality')]).toEqual([2, 4, 3]);
  });
});

describe('delivery quality checks (apprItems 4725, genDeliv 4449)', () => {
  const hlt = PROTO.HLT_DELIV as ProtoDelivery[];
  it('Harbor Line: BL-2026-0521 Nordvolt, QC remarks, opens the receipt', () => {
    expect(deliveryItems(deliveriesOf('HLT-026', hlt, pos('HLT-026'), 1), 'HLT-026')).toEqual([
      {
        kind: 'delivery', id: 'BL-2026-0521', title: 'Nordvolt · EL-TRF-2MVA', sub: 'Oil sample and ratio test scheduled 29 Sep', when: '18 Sep', whenIso: '2026-09-18',
        who: 'Fabien Bertrand', href: '/projects/HLT-026/deliveries?receipt=BL-2026-0521', decision: { mode: 'preview' },
      },
    ]);
  });
  it('generated receipts: one per received / partially received PO, QC pending while partial; none without data', () => {
    const ndc = deliveriesOf('NDC-031', hlt, pos('NDC-031'), 3);
    expect(ndc.map((d) => [d.id, d.status, d.date])).toEqual([
      ['BL-2026-0330', 'Accepted', '16 Oct'],
      ['BL-2026-0331', 'QC pending', '8 Aug'],
      ['BL-2026-0332', 'QC pending', '17 Nov'],
    ]);
    expect(deliveryItems(ndc, 'NDC-031').map((i) => [i.id, i.title, i.sub])).toEqual([
      ['BL-2026-0331', 'Brightline Electrics · EL-CBL-XLPE, LT-HB-200W', 'Inspection to schedule'],
      ['BL-2026-0332', 'Aeris Controls · ME-CRAC-60', 'Inspection to schedule'],
    ]);
    expect(deliveriesOf('EWA-051', hlt, [], null)).toEqual([]);
  });
});

describe('client deliverables (apprItems 4727, allDlv 4630)', () => {
  const hlt = PROTO.HLT_DELIVS as ProtoDeliverable[];
  it('Harbor Line: D-014 and D-016 submitted', () => {
    const xs = deliverableItems(deliverablesOf('HLT-026', hlt, true, 'R. Aubert'), 'HLT-026');
    expect(xs.map((x) => [x.id, x.sub, x.when, x.who, x.href])).toEqual([
      ['D-014', 'Test & inspection reports · Accept by 2 Oct', '25 Sep', 'Thomas Kerbrat', '/projects/HLT-026/quality?tab=dlv&dlv=D-014'],
      ['D-016', 'Calculation notes · Accept by 9 Oct', '30 Sep', 'Julien Wagner', '/projects/HLT-026/quality?tab=dlv&dlv=D-016'],
    ]);
  });
  it('other projects with data reuse the first four as D-110…, R = their PM; none without data', () => {
    const xs = deliverableItems(deliverablesOf('NDC-031', hlt, true, 'S. Perrin'), 'NDC-031');
    expect(xs.map((x) => [x.id, x.who])).toEqual([['D-112', 'S. Perrin']]);
    expect(deliverablesOf('EWA-051', hlt, false, 'S. Perrin')).toEqual([]);
  });
});

describe('RFQ awards, invoices, NCRs (apprItems 4728–4730)', () => {
  it('RFQ-2026-031 comparing three quotes', () => {
    expect(rfqItems(PROTO.RFQS as ProtoRfq[])).toEqual([
      {
        kind: 'rfq', id: 'RFQ-2026-031', title: 'Steel plate S355 · 20 mm — 192 plates', sub: '3 quotes · Lowest total cost of ownership', when: '30 Sep', whenIso: '2026-09-30',
        who: 'Fabien Bertrand', href: '/purchasing/sourcing?tab=rfq&rfq=RFQ-2026-031', decision: null,
      },
    ]);
  });
  it('three invoices blocked or without PO, amounts in full euros', () => {
    const en = invoiceItems(PROTO.INVOICES as ProtoInvoice[], 'en');
    expect(en.map((i) => [i.id, i.title, i.sub, i.when, i.who])).toEqual([
      ['INV-HC-7781', 'Halvorsen Cranes · €1,286,400', 'Receipt does not cover invoice', '10 Sep', 'Accounts payable'],
      ['INV-BX-55120', 'Brightline Electrics · €163,800', 'Receipt does not cover invoice', '24 Sep', 'Accounts payable'],
      ['INV-LE-2210', 'Lincoln Electric · €6,880', 'No purchase order referenced', '25 Sep', 'Accounts payable'],
    ]);
    expect(en[0].href).toBe('/purchasing/sourcing?tab=inv&inv=INV-HC-7781');
    expect(invoiceItems(PROTO.INVOICES as ProtoInvoice[], 'fr')[0].title.replace(/\s/g, ' ')).toBe('Halvorsen Cranes · 1 286 400 €');
  });
  it('NCRs: none in Verification in the data set; a verification NCR becomes an inline item', () => {
    const hlt = PROTO.HLT_NCRS as ProtoNcr[];
    expect(ncrItems(ncrsOf('HLT-026', hlt, true), 'HLT-026')).toEqual([]);
    expect(ncrsOf('NDC-031', hlt, true).map((n) => n.id)).toEqual(['NCR-040', 'NCR-041']);
    expect(ncrsOf('EWA-051', hlt, false)).toEqual([]);
    const v = ncrItems([{ ...hlt[0], status: 'Verification' }], 'HLT-026')[0];
    expect([v.id, v.sub, v.when, v.who, v.href, v.decision]).toEqual(['NCR-026', 'Major · Julien Wagner', '2 Oct', 'Hélène Sauvage', '/projects/HLT-026/quality?tab=ncr&ncr=NCR-026', { mode: 'preview' }]);
  });
});

describe('Codex documents (00 §7.8, DOC_WHO)', () => {
  const docs = PROTO.DOCS as ProtoDoc[];
  it('RPT-HLT-014 (release proposed) waits for the quality manager, step 2 of its circuit', () => {
    expect(codexDocItems(docs, PROTO.DOC_TYPE, PROTO.DOC_WHO, 'G. Comte', 'HLT-026')).toEqual([
      {
        kind: 'doc', id: 'RPT-HLT-014', title: 'Crane rail alignment report', sub: 'Test & inspection report · rev A · Quality manager', when: '28 Sep', whenIso: '2026-09-28',
        who: 'G. Comte', href: '/projects/HLT-026/documents?doc=RPT-HLT-014', decision: null,
      },
    ]);
    for (const who of ['R. Aubert', 'M. Lefebvre', 'A. Girard', 'N. Bensaïd', 'F. Bertrand']) expect(codexDocItems(docs, PROTO.DOC_TYPE, PROTO.DOC_WHO, who, 'HLT-026')).toEqual([]);
  });
});

describe('change requests (apprItems 4726 by person)', () => {
  const approver = { pm: 'Romain Aubert', director: 'Marie Lefebvre', client: 'Nadia Bensaïd', ccb: 'Monthly · next 8 Oct' } as const;
  const status = (s: string) => (s === 'In review' ? 'in_review' : s === 'Draft' ? 'draft' : s === 'Approved' ? 'approved' : 'rejected');
  const crs: ChangeRequestForInbox[] = (PROTO.HLT_CRS_X as { id: string; title: string; status: string; chain: Record<string, string>; by: string; date: string; amt: number; days: number; types: string[] }[]).map((c) => ({
    id: c.id, title: c.title, typesLabel: c.types.map((t) => PROTO.CR_TYPES[t]).join(' · '), amount: c.amt, days: c.days, status: status(c.status), by: c.by, date: c.date,
    chain: (['pm', 'director', 'client', 'ccb'] as const).map((step) => ({ step, approver: approver[step], decision: (c.chain[step] === 'n/a' ? 'na' : c.chain[step]) as 'ok' })),
  }));
  const director = { name: 'Marie Lefebvre', role: 'director' } as const;
  const client = { name: 'Nadia Bensaïd', role: 'client' } as const;
  const pm = { name: 'Romain Aubert', role: 'pm' } as const;
  it('CR-008 waits for the director and the client contact, not the PM (step already ok)', () => {
    expect(ids(changeRequestItems(crs, director, 'HLT-026', 'en'))).toEqual(['CR-008']);
    expect(ids(changeRequestItems(crs, client, 'HLT-026', 'en'))).toEqual(['CR-008']);
    expect(changeRequestItems(crs, pm, 'HLT-026', 'en')).toEqual([]);
    const [d] = changeRequestItems(crs, director, 'HLT-026', 'en');
    expect(d).toEqual({
      kind: 'cr', id: 'CR-008', title: 'Second steel crew — schedule recovery', sub: 'Budget · Schedule · +€85k · -12 d', when: '24 Sep', whenIso: '2026-09-24', who: 'R. Aubert',
      href: '/projects/HLT-026/changes?cr=CR-008', decision: { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'director' },
    });
    expect(changeRequestItems(crs, client, 'HLT-026', 'fr')[0].sub).toBe('Budget · Schedule · +85 k€ · -12 d');
    expect(changeRequestItems(crs, client, 'HLT-026', 'en')[0].decision).toMatchObject({ step: 'client' });
    // Another person holding the director role is not the named approver of the director step.
    expect(ids(changeRequestItems(crs, { name: 'Someone Else', role: 'pm' }, 'HLT-026', 'en'))).toEqual([]);
  });
  it('once the director step is decided, CR-008 comes back to the director for the change control board (recorded by the director on Change control)', () => {
    const decided = crs.map((c) => (c.id === 'CR-008' ? { ...c, chain: c.chain.map((x) => (x.step === 'director' ? { ...x, decision: 'ok' as const } : x)) } : c));
    const [d] = changeRequestItems(decided, director, 'HLT-026', 'en');
    expect([d.id, d.sub, d.decision]).toEqual([
      'CR-008', 'Budget · Schedule · +€85k · -12 d · Change control board', { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'ccb' },
    ]);
    const fr = changeRequestItems(decided, director, 'HLT-026', 'fr')[0].sub;
    // Shared engine: the prototype's "-12 d" stays as is (the feature's inboxT renders "-12 j", see myapprovals.test.ts).
    expect(makeT('fr')(fr)).toBe('Budget · Planning · +85 k€ · -12 d · Comité de contrôle des modifications');
    expect(changeRequestItems(decided, client, 'HLT-026', 'en')[0].decision).toMatchObject({ step: 'client' });
  });
  it('sub line omits a zero amount or zero days; days are signed', () => {
    expect(changeRequestSub({ typesLabel: 'Schedule', amount: 0, days: 27 }, 'en')).toBe('Schedule · +27 d');
    // Negative days keep the prototype's ASCII hyphen (apprItems 4726: `c0.days+' d'`), as Change control's cell.
    expect(changeRequestSub({ typesLabel: 'Budget · Schedule', amount: -4, days: -5 }, 'en')).toBe('Budget · Schedule · −€4k · -5 d');
    expect(changeRequestSub({ typesLabel: 'Scope', amount: 15, days: 0 }, 'en')).toBe('Scope · +€15k');
  });
  it('permission rule: in review, own pending step (named approver; CCB = its recorder role), never a draft', () => {
    const cr8 = crs.find((c) => c.id === 'CR-008')!;
    const cr9 = crs.find((c) => c.id === 'CR-009')!;
    expect(canDecideStep(cr8, 'director', director)).toBe(true);
    expect(canDecideStep(cr8, 'client', director)).toBe(false);
    expect(canDecideStep(cr8, 'pm', pm)).toBe(false);
    expect(canDecideStep(cr8, 'ccb', director)).toBe(true);
    expect(canDecideStep(cr8, 'ccb', pm)).toBe(false);
    expect(canDecideStep(cr8, 'ccb', client)).toBe(false);
    expect(canDecideStep(cr9, 'pm', pm)).toBe(false);
    expect(canDecideStep(cr9, 'ccb', director)).toBe(false);
    expect(pendingStepFor({ ...cr9, status: 'in_review' }, pm)).toBe('pm');
    expect(pendingStepFor({ ...cr9, status: 'in_review' }, director)).toBe('director');
  });
});

describe('inbox view (myApprKpis 4737, apprChips 4736)', () => {
  const it_ = (kind: ApprovalItem['kind'], id: string, when: string): ApprovalItem => ({ kind, id, title: id, sub: '', who: '', when, whenIso: isoOfWhen(when), href: null, decision: null });
  // The director's seed queue (HLT-026): PO-1082, CR-008, INV-HC-7781, INV-BX-55120, INV-LE-2210.
  const director = [it_('po', 'PO-1082', '24 Sep'), it_('cr', 'CR-008', '24 Sep'), it_('invoice', 'INV-HC-7781', '10 Sep'), it_('invoice', 'INV-BX-55120', '24 Sep'), it_('invoice', 'INV-LE-2210', '25 Sep')];

  it('KPIs: 5 waiting · 3 kinds · oldest 10 Sep (not the last pushed, 25 Sep) · decided', () => {
    const v = inboxView(director, { decided: 1, roleTitle: 'Portfolio director' });
    const en = v.kpis.map((k) => kpiTexts(k, makeT('en')));
    expect(en).toEqual([
      { label: 'Waiting for me', value: '5', sub: 'As Portfolio director', lo: true },
      { label: 'Types', value: '3', sub: 'Purchase order · Change request · Invoice — 3-way match', lo: false },
      { label: 'Oldest', value: '10 Sep', sub: 'Submitted on', lo: false },
      { label: 'Decided this week', value: '1', sub: 'Audit trail kept per item', lo: false },
    ]);
    expect(v.kpis.map((k) => kpiTexts(k, makeT('fr')))).toEqual([
      { label: 'En attente de ma part', value: '5', sub: 'En tant que Directrice de portefeuille', lo: true },
      { label: 'Types', value: '3', sub: 'Commande d’achat · Demande de modification · Facture — rapprochement 3 voies', lo: false },
      { label: 'Plus ancienne', value: '10 sept.', sub: 'Soumise le', lo: false },
      { label: 'Décidées cette semaine', value: '1', sub: 'Piste d’audit conservée par élément', lo: false },
    ]);
    expect(director[director.length - 1].when).toBe('25 Sep'); // what the prototype showed
  });

  it('chips: All + each kind present, with counts; the filter keeps one kind and falls back to All when gone', () => {
    const v = inboxView(director, { decided: 1, roleTitle: 'Portfolio director', filter: 'invoice' });
    expect(v.chips.map((c) => [c.value, c.label, c.count])).toEqual([
      [null, 'All', 5],
      ['po', 'Purchase order', 1],
      ['cr', 'Change request', 1],
      ['invoice', 'Invoice — 3-way match', 3],
    ]);
    expect([v.filter, ids(v.rows), v.total]).toEqual(['invoice', ['INV-HC-7781', 'INV-BX-55120', 'INV-LE-2210'], 5]);
    expect(inboxView(director, { decided: 0, roleTitle: 'x', filter: 'eco' }).filter).toBeNull();
    expect(inboxView(director, { decided: 0, roleTitle: 'x', filter: 'bogus' }).rows).toHaveLength(5);
  });

  it('empty queue: 0 · Nothing pending · —', () => {
    const v = inboxView([], { decided: 4, roleTitle: 'Engineering lead' });
    expect(v.kpis.map((k) => kpiTexts(k, makeT('en')))).toEqual([
      { label: 'Waiting for me', value: '0', sub: 'As Engineering lead', lo: false },
      { label: 'Types', value: '0', sub: 'Nothing pending', lo: false },
      { label: 'Oldest', value: '—', sub: 'Submitted on', lo: false },
      { label: 'Decided this week', value: '4', sub: 'Audit trail kept per item', lo: false },
    ]);
    expect(v.chips).toEqual([{ value: null, label: 'All', count: 0 }]);
  });

  it('oldest: earliest date, first on ties, undated items ignored', () => {
    expect(oldestItem([it_('request', 'RQ-043', '25 Sep'), it_('request', 'RQ-041', '24 Sep')])!.id).toBe('RQ-041');
    expect(oldestItem([it_('po', 'A', '24 Sep'), it_('cr', 'B', '24 Sep')])!.id).toBe('A');
    expect(oldestItem([it_('po', 'A', ''), it_('cr', 'B', '—')])).toBeNull();
    expect(oldestItem([it_('po', 'PO-5141', '9 Jan ’27'), it_('stage', 'NDC-031', '25 Sep 2026')])!.id).toBe('NDC-031');
  });
});
