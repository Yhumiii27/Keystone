// Purchase orders view model and static render, from the seeded in-memory database, in EN and FR. Expected values
// are the prototype's own render values (orders.golden.json: logic 4306–4337 run in node:vm, renderVals() EN and FR
// with the deep translation), for every project of the switcher, every order drawer, the status chips, the shortfall
// assistant and the approval workflow. Deliberate deviations are applied explicitly:
// - dates without the prototype's zero padding ("4 May"), and activity starts in Aug / Apr no longer cut ("14ug A");
// - French: quantities grouped the French way ("6 214"), line counts, the late-delivery risk, the shortfall title and
//   the part-status warning in French (the prototype left them half English);
// - EWA-051 (no data): no shortfall banner (the prototype showed Harbor Line's 24 BOM articles).
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/orders', useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock('./actions', () => ({ createDraftOrdersAction: vi.fn(), submitOrderAction: vi.fn(), approveOrderAction: vi.fn(), pushOrderToX3Action: vi.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getOrdersScreen } from '@/server/dal/orders';
import golden from './orders.golden.json';
import { ordersView, type OrdersView } from './model';
import { OrdersBody } from './orders-view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];
const LANGS: Lang[] = ['en', 'fr'];
const NNBSP = ' ';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function view(code: string, lang: Lang, q: { filter?: any; selected?: string | null; viewer?: string } = {}): Promise<OrdersView> {
  const data = await getOrdersScreen(code, q.viewer ?? 'Marie Lefebvre');
  return ordersView({ code, data, filter: q.filter ?? null, selected: q.selected ?? null }, makeT(lang), lang);
}

// ── Deliberate deviations, applied to the prototype's values ──

/** Order dates "04 May" → "4 May" (activity starts keep the Plan's own text, "Needed from 09 Nov"). */
const day = (s: string) => s.replace(/(^|· )0(\d)/g, '$1$2');
/** The prototype's `.replace(' A', '')` cut Aug / Apr starts. */
const ACTUAL_STRIP_FIX: Record<string, string> = {
  'Needed from 14ug A': 'Needed from 14 Aug', 'Needed from 15pr ’27': 'Needed from 15 Apr ’27',
  'Requis à partir du 14ug A': 'Requis à partir du 14 août', 'Requis à partir du 15pr ’27': 'Requis à partir du 15 avr. ’27',
};
/** French grouping of quantities ("6,214" → "6 214"). */
const frQty = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/(\d),(\d{3})/g, `$1${NNBSP}$2`) : s);
/** French line counts, from the EN prototype value ("2 lines · 688 units · part status issue"). */
function lineCount(en: string, lang: Lang): string {
  if (lang === 'en') return en;
  const m = /^(\d+) lines? · ([\d,]+) units?( · part status issue)?$/.exec(en)!;
  const units = +m[2].replace(/,/g, '');
  return `${m[1]} ${m[1] === '1' ? 'ligne' : 'lignes'} · ${frQty(m[2], lang)} ${units === 1 ? 'unité' : 'unités'}${m[3] ? ' · problème de statut article' : ''}`;
}
const risk = (r: string, lang: Lang) =>
  r === 'Activity already started — delivery is late' && lang === 'fr' ? 'Activité déjà démarrée — livraison en retard' : day(ACTUAL_STRIP_FIX[r] ?? r);
const STATUS_FR: Record<string, string> = { 'is outdated': 'est périmé', 'is obsolete': 'est obsolète', 'is not validated': 'est non validé' };
const warn = (w: string, lang: Lang) =>
  !w || lang === 'en'
    ? w
    : w.replace(/ is (outdated|obsolete|not validated)/g, (_, s) => ' ' + STATUS_FR[`is ${s}`]).replace(' — resolve in PLM before this order is released.', ' — à résoudre dans le PLM avant la libération de cette commande.');

const gRow = (r: any, lang: Lang) => ({
  number: r.id, supplier: r.supplier, lineSummary: r.lineSummary, lineCount: '', value: r.value, status: r.status, statusClass: r.tagClass, ordered: day(r.ordered), expected: day(r.expected), expColor: r.expColor, need: r.need, risk: risk(r.risk, lang),
  riskColor: r.riskColor, canSubmit: r.canSubmit, canApprove: r.canApprove,
});
const vRow = (r: OrdersView['rows'][number]) => ({
  number: r.number, supplier: r.supplier, lineSummary: r.lineSummary, lineCount: r.lineCount, value: r.value, status: r.status, statusClass: r.statusClass, ordered: r.ordered,
  expected: r.expected, expColor: r.expColor, need: r.need, risk: r.risk, riskColor: r.riskColor, canSubmit: r.canSubmit, canApprove: r.canApprove,
});
const GLOW = '0 0 8px color-mix(in srgb, var(--color-accent) 60%, transparent)';

/** The prototype screen (`g`, from `en` for the EN-only line counts) against the view model. */
function expectSame(v: OrdersView, g: any, gEn: any, lang: Lang) {
  expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map((k: any) => [k.label, String(k.value), k.sub, k.color]));
  expect(v.title).toBe(g.title);
  expect(v.chips.map((c) => [c.label, String(c.count)])).toEqual(g.chips.map((c: any) => [c.label, c.count]));
  expect(v.rows.map(vRow)).toEqual(g.rows.map((r: any, i: number) => ({ ...gRow(r, lang), lineCount: lineCount(gEn.rows[i].lineCount, lang) })));
  expect(v.empty).toBe(g.noPOs ? (lang === 'fr' ? 'Aucune commande dans ce statut' : 'No purchase orders in this status') : null);
}

describe('purchase orders view model — prototype golden values (08 §2)', () => {
  for (const lang of LANGS)
    it.each([...DATA, 'EWA-051'])(`%s (${lang}): KPIs, chips, rows and shortfall banner`, async (code) => {
      const v = await view(code, lang);
      const g = G.projects[lang][code];
      expectSame(v, g, G.projects.en[code], lang);
      if (code === 'EWA-051') {
        expect(v.shortfall).toBeNull(); // the prototype showed Harbor Line's BOM shortfall
        return;
      }
      expect(!!v.shortfall).toBe(g.hasShortfall);
      if (v.shortfall) {
        const title = lang === 'fr' ? `${g.shortfall.length} articles de nomenclature pas entièrement commandés` : g.shortfallTitle;
        expect([v.shortfall.title, v.shortfall.sub]).toEqual([title, g.shortfallSub]);
        expect(v.shortfall.chips).toEqual(g.shortfall.map(([ref, qty]: [string, string]) => `${ref} · ${frQty(qty, lang)} ${lang === 'fr' ? 'à commander' : 'to order'}`));
      }
    });

  for (const lang of LANGS)
    it.each(DATA)(`%s (${lang}): every order drawer reproduces poVals`, async (code) => {
      const g = G.projects[lang][code];
      for (const id of Object.keys(g.drawers)) {
        const d = g.drawers[id];
        const v = (await view(code, lang, { selected: id })).drawer!;
        expect([v.head, v.status, v.statusClass]).toEqual([`${d.id} · ${d.supplier}`, d.status, d.tagClass]);
        expect(v.steps.map((s) => [s.label, s.reached ? 'var(--color-accent)' : 'var(--color-neutral-700)', s.current ? GLOW : 'none'])).toEqual(d.steps.map((s: any) => [s.label, s.dot, s.ring]));
        expect(v.warn ?? '').toBe(warn(G.projects.en[code].drawers[id].warn, lang));
        expect(v.lines.map((l) => [l.ref, l.name, l.qty, l.price, l.total, l.status, l.statusClass])).toEqual(
          d.lines.map((l: any) => [l.ref, l.name, frQty(l.qty, lang), l.price, l.total, l.pstatus, l.tagClass]),
        );
        expect(v.meta.slice(0, 5).map((m) => [m.k, m.v, m.color])).toEqual(d.meta.map((m: any) => [m.k, day(m.v), m.color]));
        expect(v.closeHref).toBe(`/projects/${code}/orders`);
      }
    });
});

describe('purchase orders view model — URL state and links', () => {
  it('status chips (`?status=`) filter the list and keep the open order; an empty status shows the empty line', async () => {
    for (const [label, f] of Object.entries(G.filters.en) as [string, any][]) {
      const code = { Draft: 'draft', 'Awaiting approval': 'awaiting_approval', Ordered: 'ordered', 'Partially received': 'partially_received', Received: 'received', Cancelled: 'cancelled' }[label]!;
      const v = await view('HLT-026', 'en', { filter: code, selected: 'PO-1063' });
      expect([v.title, v.rows.map((r) => r.number), !!v.empty]).toEqual([f.title, f.rows, f.noPOs]);
      expect(v.chips.find((c) => c.value === code)!.href).toBe(`/projects/HLT-026/orders?status=${code}&po=PO-1063`);
      expect(v.drawer?.closeHref).toBe(`/projects/HLT-026/orders?status=${code}`);
    }
    expect((await view('HLT-026', 'en', { filter: 'cancelled' })).empty).toBe('No purchase orders in this status');
  });

  it('the open order is highlighted and its row closes the drawer (select toggles)', async () => {
    const v = await view('HLT-026', 'en', { selected: 'PO-1063' });
    expect(v.rows.map((r) => [r.number, r.selected ? 'var(--color-accent-300)' : 'var(--color-neutral-300)'])).toEqual(G.selected.en);
    expect(v.rows.find((r) => r.number === 'PO-1063')!.href).toBe('/projects/HLT-026/orders');
    expect(v.rows.find((r) => r.number === 'PO-1041')!.href).toBe('/projects/HLT-026/orders?po=PO-1041');
    expect((await view('HLT-026', 'en', { selected: 'PO-9999' })).drawer).toBeNull();
  });

  it('drawer links: activity, BOM parts, goods receipts and supplier invoices of the order', async () => {
    const d = (await view('HLT-026', 'en', { selected: 'PO-1052' })).drawer!;
    expect(d.activityHref).toBe('/projects/HLT-026/plan?act=A1320');
    expect(d.lines.map((l) => l.href)).toEqual(['/projects/HLT-026/bom?part=EQ-CRN-250T', '/projects/HLT-026/bom?part=CR-RAIL-A100']);
    const extra = d.meta.slice(5);
    expect(extra.map((m) => m.k)).toEqual(['Goods receipts', 'Supplier invoices']);
    expect(extra[0].links!.every((l) => l.href.startsWith('/projects/HLT-026/deliveries?receipt=BL-'))).toBe(true);
    expect(extra[1].links!.map((l) => [l.label, l.href])).toEqual([['INV-HC-7781', '/purchasing/sourcing?tab=inv&inv=INV-HC-7781']]);
    expect(d.canPush).toBe(false); // imported from X3
    expect(d.meta.some((m) => m.k === 'Sage X3')).toBe(false);
  });

  it('approve buttons follow the approver (director / project manager), not the role on the screen', async () => {
    expect((await view('HLT-026', 'en', { viewer: 'Marie Lefebvre' })).canApprove).toBe(true);
    expect((await view('HLT-026', 'en', { viewer: 'Romain Aubert' })).canApprove).toBe(true);
    expect((await view('HLT-026', 'en', { viewer: 'Fabien Bertrand' })).canApprove).toBe(false);
    expect((await view('NDC-031', 'en', { viewer: 'Romain Aubert' })).canApprove).toBe(false);
  });
});

describe('purchase orders render', () => {
  const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));

  it('FR, editor: KPI tiles, banner with its button, chips, table headers, row buttons; no drawer', async () => {
    const v = await view('HLT-026', 'fr');
    const out = html(OrdersBody({ view: v, canEdit: true, t: makeT('fr') }), 'fr');
    for (const s of ['Commandes ouvertes', '6,09 M€', '15 articles de nomenclature pas entièrement commandés', '884 k€ restent à engager au prix catalogue', 'Créer des commandes brouillon par fournisseur',
      'KS-PLT-S355 · 192 à commander', 'Brouillon → en attente d’approbation → commandé → reçu', 'Commandes d’achat · 6', 'Cliquer sur une commande pour ses lignes', 'Requis pour le',
      'Approuver et commander', 'Activité déjà démarrée — livraison en retard'])
      expect(out).toContain(s);
    expect(out).not.toContain('Envoyer pour approbation'); // no draft yet
  });

  it('read-only: no assistant button and no row actions', async () => {
    const v = await view('HLT-026', 'en');
    const out = html(OrdersBody({ view: v, canEdit: false, t: makeT('en') }), 'en');
    expect(out).toContain('15 BOM articles are not fully ordered');
    expect(out).not.toContain('Create draft POs by supplier');
    expect(out).not.toContain('Approve &amp; order');
  });
});
