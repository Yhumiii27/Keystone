// Delivery 8 (lot connectors) on the Deliveries screen, against an in-memory seeded database:
// - R-096 (NEW-D4-3 "a", SC-3b "a"): a Rejected / Partially rejected receipt offers "Declare the supplier NCR in Vigie" per
//   rejected line (internal viewers), and the order's buyer and the project's leads are told in Keystone's bell;
// - R-015 (X-6a): an invoice the 3-way match now blocks is told to the buyer and the director (prototype n8);
// - the actor is never told; when the buyer is the actor nobody stands in; no buyer with an account → procurement users;
// - a notification failure never undoes the quality decision; the My approvals inbox path notifies too.
// Session and project context are mocked (the viewer is the actor, as in actions.test.ts). Demos use the quality persona
// (Gabriel Comte) as the actor: the seeded buyer of every order, Fabien Bertrand, is also the procurement persona.
import { createElement as h } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Gabriel Comte', role: 'quality' as string, canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }), getLastProject: async () => 'HLT-026' };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name, role: viewer.role }, outside: !viewer.canEdit, canEdit: viewer.canEdit }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }), usePathname: () => '/projects/HLT-026/deliveries' }));

import { desc, eq, inArray } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONAS } from '@/config/personas';
import { QC_DECIDERS } from '@/domain/deliveries';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { notificationRecipients, notifications, persons, purchaseOrders, users } from '@/server/db/schema';
import { getDeliveriesScreen, getReceipt } from '@/server/dal/deliveries';
import * as notificationsDal from '@/server/dal/notifications';
import { getSupplierInvoice } from '@/server/dal/purchasing';
import { decideReceiptFromInboxAction, recordPartialQcAction, rejectReceiptAction, acceptReceiptAction } from './actions';
import { DeliveryDrawerBody } from './deliveries-view';
import { deliveriesView, supplierNcrLinks } from './model';

const as = (role: string, name: string) => Object.assign(viewer, { role, name });

/** Notifications titled `title` (newest first) with their recipients' full names, sorted. */
async function notices(title: string): Promise<{ sub: string; to: string[]; screen: string; params: unknown }[]> {
  const db = await getDb();
  const rows = await db.select({ id: notifications.id, sub: notifications.body, screen: notifications.targetScreen, params: notifications.targetParams })
    .from(notifications).where(eq(notifications.title, title)).orderBy(desc(notifications.createdAt));
  if (!rows.length) return [];
  const to = await db.select({ n: notificationRecipients.notificationId, name: persons.fullName }).from(notificationRecipients)
    .innerJoin(users, eq(users.id, notificationRecipients.userId)).innerJoin(persons, eq(persons.id, users.personId))
    .where(inArray(notificationRecipients.notificationId, rows.map((r) => r.id)));
  return rows.map((r) => ({ sub: r.sub, screen: r.screen, params: r.params, to: to.filter((x) => x.n === r.id).map((x) => x.name ?? '').sort() }));
}
const REJECTED = 'Delivery rejected at receipt';
const BLOCKED = 'Invoice blocked by the 3-way match';

beforeEach(() => {
  as('quality', 'Gabriel Comte');
  viewer.canEdit = true;
  viewer.lang = 'en';
});
afterEach(() => vi.restoreAllMocks());

describe('R-096 / R-015 — notices after the quality decision', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('only the QC roles decide (every persona); the others are refused before anything is written or sent', async () => {
    for (const p of PERSONAS.filter((x) => !QC_DECIDERS.includes(x.role))) {
      as(p.role, p.name);
      expect(await rejectReceiptAction('HLT-026', 'BL-2026-0521'), p.role).toEqual({ ok: false, error: 'Quality decisions belong to the quality manager and procurement' });
      expect(await recordPartialQcAction('HLT-026', 'BL-2026-0521', { 'EL-TRF-2MVA': '1' }), p.role).toEqual({
        ok: false, error: 'Quality decisions belong to the quality manager and procurement',
      });
    }
    // Malformed and stale requests never notify.
    as('quality', 'Gabriel Comte');
    expect(await recordPartialQcAction('HLT-026', 'BL-2026-0521', { 'EL-TRF-2MVA': 'x' })).toMatchObject({ ok: false });
    expect(await rejectReceiptAction('HLT-026', 'BL-2026-0540')).toEqual({ ok: false, error: 'This delivery is no longer waiting for a quality check' });
    expect(await notices(REJECTED)).toEqual([]);
    expect((await getReceipt('BL-2026-0521'))!.status).toBe('qc_pending');
  });

  it('quality partially rejects BL-2026-0521: buyer + PM told of the rejection; INV-NV-1190 blocked → buyer + director', async () => {
    viewer.lang = 'fr';
    expect((await getSupplierInvoice('INV-NV-1190'))!.status).toBe('awaiting_receipt');
    expect(await recordPartialQcAction('HLT-026', 'BL-2026-0521', { 'EL-TRF-2MVA': '1' }, 'Oil sample failed on one unit')).toEqual({
      ok: true, status: 'Partiellement refusée', message: 'BL-2026-0521 · Partiellement refusée · 1 refusé · déclarer la NC fournisseur dans Vigie',
    });
    expect(await notices(REJECTED)).toEqual([
      { sub: 'BL-2026-0521 · PO-1063 · Nordvolt · × 1', screen: 'deliveries', params: { receipt: 'BL-2026-0521' }, to: ['Fabien Bertrand', 'Romain Aubert'] },
    ]);
    expect((await getSupplierInvoice('INV-NV-1190'))!.status).toBe('blocked');
    expect(await notices(BLOCKED)).toEqual([
      { sub: 'INV-NV-1190 · Nordvolt · BL-2026-0521 · PO-1063', screen: 'procurement', params: { pTab: 'inv', inv: 'INV-NV-1190' }, to: ['Fabien Bertrand', 'Marie Lefebvre'] },
    ]);
  });

  it('the buyer rejecting his own delivery is not told, and nobody stands in for him (NDC-031 has no lead)', async () => {
    as('procurement', 'Fabien Bertrand');
    const before = (await notices(REJECTED)).length;
    expect(await rejectReceiptAction('NDC-031', 'BL-2026-0331')).toMatchObject({ ok: true, status: 'Rejected' });
    expect(await notices(REJECTED)).toHaveLength(before);
  });

  it('My approvals inbox (English, neutral message) notifies the buyer too', async () => {
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC-031', number: 'BL-2026-0332', decision: 'rejected' })).toEqual({
      ok: true, status: 'Rejected', message: 'BL-2026-0332 · Rejected',
    });
    expect((await notices(REJECTED))[0]).toMatchObject({ sub: 'BL-2026-0332 · PO-3134 · Aeris Controls · × 6', to: ['Fabien Bertrand'] });
  });

  it('no buyer with an account (author and submitter without one) → the procurement users, the actor removed', async () => {
    const db = await getDb();
    const [helene] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Hélène Sauvage'));
    await db.update(purchaseOrders).set({ createdByPersonId: helene.id, submittedByPersonId: helene.id }).where(eq(purchaseOrders.number, 'PO-5120'));
    as('director', 'Marie Lefebvre');
    expect(await recordPartialQcAction('WSA-044', 'BL-2026-0350', { 'EL-TRF-2MVA': '1', 'EL-BAT-LI-200': '0' })).toMatchObject({ ok: true });
    expect((await notices(REJECTED))[0]).toMatchObject({ sub: 'BL-2026-0350 · PO-5120 · Nordvolt · × 1', to: ['Fabien Bertrand'] });
  });

  it('an accepted delivery notifies nobody', async () => {
    const before = [(await notices(REJECTED)).length, (await notices(BLOCKED)).length];
    // ERP-202's BL-2026-0340 accepted by quality: nothing rejected, no invoice blocked.
    expect(await acceptReceiptAction('ERP-202', 'BL-2026-0340')).toMatchObject({ ok: true, status: 'Accepted', message: 'BL-2026-0340 · Accepted' });
    expect([(await notices(REJECTED)).length, (await notices(BLOCKED)).length]).toEqual(before);
  });
});

describe('a notification failure never undoes the decision', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the bell store fails: the rejection is committed, the failure only logged', async () => {
    vi.spyOn(notificationsDal, 'createNotification').mockRejectedValue(new Error('bell store down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rejectReceiptAction('HLT-026', 'BL-2026-0521')).toMatchObject({ ok: true, status: 'Rejected' });
    expect((await getReceipt('BL-2026-0521'))!.status).toBe('rejected');
    expect(err).toHaveBeenCalled();
  });
});

describe('R-096 — "Declare the supplier NCR in Vigie" in the drawer', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('only on rejected lines of a Rejected / Partially rejected receipt; none for Accepted, Announced or QC pending; none without the option', async () => {
    const data = await getDeliveriesScreen('HLT-026');
    const t = makeT('en');
    const byStatus = (s: string) => data.receipts.filter((r) => r.status === s);
    for (const s of ['accepted', 'announced', 'qc_pending']) for (const r of byStatus(s)) expect(supplierNcrLinks('HLT-026', r, t, 'en'), `${r.number} ${s}`).toEqual([]);
    const seeded = data.receipts.find((r) => r.number === 'BL-2026-0533')!;
    expect(seeded.status).toBe('partially_rejected');
    const [link] = supplierNcrLinks('HLT-026', seeded, t, 'en');
    const line = seeded.lines.find((l) => l.rejected > 0)!;
    expect(link.label).toBe('Declare the supplier NCR in Vigie');
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({
      type: 'NC', projet: 'HLT-026', article: line.ref, titre: `BL-2026-0533 · ${line.ref} · ${line.name}`, fournisseur: 'Brightline Electrics', commande: 'PO-1071',
      reception: 'BL-2026-0533', quantite: String(line.rejected), source: 'keystone',
    });
    expect(deliveriesView('HLT-026', data, { status: null, receipt: 'BL-2026-0533' }, t, 'en', 2026).drawer!.ncrLinks).toEqual([]);
    expect(deliveriesView('HLT-026', data, { status: null, receipt: 'BL-2026-0533' }, t, 'en', 2026, { vigieLinks: true }).drawer!.ncrLinks).toEqual([link]);
  });

  it('several rejected lines: one link each, suffixed "· <ref> × <qty>" (FR)', async () => {
    as('director', 'Marie Lefebvre');
    expect(await recordPartialQcAction('NDC-031', 'BL-2026-0331', { 'EL-CBL-XLPE': '3', 'LT-HB-200W': '2' })).toMatchObject({ ok: true });
    const r = (await getReceipt('BL-2026-0331'))!;
    const links = supplierNcrLinks('NDC-031', r, makeT('fr'), 'fr');
    expect(links.map((l) => l.label)).toEqual(['Déclarer la NC fournisseur dans Vigie · EL-CBL-XLPE × 3', 'Déclarer la NC fournisseur dans Vigie · LT-HB-200W × 2']);
    expect(links.map((l) => new URL(l.href).searchParams.get('quantite'))).toEqual(['3', '2']);
  });

  it('the drawer renders the link, opening Vigie outside Keystone', async () => {
    const data = await getDeliveriesScreen('HLT-026');
    const d = deliveriesView('HLT-026', data, { status: null, receipt: 'BL-2026-0533' }, makeT('fr'), 'fr', 2026, { vigieLinks: true }).drawer!;
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(DeliveryDrawerBody, { code: 'HLT-026', d, canEdit: true, canQc: true, register: null, t: makeT('fr') }) }));
    expect(html).toContain('Déclarer la NC fournisseur dans Vigie');
    expect(html).toMatch(/href="http:\/\/localhost:3200\/signaler\?type=NC&amp;projet=HLT-026[^"]*" target="_blank" rel="noopener noreferrer"/);
  });
});
