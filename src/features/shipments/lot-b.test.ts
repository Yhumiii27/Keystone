// R-158 lot B against the seeded in-memory demo database, with the real session ("View as" cookie) and project context: the demo
// (EXP-01 arrived, partial reception, one punch item, two documents filed), the reception rights for the 10 personas, the pointing
// and its punch items (raised, withdrawn), the reception completed, the manual closure refused without a reason, the automatic
// closure with the last punch item, the shipping documents (8 templates, values masked for a viewer who may not see them, filing in
// Codex: index record and new revision, stored file, pending deposit), pub_expeditions and the milestones, the freight-delay risk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/shipments', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(),
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
}));

import { and, eq, sql } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { SHIPPING_DOC_KINDS } from '@/domain/shipping-documents';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { advancePunchItem, listPunchItems } from '@/server/dal/itp';
import { getProjectShipments } from '@/server/dal/shipments';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { codexDocumentOutbox, documents, risks, storedFiles } from '@/server/db/schema';
import { buildExportContext, runExport } from '@/server/export/run';
import { pdfTextLines } from '@/server/export/test/pdf-text';
import { COOKIE } from '@/server/session';
import { setFilesRoot } from '@/server/storage/files';
import {
  addItemAction, addLoadAction, advanceShipmentAction, closeShipmentAction, completeReceptionAction, createShipmentAction, fileShippingDocumentAction, pointItemAction,
  pointLoadAction, raiseFreightRiskAction, validatePackingAction,
} from './actions';
import { shipmentsView } from './model';
import { ShipmentsBody } from './shipments-view';

const HLT = 'HLT-026';
const as = (role: RoleKey, lang: Lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const shipment = async (ref: string) => (await getProjectShipments(HLT))!.shipments.find((s) => s.ref === ref)!;
const err = (r: unknown) => (r && typeof r === 'object' && 'error' in r ? (r as { error: string }).error : 'ok');
const actor = (role: RoleKey) => ({ name: PERSONA_BY_ROLE[role].name, role });
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r158b-'));
  setFilesRoot(dir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the demo (R-158 lot B)', () => {
  it('EXP-01 picked up 21 Sep, arrived 22 Sep, partially pointed; one damaged camera → one punch item on EQ-02; nothing filed yet', async () => {
    const s = await shipment('EXP-01');
    expect([s.status, s.atd, s.ata, s.receivedOn]).toEqual(['arrived', '2026-09-21', '2026-09-22', null]);
    expect(Object.values(s.reception.loads).map((l) => l.state)).toEqual(['received', 'received']);
    const cam = s.loads[1].items.find((i) => i.partRef === 'CTL-CAM-OCR')!;
    expect(s.reception.items[cam.id]).toMatchObject({ received: 11, missing: 0, damaged: 1, by: 'Julien Wagner' });
    expect(Object.keys(s.reception.items)).toHaveLength(3);
    expect(s.punch).toEqual([{ number: 'P-10', status: 'open', category: 'B', gap: 'damaged', loadId: s.loads[1].id, itemId: cam.id, quantity: 1 }]);
    const punch = (await listPunchItems(HLT)).find((p) => p.number === 'P-10')!;
    expect([punch.origin, punch.source, punch.equipmentRef, punch.category]).toEqual(['site', 'reception', 'EQ-02', 'B']);
    expect(s.documents).toEqual([]);
  });
});

describe('reception rights for the 10 personas', () => {
  it('the editors and the site team point; the others are refused; the client is sent home', async () => {
    const s = await shipment('EXP-01');
    const kit = s.loads[1].items.find((i) => i.free)!;
    const outcome: Record<string, string> = {};
    for (const p of PERSONAS) {
      as(p.role);
      try {
        outcome[p.role] = err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '3' }));
      } catch (e) {
        outcome[p.role] = (e as Error).message;
      }
    }
    const RO = 'The reception is read-only for you';
    // The department head has the Site screen but is not on HLT-026's team; the team member (Julien Wagner) is.
    expect(outcome).toEqual({
      director: 'ok', pm: 'ok', depthead: RO, member: 'ok', englead: RO, quality: RO, procurement: RO, finance: RO, logistics: 'ok', client: 'REDIRECT /',
    });
  });
});

describe('pointing, punch items, completion and closure', () => {
  it('gaps raise, update and withdraw punch items; the reception completes; the last punch item closed closes the shipment', async () => {
    const s = await shipment('EXP-01');
    const kit = s.loads[1].items.find((i) => i.free)!;
    as('member');
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '2', missing: '1' }))).toBe('Describe the gap found at the reception');
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '1', missing: '1' }))).toBe('Received, missing and damaged must add up to the quantity shipped');
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '2', missing: '1', note: 'One kit short in crate 4' }))).toBe('ok');
    let x = await shipment('EXP-01');
    expect(x.punch.map((p) => [p.number, p.gap, p.category, p.quantity])).toEqual([['P-10', 'damaged', 'B', 1], ['P-11', 'missing', 'B', 1]]);
    // Corrected: the kit was there after all → P-11 is withdrawn (closed); pointed missing again → reopened.
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '3' }))).toBe('ok');
    expect((await shipment('EXP-01')).punch.find((p) => p.number === 'P-11')?.status).toBe('closed');
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '2', missing: '1', note: 'One kit short in crate 4' }))).toBe('ok');
    expect((await shipment('EXP-01')).punch.find((p) => p.number === 'P-11')?.status).toBe('open');
    // A load pointed missing covers its content (one punch item for the load) — tried on load 1, then pointed received again.
    expect(err(await pointLoadAction(HLT, 'EXP-01', 1, { state: 'missing', note: 'Container not delivered' }))).toBe('ok');
    x = await shipment('EXP-01');
    const lidar = x.loads[0].items[0];
    expect(x.reception.items[lidar.id]).toMatchObject({ received: 0, missing: lidar.quantity });
    expect(x.punch.find((p) => p.loadId === x.loads[0].id && !p.itemId)).toMatchObject({ gap: 'missing', status: 'open', category: 'B' });
    expect(err(await pointItemAction(HLT, 'EXP-01', lidar.id, { received: String(lidar.quantity) }))).toBe('This load is pointed missing: point the load again first');
    expect(err(await pointLoadAction(HLT, 'EXP-01', 1, { state: 'received' }))).toBe('ok');
    for (const it of x.loads[0].items) expect(err(await pointItemAction(HLT, 'EXP-01', it.id, { received: String(it.quantity) }))).toBe('ok');
    x = await shipment('EXP-01');
    expect(x.punch.filter((p) => p.status !== 'closed').map((p) => p.number)).toEqual(['P-10', 'P-11']);

    // Completion: received on site at the business date; the site team cannot close it, an editor needs a reason while P-10/P-11 are open.
    expect(err(await completeReceptionAction(HLT, 'EXP-01'))).toBe('ok');
    x = await shipment('EXP-01');
    expect([x.status, x.receivedOn]).toEqual(['received', '2026-09-25']);
    expect(err(await pointItemAction(HLT, 'EXP-01', kit.id, { received: '3' }))).toBe('The reception is pointed once the shipment has arrived');
    expect(err(await closeShipmentAction(HLT, 'EXP-01', { reason: 'x' }))).toBe('The shipments are read-only for you');
    as('logistics');
    expect(err(await closeShipmentAction(HLT, 'EXP-01', { reason: '' }))).toBe('Give the reason for closing with open punch items');
    const db = await getDb();
    expect((await db.execute(sql`select statut, nb_reserves_ouvertes, receptionnee_le::text as r from pub_expeditions where expedition_ref = 'EXP-01'`)).rows).toEqual([
      { statut: 'received', nb_reserves_ouvertes: 2, r: '2026-09-25' },
    ]);
    // The punch list closes them: the last one closes the shipment.
    const englead = actor('englead');
    for (const n of ['P-10', 'P-10', 'P-11']) await advancePunchItem(HLT, n, englead);
    expect((await shipment('EXP-01')).status).toBe('received');
    await advancePunchItem(HLT, 'P-11', englead);
    x = await shipment('EXP-01');
    expect([x.status, x.closedOn]).toEqual(['closed', '2026-09-25']);
    expect((await db.execute(sql`select statut, nb_reserves_ouvertes from pub_expeditions where expedition_ref = 'EXP-01'`)).rows).toEqual([{ statut: 'closed', nb_reserves_ouvertes: 0 }]);
  });
});

describe('shipping documents (decision 3)', () => {
  it('eight PDFs; the values only for the roles that see them; the CMR off the road refused', async () => {
    const pdf = async (role: RoleKey, kind: string, lang: Lang = 'en') => {
      const ctx = await buildExportContext({ screen: 'shipments', viewer: PERSONA_BY_ROLE[role], lang, params: new URLSearchParams(`code=${HLT}&variant=${kind}&id=EXP-01`) });
      const f = await runExport(ctx, 'pdf', { compressPdf: false });
      return pdfTextLines(f.body).join('\n');
    };
    for (const k of SHIPPING_DOC_KINDS) expect(await pdf('logistics', k), k).toContain('EXP-01');
    const withValues = await pdf('logistics', 'export_declaration');
    expect(withValues).toContain('STATISTICAL VALUE');
    expect(withValues).toMatch(/€77,500\.00/);
    const masked = await pdf('member', 'export_declaration');
    expect(masked).not.toContain('STATISTICAL VALUE');
    expect(masked).not.toMatch(/€/);
    expect(await pdf('logistics', 'packing_list', 'fr')).toContain('Liste de colisage');
    expect(await pdf('logistics', 'cmr')).toContain('1 · SENDER');
  });

  it('"File in Codex": a new revision of the record, the PDF kept as filed, a deposit pending sync; editors only', async () => {
    as('member');
    expect(err(await fileShippingDocumentAction(HLT, 'EXP-01', 'packing_list'))).toBe('The shipments are read-only for you');
    as('logistics');
    expect(err(await fileShippingDocumentAction(HLT, 'EXP-01', 'invoice'))).toBe('Invalid request');
    const db0 = await getDb();
    expect((await db0.execute(sql`select count(*)::int as n from document_types where code = 'SHP'`)).rows).toEqual([{ n: 0 }]);
    const first = await fileShippingDocumentAction(HLT, 'EXP-01', 'packing_list');
    expect(err(first)).toBe('ok');
    // The first filing adds the SHP type (circuit: the author) to Keystone's register of Codex types.
    expect((await db0.execute(sql`select count(*)::int as n from document_types where code = 'SHP'`)).rows).toEqual([{ n: 1 }]);
    const before = (await shipment('EXP-01')).documents.find((d) => d.kind === 'packing_list')!;
    expect([before.number, before.revision]).toEqual(['SHP-HLT-040', 'A']);
    const r = await fileShippingDocumentAction(HLT, 'EXP-01', 'packing_list');
    expect(r).toMatchObject({ ok: true, toast: `${before.number} · rev B · Filed in Codex` });
    const r2 = await fileShippingDocumentAction(HLT, 'EXP-01', 'delivery_note');
    expect(err(r2)).toBe('ok');
    const docs = (await shipment('EXP-01')).documents;
    expect(docs.find((d) => d.kind === 'packing_list')).toMatchObject({ number: before.number, revision: 'B', sync: 'pending' });
    const db = await getDb();
    const [d] = await db.select().from(documents).where(eq(documents.number, before.number));
    expect([d.typeCode, d.currentRevision, d.status, d.lastWithdrawnRevision]).toEqual(['SHP', 'B', 'released', 'A']);
    const [entry] = await db.select().from(codexDocumentOutbox).where(and(eq(codexDocumentOutbox.documentId, d.id), eq(codexDocumentOutbox.revision, 'B')));
    expect([entry.kind, entry.syncStatus, !!entry.storedFileId]).toEqual(['deposit', 'pending', true]);
    const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, entry.storedFileId!));
    expect([file.mime, file.ownerType]).toEqual(['application/pdf', 'shipment_document']);
    // The revision A's deposit is superseded.
    const [old] = await db.select().from(codexDocumentOutbox).where(and(eq(codexDocumentOutbox.documentId, d.id), eq(codexDocumentOutbox.revision, 'A')));
    expect(old.closedAt).not.toBeNull();
  });
});

describe('freight delay → "Create a risk" (a lead, never automatic)', () => {
  it('a shipment due after the site need date shows the warning; the PM raises the risk once', async () => {
    as('logistics');
    const c = await createShipmentAction(HLT, { equipment: 'EQ-01', mode: 'sea', etd: '2027-02-01', eta: '2027-03-01' });
    const ref = (c as { ref: string }).ref;
    const data = (await getProjectShipments(HLT))!;
    expect(data.need?.source).toBe('site_sheet');
    const t = makeT('en');
    const viewFor = (risk: boolean) => shipmentsView(data, '2026-09-25', t, 'en', true, { code: HLT, risk: risk ? { owners: ['Romain Aubert'], categories: ['supplier_delivery'], pmName: 'Romain Aubert' } : null });
    const v = viewFor(true).shipments.find((s) => s.ref === ref)!;
    expect(v.delay).toMatch(/^ETA 1 Mar 2027 · later than the site need date/);
    expect(v.riskDraft).toEqual({ title: `Freight delay — ${ref}`, cat: 'supplier_delivery', owner: 'Romain Aubert', resp: 'mitigate' });
    expect(viewFor(false).shipments.find((s) => s.ref === ref)!.riskDraft).toBeNull();
    expect(err(await raiseFreightRiskAction(HLT, ref, v.riskDraft))).toBe('Only the project’s leads raise a risk from a shipment');
    expect(err(await raiseFreightRiskAction(HLT, 'EXP-01', v.riskDraft))).toBe('Only the project’s leads raise a risk from a shipment');
    as('pm');
    expect(err(await raiseFreightRiskAction(HLT, 'EXP-01', v.riskDraft))).toBe('The shipment’s ETA is not later than the site need date');
    const r = await raiseFreightRiskAction(HLT, ref, v.riskDraft);
    expect(r).toMatchObject({ ok: true });
    const s = await shipment(ref);
    const [risk] = await (await getDb()).select().from(risks).where(eq(risks.number, s.risk!.number));
    expect([risk.title, risk.category]).toEqual([`Freight delay — ${ref}`, 'supplier_delivery']);
    expect(err(await raiseFreightRiskAction(HLT, ref, v.riskDraft))).toBe('A risk was already raised from this shipment');
  });
});

describe('a second shipment through to the reception; the screen (EN / FR)', () => {
  it('pick-up and arrival feed the milestones (first pick-up, last arrival once all sent arrived)', async () => {
    as('logistics');
    const c = await createShipmentAction(HLT, { equipment: 'EQ-02', mode: 'road', etd: '2026-09-24', eta: '2026-09-25' });
    const ref = (c as { ref: string }).ref;
    await addLoadAction(HLT, ref, { type: 'truck', identifier: 'AB-123-CD' });
    await addItemAction(HLT, ref, { load: '1', part: 'CTL-WIND-SN', quantity: '1' });
    const s0 = await shipment(ref);
    for (const l of s0.control.lines.filter((l) => l.gap)) {
      const { justifyGapAction } = await import('./actions');
      await justifyGapAction(HLT, ref, l.key, { reason: 'Spare anemometer' });
    }
    expect(err(await validatePackingAction(HLT, ref))).toBe('ok');
    const db = await getDb();
    const arrivee = async () => (await db.execute(sql`select reel_le::text as r from pub_jalons_projets where projet_code = 'HLT-026' and jalon_code = 'arrivee_site'`)).rows[0];
    expect(await arrivee()).toEqual({ r: null });
    for (const from of ['prepared', 'picked_up']) expect(err(await advanceShipmentAction(HLT, ref, from))).toBe('ok');
    // On the road: the arrival milestone waits for it (the draft sea shipment of the previous test is not counted).
    expect(await arrivee()).toEqual({ r: null });
    expect(err(await advanceShipmentAction(HLT, ref, 'in_transit'))).toBe('ok');
    expect(await arrivee()).toEqual({ r: '2026-09-25' });
    expect((await db.execute(sql`select reel_le::text as r from pub_jalons_projets where projet_code = 'HLT-026' and jalon_code = 'expedition'`)).rows[0]).toEqual({ r: '2026-09-21' });
    expect(err(await pointLoadAction(HLT, ref, 1, { state: 'received' }))).toBe('ok');
    expect(err(await completeReceptionAction(HLT, ref))).toBe('ok');
    expect(err(await closeShipmentAction(HLT, ref, {}))).toBe('ok');

    const data = (await getProjectShipments(HLT))!;
    const render = (lang: Lang, canEdit: boolean, canReceive: boolean) => {
      const t = makeT(lang);
      const view = shipmentsView(data, '2026-09-25', t, lang, true, { code: HLT });
      const noForm = { title: 'x', submit: 'x', fields: [] };
      const forms = { edit: noForm, load: noForm, editLoad: noForm, item: noForm, editItem: noForm, gap: noForm, step: () => noForm, pointLoad: noForm, pointItem: noForm, close: noForm, risk: null };
      return renderToStaticMarkup(h(I18nProvider, { lang, children: h(ShipmentsBody, { view, code: HLT, canEdit, canReceive, context: '#026', formsFor: () => forms, t }) }));
    };
    const en = render('en', true, true);
    for (const x of ['Site reception', 'Punch items raised by the reception', 'Shipping documents', 'CMR consignment note', 'File a new revision', 'Freight delay']) expect(en, x).toContain(x);
    const fr = render('fr', false, false);
    for (const x of ['Réception sur site', 'Documents d’expédition', 'Lettre de voiture CMR', 'Retard de fret']) expect(fr, x).toContain(x);
    expect(fr).not.toContain('Verser dans Codex');
  });
});
