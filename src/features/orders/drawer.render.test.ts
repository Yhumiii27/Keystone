// Order drawer static render (the portal Drawer is replaced by a plain wrapper so its content renders on the server):
// header, stepper, part-status warning, lines (clickable rows to the BOM part), "Order details" with the receipt / invoice links,
// and the buttons — "Push to X3" only for editors on an approved order drafted in Keystone. EN and FR.
import { createElement as h, type ReactElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/orders', useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock('./actions', () => ({ createDraftOrdersAction: vi.fn(), submitOrderAction: vi.fn(), approveOrderAction: vi.fn(), pushOrderToX3Action: vi.fn() }));
vi.mock('@/components/ds/Drawer', () => ({
  Drawer: ({ id, meta, children }: { id?: ReactNode; meta?: ReactNode; children?: ReactNode }) => h('section', { 'data-drawer': '' }, h('header', null, id, meta), children),
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getOrdersScreen } from '@/server/dal/orders';
import { ordersView } from './model';
import { OrderDrawer } from './order-drawer';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));

async function drawerHtml(number: string, lang: Lang, canEdit = true, patch?: (d: Awaited<ReturnType<typeof getOrdersScreen>>) => void) {
  const data = await getOrdersScreen('HLT-026', 'Marie Lefebvre');
  patch?.(data);
  const view = ordersView({ code: 'HLT-026', data, filter: null, selected: number }, makeT(lang), lang);
  return html(OrderDrawer({ code: 'HLT-026', view: view.drawer!, canEdit, t: makeT(lang) }), lang);
}

describe('order drawer render', () => {
  it('EN: PO-1082 — header, stepper, warning, line, details and links', async () => {
    const out = await drawerHtml('PO-1082', 'en');
    for (const s of [
      'PO-1082 · Cotswold Fire Systems', 'Awaiting approval', 'Draft', 'Approved', 'FD-DET-OPT is outdated — resolve in PLM before this order is released.',
      'Optical smoke detector', '€48', '€8,640', 'Outdated', 'Order details', 'Order value', '€9k', 'Ordered on', '24 Sep',
      'Expected delivery', '13 Nov', 'A1430 · Fire detection &amp; suppression', 'Site gate 2 · DAP · Net 30', 'href="/projects/HLT-026/plan?act=A1430"', 'Open activity', 'Export PO',
    ])
      expect(out).toContain(s);
    expect(out).not.toContain('Push to X3');
  });

  it('FR: PO-1052 — receipts and invoice links, French amounts', async () => {
    const out = await drawerHtml('PO-1052', 'fr');
    for (const s of ['PO-1052 · Halvorsen Cranes', 'Partiellement reçu', '1\u202f850\u202f000 €', '3\u202f700\u202f000 €', 'Validé', 'Montant de la commande', '4,99 M€', 'Commandé le', '4 mai',
      'Livraison attendue', '12 oct.', 'Porte chantier 2 · DAP · 30 jours net', 'Réceptions', 'href="/projects/HLT-026/deliveries?receipt=', 'Factures fournisseurs',
      'href="/purchasing/sourcing?tab=inv&amp;inv=INV-HC-7781"', 'Ouvrir l’activité', 'Exporter la commande'])
      expect(out).toContain(s);
  });

  it('"Push to X3": editors only, on an approved order drafted in Keystone', async () => {
    const local = (d: Awaited<ReturnType<typeof getOrdersScreen>>) => {
      const o = d.orders.find((x) => x.number === 'PO-1078')!;
      Object.assign(o, { origin: 'shortfall', x3Ref: null });
    };
    expect(await drawerHtml('PO-1078', 'en', true, local)).toContain('Push to X3');
    expect(await drawerHtml('PO-1078', 'en', false, local)).not.toContain('Push to X3');
    const fr = await drawerHtml('PO-1078', 'fr', true, local);
    expect(fr).toContain('Envoyer vers X3');
    expect(fr).toContain('Modification locale · pas encore envoyée vers X3');
  });
});
