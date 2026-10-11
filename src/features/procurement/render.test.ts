// Static markup of Sourcing, invoices & suppliers (template 1972–2078) on a seeded in-memory database, EN and FR:
// display switch, KPI tiles, table headers and cells in template order, tag classes, row and drawer buttons per viewer
// (none outside the workspace, invoice decisions for procurement and the director only), the empty invoice filter,
// and both drawers rendered in place (overlay hooks forced "client side", portals inline).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/purchasing/sourcing', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./actions', () => ({
  sendRfqAction: vi.fn(), compareRfqAction: vi.fn(), awardRfqAction: vi.fn(), approveInvoiceAction: vi.fn(), approveInvoicePartAction: vi.fn(), rejectInvoiceAction: vi.fn(), createRfqAction: vi.fn(),
}));
vi.mock('@/components/ds/overlay', () => ({ useIsClient: () => true, useOverlay: () => {} }));
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (el: unknown) => el }));
vi.stubGlobal('document', { body: null });

import { createElement as h, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canSee, type RoleKey } from '@/config/screens';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { rfqKpiFacts } from '@/server/dal/kpis';
import { listRfqs, listSupplierInvoices } from '@/server/dal/purchasing';
import { getSupplierScorecard } from '@/server/dal/suppliers';
import { procT } from './i18n';
import { invoiceDrawerView, invoiceTabView, rfqDrawerView, rfqTabView, segView, supplierTabView, type SourcingCtx } from './model';
import { SourcingBody } from './sourcing-view';

const withI18n = (lang: Lang, el: ReactElement) => h(I18nProvider, { lang } as ComponentProps<typeof I18nProvider>, el);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '|')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/[\u00a0\u202f]/g, ' ')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
/** Each expected text appears, in this order. */
function inOrder(seq: string[], expected: string[]) {
  let at = 0;
  for (const s of expected) {
    const i = seq.indexOf(s, at);
    expect(i, `"${s}" after #${at}`).toBeGreaterThanOrEqual(0);
    at = i + 1;
  }
}
const count = (s: string, sub: string) => s.split(sub).length - 1;
const ctxOf = (lang: Lang, role: RoleKey = 'director'): SourcingCtx => ({ t: procT(makeT(lang), lang), lang, role, canEdit: canSee(role, 'procurement') });

async function rfqHtml(lang: Lang, role: RoleKey = 'director', open: string | null = null) {
  const c = ctxOf(lang, role);
  const rfqs = await listRfqs();
  const sel = rfqs.find((r) => r.number === open) ?? null;
  const drawer = sel ? rfqDrawerView(sel, { ...c, orderProject: null, currentProject: 'HLT-026' }) : null;
  return renderToStaticMarkup(withI18n(lang, h(SourcingBody, { tab: 'rfq', seg: segView(c.t), rfq: { view: rfqTabView(rfqs, open, c, await rfqKpiFacts()), drawer }, t: c.t })));
}
async function invHtml(lang: Lang, role: RoleKey = 'director', open: string | null = null, filter: Parameters<typeof invoiceTabView>[1] = 'all') {
  const c = ctxOf(lang, role);
  const invoices = await listSupplierInvoices();
  const sel = invoices.find((i) => i.number === open) ?? null;
  const drawer = sel ? invoiceDrawerView(sel, filter, { ...c, currentProject: 'HLT-026' }) : null;
  return renderToStaticMarkup(withI18n(lang, h(SourcingBody, { tab: 'inv', seg: segView(c.t), inv: { view: invoiceTabView(invoices, filter, open, c), drawer }, t: c.t })));
}
async function supHtml(lang: Lang) {
  const c = ctxOf(lang);
  return renderToStaticMarkup(withI18n(lang, h(SourcingBody, { tab: 'sup', seg: segView(c.t), sup: supplierTabView(await getSupplierScorecard('HLT-026'), c), t: c.t })));
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('RFQ & quotes', () => {
  it('EN (director): switch, KPI tiles, headers and rows in template order, row buttons', async () => {
    const html = await rfqHtml('en');
    inOrder(text(html), [
      'Display', 'RFQ & quotes', 'Invoices — 3-way match', 'Supplier performance',
      'Open RFQs', '3', '1 ready to award', 'Quotes received', '8', 'Across open requests', 'Savings vs list', '€0k' /* A-12: computed (prototype €12k) */, 'Awarded this quarter', 'Average cycle', '—' /* A-12 (prototype 9 d) */,
      'RFQ sent → award', 'Award rule', '1 / 3', 'RFQs to award decided by the project manager', // R-169 (prototype "PM")
      'Requests for quotation', 'Draft → sent → comparing → awarded · the award creates a draft purchase order',
      'RFQ', 'Part', 'Qty', 'Quotes due', 'Buyer', 'Quotes', 'Award rule', 'Awarded to', 'Status',
      'RFQ-2026-031', 'Steel plate S355 · 20 mm — 192 plates', 'KS-STL-0450', '192', '30 Sep', 'Fabien Bertrand', '3 quotes · from €1,195', 'Lowest total cost of ownership', '—', 'Comparing',
      'RFQ-2026-033', 'Frequency drives 200 kW — 6 units', 'EL-VFD-200', '6', '3 Oct', 'Pauline Noguès', '2 quotes · from €14,200', 'Technical compliance first', '—', 'Open', 'Compare quotes',
      'RFQ-2026-029', 'Wire rope 28 mm — 4 × 400 m', 'HST-ROP-28', '4', '15 Sep', 'Fabien Bertrand', '3 quotes · from €9,400', 'Lowest price', 'Teufelberger', 'Awarded',
      'RFQ-2026-034', 'Anti-collision lidar — 8 units', 'CTL-ANT-COL', '8', '10 Oct', 'Thomas Kerbrat', 'No quote yet', 'PM decides', '—', 'Draft', 'Send to suppliers',
    ]);
    expect(html).toContain('href="/purchasing/sourcing?tab=inv"');
    expect(html).toMatch(/aria-current="true"[^>]*>RFQ &amp; quotes/);
    expect(count(html, 'class="tag tag-accent')).toBe(1);
    expect(count(html, 'class="tag tag-outline')).toBe(1);
    expect(count(html, 'class="tag tag-neutral')).toBe(2);
    expect(html).toContain('aria-label="Compare quotes · RFQ-2026-033"');
    expect(html).toContain('aria-label="Send to suppliers · RFQ-2026-034"');
    expect(html).not.toContain('role="dialog"');
  });

  it('FR: translated labels and data, French singular', async () => {
    const seq = text(await rfqHtml('fr'));
    inOrder(seq, [
      'Vue', 'Consultations et devis', 'Consultations ouvertes', '1 prête à attribuer', 'Économies vs catalogue', '0 k€', 'Cycle moyen', '—', // A-12: computed (prototype 12 k€, 9 j)
      'Règle d’attribution', '1 / 3', 'Consultations à attribuer décidées par le chef de projet', // R-169 (prototype « CP »)
      'Demandes de devis (RFQ)', 'RFQ', 'Article', 'Qté', 'Devis attendus', 'Acheteur', 'Devis', 'Règle d’attribution', 'Attribuée à', 'Statut',
      'Tôle acier S355 · 20 mm — 192 tôles', '30 sept.', '3 devis · à partir de 1 195 €', 'Coût total de possession le plus bas', 'Comparaison',
      'Comparer les devis', 'Lidar anticollision — 8 unités', 'Aucun devis', 'Le chef de projet décide', 'Brouillon', 'Envoyer aux fournisseurs',
    ]);
  });

  it('outside the workspace (quality): no row buttons', async () => {
    const html = await rfqHtml('en', 'quality');
    expect(html).not.toContain('Compare quotes');
    expect(html).not.toContain('Send to suppliers');
  });

  it('RFQ drawer (project manager, RFQ-2026-031): quote comparison, request, buttons', async () => {
    const html = await rfqHtml('en', 'pm', 'RFQ-2026-031');
    const seq = text(html);
    inOrder(seq, [
      'RFQ-2026-031', 'Comparing', 'Steel plate S355 · 20 mm — 192 plates', 'Quote comparison',
      'Supplier', 'Unit', 'Total', 'vs best', 'Lead time', 'Terms', 'Rating',
      'ArcelorMittal', '€1,240', '€238,080', '+€8,640', '4 wks', 'Net 30', 'A · 98/100', 'Award',
      'Dillinger', '€1,195', '€229,440', '—', '6 wks', 'Net 45', 'B · 94/100', 'Award',
      'Salzgitter', '€1,210', '€232,320', '+€2,880', '5 wks', 'Net 30', 'B · 91/100', 'Award',
      'Best unit price and shortest lead time highlighted · rating from supplier performance ·',
      'Request', 'Part', 'KS-STL-0450 · Structural steel column HEB 450', 'Quantity', '192', 'Quotes due', '30 Sep', 'Buyer', 'Fabien Bertrand', 'Award rule',
      'Lowest total cost of ownership', 'Last purchase price', '€4,700', 'Part record', 'Purchase orders',
    ]);
    expect(html).not.toContain('Discipline lead');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Award · Dillinger"');
    expect(html).toContain('href="/reference/parts?part=KS-STL-0450"');
    expect(html).toContain('href="/projects/HLT-026/orders"');
    expect(html).toContain('--price-color:var(--color-accent-300)');
    expect(html).toContain('--lead-color:var(--color-accent-300)');
  });

  it('RFQ drawer for the quality manager (outside): the hint, no Award', async () => {
    const html = await rfqHtml('fr', 'quality', 'RFQ-2026-031');
    expect(text(html)).toContain('Meilleur prix unitaire et délai le plus court surlignés · notation issue de la performance fournisseur · Passez sur Chef de projet ou Achats pour attribuer.');
    expect(html).not.toContain('Attribuer');
    inOrder(text(html), ['Comparaison des devis', 'Fournisseur', 'Unitaire', 'Total', 'vs meilleur', 'Délai', 'Conditions', 'Notation', 'Demande', 'Article', 'Fiche article']);
  });

  it('RFQ drawer without quotes (RFQ-2026-034, director): empty line and "Send to suppliers"', async () => {
    const seq = text(await rfqHtml('en', 'director', 'RFQ-2026-034'));
    inOrder(seq, ['Quote comparison', 'No quote received yet — send the RFQ to at least three suppliers', 'Request', 'Last purchase price', '€4,980', 'Send to suppliers', 'Part record']);
  });
});

describe('Invoices — 3-way match', () => {
  it('EN (procurement): KPI tiles, status chips as links, note, rows, match dots, row buttons', async () => {
    const html = await invHtml('en', 'procurement');
    inOrder(text(html), [
      'Invoices to process', '5', '€1,724,160', 'Blocked by 3-way match', '3', 'Quantity or PO mismatch', 'Awaiting goods receipt', '2', 'Invoice before delivery',
      'Approved for payment', '0', 'Pushed to X3 accounts payable', 'Due within 30 days', '5', 'Net 30 default terms',
      'Status', 'All', '6', 'Blocked', '2', 'Awaiting receipt', '2', 'No PO', '1', 'Approved for payment', '0', 'Paid', '1',
      '3-way match: purchase order · goods receipt · invoice — approved invoices are pushed to X3 accounts payable', 'Supplier invoices',
      'Invoice', 'Supplier', 'Purchase order', 'Goods receipt', 'Amount', 'Not covered by receipt', 'Match', 'Due', 'Status',
      'INV-KS-4471', '5 Jul', 'Keystone Steelworks', 'PO-1041', 'BL-2026-0412', '€433,400', '—', 'PO', 'GR', 'INV', '4 Aug', 'Paid',
      'INV-HC-7781', '10 Sep', 'Halvorsen Cranes', 'PO-1052', 'BL-2026-0498', '€1,286,400', '€26,800', '10 Oct', 'Blocked', 'Approve received part',
      'INV-LE-2210', '25 Sep', 'Lincoln Electric', '—', '—', '€6,880', '—', '25 Oct', 'No PO',
    ]);
    expect(html).toContain('href="/purchasing/sourcing?tab=inv&amp;status=blocked"');
    expect(html).toContain('href="/purchasing/sourcing?tab=inv&amp;status=no_po"');
    expect(count(html, '>Approve received part<')).toBe(2);
    expect(count(html, '--dot:var(--color-accent-700)')).toBe(2);
    expect(count(html, '--dot:var(--color-neutral-700)')).toBe(1);
    // Each match dot names its state (tooltip + screen-reader text), not only its colour.
    expect(count(html, 'title="Partial receipt"')).toBe(2);
    expect(count(html, 'title="Receipt pending"')).toBe(1);
    expect(count(html, 'title="Missing"')).toBe(3);
    expect(html).toContain('GR<span class="');
    expect(text(html)).toContain('· Partial receipt');
    expect(html).toContain('--gap-color:var(--color-accent-300)');
    expect(html).toContain('--kpi-color:var(--color-accent-300)');
  });

  it('the project manager reads invoices without decision buttons (P-5)', async () => {
    const html = await invHtml('en', 'pm', 'INV-HC-7781');
    expect(html).not.toContain('Approve received part');
    expect(html).not.toContain('Approve €1,259,600');
    expect(html).not.toContain('Reject invoice');
    expect(html).toContain('href="/projects/HLT-026/orders?po=PO-1052"');
  });

  it('FR (director): drawer of INV-HC-7781 — 3-way match, invoice facts, buttons', async () => {
    const html = await invHtml('fr', 'director', 'INV-HC-7781');
    inOrder(text(html), [
      'Factures à traiter', '1 724 160 €', 'Statut', 'Tous', 'Bloquée', 'Factures fournisseurs',
      'INV-HC-7781', 'Bloquée', 'Halvorsen Cranes', 'Rapprochement 3 voies',
      'Commande d’achat', 'PO-1052', '1 286 400 €', 'Rapproché', 'Réception', 'BL-2026-0498', '1 259 600 €', 'Réception partielle', 'Facture', 'INV-HC-7781', '1 286 400 €', 'Rapproché',
      'Facture', 'Date de facture', '10 sept.', 'Échéance', '10 oct.', 'Conditions', 'Net 30', 'Écart facture − réception', '26 800 €', 'Motif de blocage',
      'Quantité facturée supérieure à la réception acceptée (unités refusées)',
      'Approuver 1 259 600 € · demander un avoir', 'Commande d’achat', 'Réception', 'Refuser la facture',
    ]);
    expect(html).toContain('href="/projects/HLT-026/deliveries?receipt=BL-2026-0498"');
    expect(html).toContain('--state-color:var(--color-accent-300)');
  });

  it('an empty status filter shows "No invoice in this status"', async () => {
    const html = await invHtml('en', 'director', null, 'approved_for_payment');
    expect(text(html)).toContain('No invoice in this status');
    expect(html).toMatch(/aria-current="true"[^>]*>Approved for payment/);
  });
});

describe('Supplier performance', () => {
  it('EN: KPI tiles, scorecard rows with bars, attention colours and grade tags', async () => {
    const html = await supHtml('en');
    inOrder(text(html), [
      'Active suppliers', '8', '4 rated A', 'On-time delivery', '90%', 'Weighted last 12 months', 'Quality acceptance', '97%', 'Units accepted at receipt', 'Rated C', '1',
      'Improvement plan required', 'NCRs from suppliers', '3', 'This quarter', 'Supplier scorecard',
      'On-time from deliveries · quality from goods receipt · NCR rate per unit · rating feeds RFQ comparison',
      'Supplier', 'On-time delivery', 'Quality acceptance', 'NCR rate', 'Open POs', 'NCRs this quarter', 'Rating',
      'Keystone Steelworks', '96%', '100%', '1.2%', '12', '0', 'A', 'Halvorsen Cranes', '88%', '96%', '2.1%', '4', '1', 'B',
      'Cotswold Fire Systems', '78%', '95%', '0.5%', '7', '0', 'C',
    ]);
    expect(html).toContain('--w:96%;--fill:var(--color-accent)');
    expect(html).toContain('--w:100%;--fill:var(--color-neutral-300)');
    expect(count(html, '--bar-color:var(--color-accent-300)')).toBe(2);
    expect(count(html, '--ncr-color:var(--color-accent-300)')).toBe(2);
    expect(count(html, 'class="tag tag-accent"')).toBe(1);
    expect(html).toContain('style="width:22%"');
  });

  it('FR', async () => {
    inOrder(text(await supHtml('fr')), ['Fournisseurs actifs', '4 notés A', 'Livraison à l’heure', 'Pondéré sur 12 mois', 'Notés C', 'NCR d’origine fournisseur', 'Tableau de bord fournisseurs', 'Taux de NCR', 'Commandes ouvertes', 'NCR ce trimestre', 'Notation']);
  });
});
