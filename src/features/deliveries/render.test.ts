// Deliveries & goods receipt view model and static render, from the seeded in-memory database, in EN and FR, against
// the prototype's own render values (src/domain/deliveries.golden.json: renderVals() EN and FR, deepTr applied).
// Deliberate deviations asserted inline: dates are not zero-padded ("2 sept."), receipt statuses agree with
// "livraison" in French ("Acceptée", "Refusée", "Reçue"), the rejected share uses a decimal comma ("0,5 %").
// Also: which actions each viewer gets (edit / QC), the forms, the drawer content and the cross-links.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({
  acceptReceiptAction: vi.fn(), rejectReceiptAction: vi.fn(), recordPartialQcAction: vi.fn(), registerReceiptAction: vi.fn(), attachDeliveryNoteAction: vi.fn(),
  announceDeliveryAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }), usePathname: () => '/projects/HLT-026/deliveries' }));

import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import GOLDEN from '@/domain/deliveries.golden.json';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getDeliveriesScreen } from '@/server/dal/deliveries';
import type { ReceiptStatus } from '@/server/db/codes';
import { DeliveriesBody, DeliveryDrawerBody } from './deliveries-view';
import { qcResultText, statusText } from './i18n';
import { announceFormDef, deliveriesHref, deliveriesView, registerFormDef } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
/** Prototype dates are partly zero-padded ("02 Sep", "02 sept."). */
const day = (s: string) => s.replace(/(^|· )0(\d)/g, '$1$2');
/** French statuses agreed with "livraison" (the prototype dictionary mixes genders). */
const FR_STATUS: Record<string, string> = { Accepté: 'Acceptée', Refusé: 'Refusée', Reçu: 'Reçue' };
const frStatus = (s: string, lang: Lang) => (lang === 'fr' ? (FR_STATUS[s] ?? s) : s);
/** "0.5 % des unités reçues" → "0,5 % …" in French. */
const frDecimal = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/^(\d+)\.(\d)/, '$1,$2') : s);

/**
 * A-12 (chapter 4): "On-time deliveries" is computed — receipts received by their PO's expected date over the 90 days up
 * to the data date (`onTimeDeliveryPct`) — instead of the prototype's 83 % everywhere; "—" without receipts in the window.
 */
const ON_TIME: Record<string, string> = { 'HLT-026': '100%', 'NDC-031': '100%', 'RCF-019': '100%', 'ERP-202': '100%', 'WSA-044': '—', 'MSR-012': '100%', 'EWA-051': '—' };
const onTime = (code: string) => (k: any, i: number) => (i === 3 ? { ...k, value: ON_TIME[code] } : k);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function view(lang: Lang, code = 'HLT-026', q: { status?: ReceiptStatus | null; receipt?: string | null } = {}) {
  const data = await getDeliveriesScreen(code);
  const t = makeT(lang);
  return { data, t, v: deliveriesView(code, data, { status: q.status ?? null, receipt: q.receipt ?? null }, t, lang) };
}

describe('Deliveries view model vs the prototype (EN and FR)', () => {
  for (const lang of ['en', 'fr'] as const)
    it.each(['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'])(`${lang} · %s: KPIs, chips, rows, drawers`, async (code) => {
      const g = G.seed[lang][code];
      const { v } = await view(lang, code);
      expect(v.kpis).toEqual(g.kpis.map((k: any) => ({ label: k.label, value: String(k.value), sub: frDecimal(k.sub, lang), color: k.color })).map(onTime(code)));
      expect(v.chips.map((c) => [c.label, c.count])).toEqual(g.chips.map((c: any) => [frStatus(c.label, lang), c.count]));
      expect(v.rows.map((r) => ({
        id: r.id, po: r.po, supplier: r.supplier, sub: r.sub, lines: r.lines, qty: r.qty, acc: r.acc, rej: r.rej, rejColor: r.rejColor, status: r.status,
        tagClass: `tag tag-${r.tone}`, loc: r.loc, qc: r.qc, canReceive: r.canReceive, canQC: r.canQc,
      }))).toEqual(g.rows.map((r: any) => ({
        id: r.id, po: r.po, supplier: r.supplier, sub: `${day(r.date)} · ${r.note}`, lines: r.lines, qty: r.qty, acc: r.acc, rej: r.rej, rejColor: r.rejColor,
        status: frStatus(r.status, lang), tagClass: r.tagClass, loc: r.loc, qc: r.qc, canReceive: r.canReceive, canQC: r.canQC,
      })));
      expect(v.empty).toBe(g.noDeliv);
      for (const r of v.rows) {
        const d = (await view(lang, code, { receipt: r.id })).v.drawer!;
        const gd = g.drawers[r.id];
        expect([d.head, d.supplier, d.status, `tag tag-${d.tone}`]).toEqual([`${gd.id} · ${gd.po}`, gd.supplier, frStatus(gd.status, lang), gd.tagClass]);
        expect(d.meta).toEqual(gd.meta.map((m: any, i: number) => ({ k: m.k, v: i === 2 ? day(m.v) : m.v, color: m.color })));
        expect(d.qc).toEqual(gd.qc);
        expect(d.docs).toEqual(gd.docs);
        expect(d.lines.map((l) => ({ ref: l.ref, name: l.name, o: l.o, d: l.d, a: l.a, r: l.r, rColor: l.rColor, loc: l.loc }))).toEqual(gd.lines);
        expect([d.canQc, d.canReceive]).toEqual([gd.canQC, gd.canReceive]);
      }
    });

  it('selection and URLs: the open row id in accent, chips keep the drawer, the drawer closes to the filtered list', async () => {
    const { v } = await view('en', 'HLT-026', { status: 'qc_pending', receipt: 'BL-2026-0533' });
    expect(v.rows.map((r) => [r.id, r.selected, r.href])).toEqual([['BL-2026-0521', false, '/projects/HLT-026/deliveries?status=qc_pending&receipt=BL-2026-0521']]);
    expect(v.chip).toBe('qc_pending');
    expect(v.chips[0]).toEqual({ value: 'all', label: 'All', count: '5', href: '/projects/HLT-026/deliveries?receipt=BL-2026-0533' });
    expect(v.drawer!.closeHref).toBe('/projects/HLT-026/deliveries?status=qc_pending');
    expect(v.drawer!.poHref).toBe('/projects/HLT-026/orders?po=PO-1071');
    expect(v.drawer!.lines[0].href).toBe('/projects/HLT-026/bom?part=EL-CBL-XLPE');
    const open = (await view('en', 'HLT-026', { receipt: 'BL-2026-0521' })).v;
    expect(open.rows.filter((r) => r.selected).map((r) => [r.id, r.href])).toEqual([['BL-2026-0521', '/projects/HLT-026/deliveries']]);
    expect((await view('en', 'HLT-026', { receipt: 'BL-2099-0001' })).v.drawer).toBeNull();
    expect(deliveriesHref('NDC-031', { status: 'accepted' })).toBe('/projects/NDC-031/deliveries?status=accepted');
  });

  it('French helpers: statuses agreed with "livraison", "Failed on n units", data text on exact match only', () => {
    const t = makeT('fr');
    expect((['announced', 'received', 'qc_pending', 'accepted', 'partially_rejected', 'rejected'] as const).map((s) => statusText(s, t, 'fr'))).toEqual([
      'Annoncée', 'Reçue', 'Contrôle en attente', 'Acceptée', 'Partiellement refusée', 'Refusée',
    ]);
    expect(statusText('accepted', makeT('en'), 'en')).toBe('Accepted');
    expect([qcResultText('Failed on 3 units', 'fr'), qcResultText('Failed on 1 unit', 'fr'), qcResultText('Failed on 2 drums', 'fr'), qcResultText('Mon équipe a vérifié', 'fr')]).toEqual([
      'Non conforme sur 3 unités', 'Non conforme sur 1 unité', 'Non conforme sur 2 tourets', 'Mon équipe a vérifié',
    ]);
  });
});

describe('Deliveries static render', () => {
  const body = async (lang: Lang, opts: { canEdit: boolean; canQc: boolean; code?: string; receipt?: string }) => {
    const code = opts.code ?? 'HLT-026';
    const { data, t, v } = await view(lang, code, { receipt: opts.receipt ?? null });
    const forms = opts.canEdit ? Object.fromEntries(data.receipts.filter((r) => r.status === 'announced').map((r) => [r.number, registerFormDef(r, DEMO_TODAY_ISO, t, lang)])) : {};
    const page = html(h(DeliveriesBody, { code, view: v, canEdit: opts.canEdit, canQc: opts.canQc, registerForms: forms, t }), lang);
    const drawer = v.drawer ? html(h(DeliveryDrawerBody, { code, d: v.drawer, canEdit: opts.canEdit, canQc: opts.canQc, register: forms[v.drawer.id] ?? null, t }), lang) : '';
    return { page, drawer };
  };

  it('FR: labels, chips, table and row actions of a QC viewer (quality, procurement, director)', async () => {
    const { page } = await body('fr', { canEdit: true, canQc: true });
    const txt = text(page);
    for (const s of [
      'Livraisons', '1 annoncée(s)', 'En attente de contrôle qualité', 'Retenues en quarantaine', 'Quantité refusée', '0,5 % des unités reçues', 'Livraisons à l’heure', '100%' /* A-12: computed (prototype 83%) */,
      '90 derniers jours · vs date attendue de la commande', 'Commandes à recevoir', 'Commandées ou partiellement reçues',
      'Statut', 'Tous 5', 'Annoncée 1', 'Reçue 0', 'Contrôle en attente 1', 'Acceptée 2', 'Partiellement refusée 1', 'Refusée 0',
      'Annoncée → reçue → contrôle qualité → acceptée ou refusée · les quantités acceptées entrent en stock',
      'Réceptions', 'Cliquer sur une livraison pour ses lignes, son contrôle qualité et ses documents',
      'Livraison', 'Commande', 'Fournisseur', 'Articles', 'Livré / commandé', 'Qualité', 'Rangement',
      'BL-2026-0498', '2 sept. · HC-7781', 'Conforme avec réserve', 'Non conforme sur 2 tourets', 'Zone quarantaine QC — Lyon', '0 / 444',
      'Enregistrer la réception', 'Accepter', 'Refuser',
    ])
      expect(txt).toContain(s);
    expect(page.match(/>Accepter</g)).toHaveLength(1);
    expect(page.match(/>Enregistrer la réception</g)).toHaveLength(1);
    expect(page).toContain('aria-label="Accepter · BL-2026-0521"');
    expect(page).toContain('href="/projects/HLT-026/deliveries?status=qc_pending"');
    // Rows are keyboard-reachable (ClickableRow: tabindex 0, Enter opens the drawer).
    expect(page.match(/<tr tabindex="0"/g)).toHaveLength(5);
  });

  it('a project manager registers receipts but gets no QC buttons; read-only / outside viewers get no action', async () => {
    const pm = (await body('en', { canEdit: true, canQc: false })).page;
    expect(pm).toContain('>Register receipt<');
    expect(pm).not.toContain('>Accept<');
    const ro = (await body('en', { canEdit: false, canQc: false })).page;
    expect(ro).not.toContain('>Register receipt<');
    expect(ro).not.toContain('>Reject<');
    expect(text(ro)).toContain('Goods receipts');
  });

  it('drawer of BL-2026-0521 (QC pending): lines, sections, remarks and decisions; documents, photos, footer', async () => {
    const { drawer } = await body('en', { canEdit: true, canQc: true, receipt: 'BL-2026-0521' });
    const txt = text(drawer);
    for (const s of [
      'Reference', 'Article', 'Ordered', 'Delivered', 'Accepted', 'Rejected', 'Put-away', 'EL-TRF-2MVA', 'Transformer 2 MVA · 11/0.4 kV', 'Zone quarantaine QC — Lyon',
      'Delivery', 'Purchase order', 'PO-1063', 'Supplier delivery note', 'NV-2026-1190', 'Delivered on', '18 Sep', 'Carrier', 'Nordvolt heavy haul', 'Photos', '3 attached',
      'Quality check', 'Inspector', 'Pauline Noguès', 'Result', 'Pending', 'Remarks', 'Oil sample and ratio test scheduled 29 Sep',
      'Accept → stock', 'Reject → quarantine', 'Partial rejection', 'Documents', 'Attach delivery note', 'Drop receipt photos', 'Open purchase order', 'Print receipt',
    ])
      expect(txt).toContain(s);
    expect(drawer).toContain('placeholder="Inspection remarks"');
    expect(drawer).toContain('href="/projects/HLT-026/orders?po=PO-1063"');
    const ro = (await body('en', { canEdit: false, canQc: false, receipt: 'BL-2026-0521' })).drawer;
    for (const s of ['Accept → stock', 'Attach delivery note', 'Inspection remarks']) expect(ro).not.toContain(s);
    expect(ro).toContain('Open purchase order');
  });

  it('drawer of the announced BL-2026-0540 (FR): Register receipt, no document yet, result LO only when failed', async () => {
    const { drawer } = await body('fr', { canEdit: true, canQc: true, receipt: 'BL-2026-0540' });
    const txt = text(drawer);
    for (const s of ['Enregistrer la réception', 'Aucun document pour l’instant', 'Joindre le bon de livraison', 'Déposer les photos de réception', 'Ouvrir la commande', 'Imprimer le bon de réception', 'Aucun', 'Attendue le 6 nov. · créneau d’inspection à réserver'])
      expect(txt).toContain(s);
    expect(txt).not.toContain('Accepter → stock');
    const d = (await view('en', 'HLT-026', { receipt: 'BL-2026-0533' })).v.drawer!;
    expect(d.qc.map((x) => x.color)).toEqual([OK, LO, OK]);
  });
});

describe('forms', () => {
  it('Announce a delivery: the orders still expecting goods (Harbor Line), put-away default = the Le Havre site store', async () => {
    const { data } = await view('en');
    const f = announceFormDef(data.announceable, data.putAway, makeT('en'), 'en');
    expect([f.title, f.submit, f.fields.map((x) => x.id)]).toEqual(['Announce a delivery', 'Announce', ['po', 'expected', 'carrier', 'location']]);
    expect(f.fields[0].options).toEqual([
      { value: 'PO-1052', label: 'PO-1052 · Halvorsen Cranes · EQ-CRN-250T × 2 · 12 Oct' },
      { value: 'PO-1063', label: 'PO-1063 · Nordvolt · EL-SWG-11KV × 2 · 2 Oct' },
      { value: 'PO-1071', label: 'PO-1071 · Brightline Electrics · LT-HB-200W × 260 · 19 Oct' },
    ]);
    expect(f.fields[3]).toMatchObject({ defaultValue: 'Magasin chantier — Le Havre', options: expect.not.arrayContaining([{ value: 'Zone quarantaine QC — Lyon', label: 'Zone quarantaine QC — Lyon' }]) });
    const fr = announceFormDef(data.announceable, data.putAway, makeT('fr'), 'fr');
    expect([fr.title, fr.submit, fr.fields.map((x) => x.label), fr.fields[1].placeholder]).toEqual([
      'Annoncer une livraison', 'Annoncer', ['Commande d’achat', 'Attendue le', 'Transporteur', 'Rangement'], 'Date attendue de la commande',
    ]);
  });

  it('Register receipt: delivered on (the status date), carrier and note as announced, one quantity per article', async () => {
    const { data } = await view('fr');
    const r = data.receipts.find((x) => x.number === 'BL-2026-0540')!;
    const { def, context } = registerFormDef(r, DEMO_TODAY_ISO, makeT('fr'), 'fr');
    expect(context).toBe('BL-2026-0540 · Cotswold Fire Systems');
    expect(def.fields.map((f) => [f.id, f.label, f.defaultValue, f.required ?? false])).toEqual([
      ['date', 'Livré le', '25 sept. 2026', true],
      ['carrier', 'Transporteur', '', false],
      ['note', 'Bon de livraison fournisseur', '', false],
      ['qty:FD-DAMP-FR', 'FD-DAMP-FR · Fire damper 600×400', '24', true],
      ['qty:FD-SPR-HD', 'FD-SPR-HD · Sprinkler head · quick response', '420', true],
    ]);
  });
});
