// R-158 lot A — the Shipments screen's Server Functions, the Incoterms of Settings and the contract's Incoterm against the seeded
// in-memory demo database, with the real session (the "View as" cookie) and project context: the rights for the 10 personas
// (the director, Logistics and the project's leads edit; the others read; the client is sent home), validation, the packing
// control and its validation, statuses, transport steps from the contract's Incoterm, the lifecycle deliverable « Colisage &
// documents douaniers » blocked until every packing list is validated, the audit trail and the activity feed (system messages),
// the demo shipment, and the screen rendered in English and French.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/shipments', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(),
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
}));

import { and, eq } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { canEditShipments, roleReadOnly } from '@/domain/rights';
import { INCOTERM_STEPS } from '@/domain/incoterms';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, incoterms, shipments } from '@/server/db/schema';
import { DEMO_SHIPMENT } from '@/server/db/seed/shipments';
import { getContractIncoterm, listIncoterms } from '@/server/dal/incoterms';
import { listActivity } from '@/server/dal/notifications';
import { setDeliverableAndAdvance } from '@/server/dal/projects-register';
import { getProjectShipments } from '@/server/dal/shipments';
import { COOKIE } from '@/server/session';
import { reactivateIncotermAction, removeIncotermAction, saveIncotermAction } from '@/features/admin/actions';
import { setContractIncotermAction } from '@/features/contract/actions';
import { setDeliverableAction } from '@/features/projects/actions';
import {
  addItemAction, addLoadAction, advanceShipmentAction, createShipmentAction, justifyGapAction, removeItemAction, removeShipmentAction, reopenPackingAction,
  setShipmentStepAction, updateItemAction, validatePackingAction,
} from './actions';
import { shipmentsView } from './model';
import { ShipmentsBody } from './shipments-view';

const as = (role: RoleKey, lang: Lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const READ_ONLY = { error: 'The shipments are read-only for you' };
const shipment = async (ref: string) => (await getProjectShipments('HLT-026'))!.shipments.find((s) => s.ref === ref)!;
const audit = async (ref: string) =>
  (await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.area, 'Shipments'), eq(auditEntries.objectRef, `Shipment ${ref}`))).orderBy(auditEntries.occurredAt));

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('the demo data set (R-158)', () => {
  it('11 Incoterms 2020, HLT-026 on DAP « Le Havre — terminal site »', async () => {
    const list = await listIncoterms();
    expect(list.map((i) => i.code)).toEqual(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);
    expect(list.every((i) => i.standard && i.active)).toBe(true);
    expect(list.find((i) => i.code === 'DAP')?.usedBy).toBe(1);
    const c = await getContractIncoterm('HLT-026');
    expect([c.hasContract, c.incoterm?.code, c.place]).toEqual([true, 'DAP', 'Le Havre — terminal site']);
    expect((await getContractIncoterm('NDC-031')).hasContract).toBe(false);
  });

  it('EXP-01 carries EQ-02 (3 × MEMU) in two 40′ HC containers, packing list validated, one gap justified', async () => {
    const s = await shipment('EXP-01');
    expect([s.status, s.mode, s.forwarder, s.equipment.map((e) => e.ref), s.loads.map((l) => `${l.number}:${l.type}:${l.identifier}`)]).toEqual([
      'prepared', 'road', 'Transports Delmas', ['EQ-02'], ['1:c40hc:MSKU 482190-3', '2:c40hc:TCLU 905514-8'],
    ]);
    expect(s.packingValidatedBy).toBe('Camille Verdier');
    const c = s.control;
    expect(c.lines.map((l) => [l.partRef ?? l.name, l.category, l.expected, l.packed, l.gap, !!l.justification])).toEqual([
      ['CTL-ANT-COL', 'common', 8, 8, null, false],
      ['CTL-CAM-OCR', 'common', 12, 12, null, false],
      ['CTL-WIND-SN', 'common', 2, 2, null, false],
      ['Spare fuse kit — MEMU modules', 'outside', null, 3, 'not_in_bom', true],
    ]);
    expect([c.cleared, c.openGaps, c.missingHs.length]).toEqual([true, 0, 0]);
    expect(c.restricted.map((r) => r.restriction)).toEqual(['Encryption module — export notification']);
    expect(c.hsSummary.map((r) => r.hsCode)).toEqual(['8525.89', '8536.10', '9015.10', '9015.80']);
    expect(DEMO_SHIPMENT.steps).toHaveLength(7);
  });
});

describe('rights for the 10 personas', () => {
  it('the director, Logistics and HLT-026’s PM create a shipment; the others are refused; the client is sent home', async () => {
    const outcome: Record<string, string> = {};
    for (const p of PERSONAS) {
      as(p.role);
      try {
        const r = await createShipmentAction('HLT-026', { equipment: 'EQ-01', label: `By ${p.role}` });
        outcome[p.role] = 'error' in r ? r.error : r.ref!;
      } catch (e) {
        outcome[p.role] = (e as Error).message;
      }
    }
    expect(outcome).toEqual({
      director: 'EXP-02', pm: 'EXP-03', depthead: READ_ONLY.error, member: READ_ONLY.error, englead: READ_ONLY.error, quality: READ_ONLY.error,
      procurement: READ_ONLY.error, finance: READ_ONLY.error, logistics: 'EXP-04', client: 'REDIRECT /',
    });
    as('logistics');
    for (const ref of ['EXP-02', 'EXP-03', 'EXP-04']) expect(await removeShipmentAction('HLT-026', ref)).toMatchObject({ ok: true });
    expect(PERSONAS.map((p) => p.role)).toContain('logistics');
    expect(PERSONAS).toHaveLength(10);
  });

  it('Logistics edits the shipments of every project and reads the BOM, Site, Schedule and Deliveries', () => {
    expect(canEditShipments('logistics', { lead: false })).toBe(true);
    expect(canEditShipments('procurement', { lead: false })).toBe(false);
    expect(canEditShipments('procurement', { lead: true })).toBe(true);
    expect(canEditShipments('member', { lead: true })).toBe(false);
    expect(canEditShipments('client', { lead: true })).toBe(false);
    expect(['bom', 'site', 'schedule', 'deliveries', 'shipments'].map((s) => roleReadOnly('logistics', s as never))).toEqual([true, true, true, true, false]);
  });
});

describe('a shipment from draft to picked up (Logistics)', () => {
  it('loads, content, the packing control, justification, validation, reopening, statuses and steps', async () => {
    as('logistics');
    const created = await createShipmentAction('HLT-026', { equipment: 'EQ-01', mode: 'sea', etd: '2026-11-02', eta: '2026-11-20', forwarder: 'Bolloré' });
    expect(created).toMatchObject({ ok: true, ref: 'EXP-02' });
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toEqual({ error: 'Nothing is packed yet' });
    expect(await addLoadAction('HLT-026', 'EXP-02', { type: 'tanker' })).toEqual({ error: 'Invalid request' });
    expect(await addLoadAction('HLT-026', 'EXP-02', { type: 'flat_rack', identifier: 'FR-1', grossKg: '22000' })).toMatchObject({ ok: true });
    // EXP-01 already carries the 8 lidars of the BOM: 2 more here are an excess.
    expect(await addItemAction('HLT-026', 'EXP-02', { load: '1', part: 'CTL-ANT-COL', quantity: '2' })).toMatchObject({ ok: true });
    expect(await addItemAction('HLT-026', 'EXP-02', { load: '1', description: 'Lifting beam', quantity: '1' })).toMatchObject({ ok: true });
    expect(await addItemAction('HLT-026', 'EXP-02', { load: '9', part: 'CTL-ANT-COL', quantity: '1' })).toEqual({ error: 'Unknown load' });
    expect(await addItemAction('HLT-026', 'EXP-02', { load: '1', part: 'NOPE-1', quantity: '1' })).toEqual({ error: 'Unknown part' });
    let s = await shipment('EXP-02');
    expect(s.control.lines.map((l) => [l.partRef ?? l.name, l.category, l.expected, l.packed, l.gap])).toEqual([
      ['CTL-ANT-COL', 'common', 0, 2, 'excess'], ['Lifting beam', 'outside', null, 1, 'not_in_bom'],
    ]);
    expect(s.control.missingHs.map((m) => m.label)).toEqual(['Lifting beam']);
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toEqual({ error: 'An item has no HS code: complete the part in the PLM (or the item) first' });
    const beam = s.loads[0].items.find((i) => i.free)!;
    expect(await updateItemAction('HLT-026', 'EXP-02', beam.id, { load: '1', description: 'Lifting beam', hsCode: '7326.90', unitValueEur: '2400', quantity: '1' })).toMatchObject({ ok: true });
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toEqual({ error: 'Justify each gap of the packing control first' });
    expect(await justifyGapAction('HLT-026', 'EXP-02', 'part:CTL-ANT-COL', { reason: '' })).toEqual({ error: 'Give the reason of the gap' });
    expect(await justifyGapAction('HLT-026', 'EXP-02', 'part:CTL-WIND-SN', { reason: 'x' })).toEqual({ error: 'Unknown gap' });
    expect(await justifyGapAction('HLT-026', 'EXP-02', 'part:CTL-ANT-COL', { reason: 'Two spares for the gantry' })).toMatchObject({ ok: true });
    expect(await justifyGapAction('HLT-026', 'EXP-02', `item:${beam.id}`, { reason: 'Site lifting beam (returned)' })).toMatchObject({ ok: true });
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toMatchObject({ ok: true });
    s = await shipment('EXP-02');
    expect([s.status, s.packingValidatedBy, s.control.cleared]).toEqual(['prepared', 'Camille Verdier', true]);
    // Changing the content of a prepared shipment reopens its packing list; the changed gap needs a new reason.
    const lidar = s.loads[0].items.find((i) => i.partRef === 'CTL-ANT-COL')!;
    expect(await updateItemAction('HLT-026', 'EXP-02', lidar.id, { load: '1', part: 'CTL-ANT-COL', quantity: '3' })).toMatchObject({ ok: true });
    s = await shipment('EXP-02');
    expect([s.status, s.packingValidatedAt, s.control.openGaps]).toEqual(['draft', null, 1]);
    expect(await justifyGapAction('HLT-026', 'EXP-02', 'part:CTL-ANT-COL', { reason: 'Three spares for the gantry' })).toMatchObject({ ok: true });
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toMatchObject({ ok: true });
    expect(await reopenPackingAction('HLT-026', 'EXP-02')).toMatchObject({ ok: true });
    expect((await shipment('EXP-02')).status).toBe('draft');
    expect(await advanceShipmentAction('HLT-026', 'EXP-02', 'draft')).toEqual({ error: 'Validate the packing list first' });
    expect(await validatePackingAction('HLT-026', 'EXP-02')).toMatchObject({ ok: true });

    // Steps: DAP → the seller's steps are tracked, the buyer's refused.
    expect(await setShipmentStepAction('HLT-026', 'EXP-02', 'import_clearance', { plannedOn: '2026-11-21' })).toEqual({ error: 'This step is the buyer’s under the contract’s Incoterm' });
    expect(await setShipmentStepAction('HLT-026', 'EXP-02', 'main_carriage', { plannedOn: '2026-11-03', note: 'Ro-ro' })).toMatchObject({ ok: true });
    expect((await shipment('EXP-02')).steps).toEqual([{ step: 'main_carriage', plannedOn: '2026-11-03', actualOn: null, note: 'Ro-ro' }]);

    // Statuses: one step at a time; a stale click is refused; the pick-up records the actual departure; the content freezes.
    expect(await advanceShipmentAction('HLT-026', 'EXP-02', 'in_transit')).toEqual({ error: 'The status has changed meanwhile' });
    expect(await advanceShipmentAction('HLT-026', 'EXP-02', 'prepared')).toMatchObject({ ok: true });
    s = await shipment('EXP-02');
    expect([s.status, s.atd]).toEqual(['picked_up', '2026-09-25']);
    expect(await removeItemAction('HLT-026', 'EXP-02', lidar.id)).toEqual({ error: 'The content of a shipment picked up is frozen' });
    expect(await removeShipmentAction('HLT-026', 'EXP-02')).toEqual({ error: 'Only a draft shipment can be removed' });

    // Audit trail and activity feed (system messages).
    const rows = await audit('EXP-02');
    expect(rows[0]).toMatchObject({ change: 'HLT-026 · shipment EXP-02 created · EQ-01', messageKey: 'shipment.created' });
    expect(rows.some((r) => r.change === 'HLT-026 · shipment EXP-02 · status: Prepared → Picked up')).toBe(true);
    expect(rows.find((r) => r.messageKey === 'shipment.gapJustified')?.reason).toBe('Two spares for the gantry');
    expect((await listActivity({ limit: 5 })).some((a) => a.what === 'HLT-026 · shipment EXP-02 · status: Prepared → Picked up')).toBe(true);
  });
});

describe('« Colisage & documents douaniers » (decision 4)', () => {
  it('is refused while a shipment’s packing list is not validated, allowed once they all are', async () => {
    as('logistics');
    expect(await createShipmentAction('HLT-026', { equipment: 'EQ-02' })).toMatchObject({ ref: 'EXP-03' });
    await expect(setDeliverableAndAdvance('HLT-026', 'expedition', 0, true)).rejects.toThrow('Validate the packing list of every shipment first (Shipments screen)');
    as('director');
    expect(await setDeliverableAction({ code: 'HLT-026', stage: 'expedition', index: 0, done: true })).toMatchObject({ ok: false });
    as('logistics');
    expect(await removeShipmentAction('HLT-026', 'EXP-03')).toMatchObject({ ok: true });
    // EXP-01 (prepared) and EXP-02 (picked up) are validated: the tick passes (the project is not at Expédition: no move).
    expect(await setDeliverableAndAdvance('HLT-026', 'expedition', 0, true)).toBeNull();
    // Unticking is never refused.
    expect(await setDeliverableAndAdvance('HLT-026', 'expedition', 0, false)).toBeNull();
    // Another deliverable of the stage is not concerned.
    expect(await setDeliverableAndAdvance('RCF-019', 'expedition', 1, true)).toBeNull();
    await expect(setDeliverableAndAdvance('RCF-019', 'expedition', 0, true)).rejects.toThrow('Prepare the project’s shipments first (Shipments screen)');
  });
});

describe('Incoterms in Settings and on the contract (decisions 2 and 9)', () => {
  const form = (code: string, patch: Record<string, string> = {}) => ({
    code, nameEn: 'Test term', nameFr: 'Terme d’essai', descriptionEn: '', descriptionFr: '', modes: 'any',
    ...Object.fromEntries(INCOTERM_STEPS.map((k) => [`step_${k}`, k === 'export_packaging' ? 'seller' : 'buyer'])), ...patch,
  });

  it('the director adds, edits, removes and reactivates; the other roles are refused', async () => {
    as('pm');
    expect(await saveIncotermAction('create', form('XYZ'))).toEqual({ error: 'Settings are edited by the portfolio director' });
    as('logistics');
    expect(await saveIncotermAction('create', form('XYZ'))).toEqual({ error: 'Settings are edited by the portfolio director' });
    as('member');
    expect(await saveIncotermAction('create', form('XYZ'))).toEqual({ error: 'Settings are read-only for you' });
    as('director');
    expect(await saveIncotermAction('create', form('XY'))).toEqual({ error: 'An Incoterm code is three letters' });
    expect(await saveIncotermAction('create', form('xyz'))).toMatchObject({ ok: true });
    expect(await saveIncotermAction('create', form('XYZ'))).toEqual({ error: 'This Incoterm already exists' });
    expect(await saveIncotermAction('update', form('XYZ', { step_insurance: 'seller', nameEn: 'Test term 2' }))).toMatchObject({ ok: true });
    const xyz = (await listIncoterms()).find((i) => i.code === 'XYZ')!;
    expect([xyz.nameEn, xyz.split.insurance, xyz.standard]).toEqual(['Test term 2', 'seller', false]);
    expect(await removeIncotermAction('XYZ')).toEqual({ ok: true, toast: 'Incoterm deleted' });
    // A standard (or used) Incoterm is deactivated, never deleted.
    expect(await removeIncotermAction('DAP')).toEqual({ ok: true, toast: 'Incoterm deactivated' });
    expect((await listIncoterms()).find((i) => i.code === 'DAP')).toMatchObject({ active: false, usedBy: 1 });
    expect(await reactivateIncotermAction('DAP')).toMatchObject({ ok: true });
    const db = await getDb();
    const rows = await db.select().from(auditEntries).where(eq(auditEntries.entityType, 'incoterm')).orderBy(auditEntries.occurredAt);
    expect(rows.map((r) => r.messageKey)).toEqual(['incoterm.added', 'incoterm.edited', 'incoterm.deleted', 'incoterm.deactivated', 'incoterm.reactivated']);
    expect((await db.select().from(incoterms).where(eq(incoterms.code, 'XYZ')))).toEqual([]);
  });

  it('the contract editors set the contract’s Incoterm and named place; Logistics reads it', async () => {
    as('logistics');
    expect(await setContractIncotermAction('HLT-026', { incoterm: 'CIF', place: 'Le Havre' })).toEqual({ error: 'This contract is read-only for you' });
    as('finance');
    expect(await setContractIncotermAction('HLT-026', { incoterm: 'QQQ', place: '' })).toEqual({ error: 'Unknown Incoterm' });
    expect(await setContractIncotermAction('HLT-026', { incoterm: 'CIF', place: 'Le Havre port' })).toEqual({ toast: 'Contract Incoterm saved' });
    expect(await getContractIncoterm('HLT-026')).toMatchObject({ incoterm: { code: 'CIF' }, place: 'Le Havre port' });
    // Under CIF, on-carriage to the site is the buyer's: EXP-01 no longer tracks it; the road mode does not suit a sea term.
    const view = shipmentsView((await getProjectShipments('HLT-026'))!, '2026-09-25', makeT('en'), 'en');
    const exp1 = view.shipments.find((s) => s.ref === 'EXP-01')!;
    expect(exp1.steps.find((s) => s.step === 'on_carriage')?.tracked).toBe(false);
    expect(exp1.modeWarning).toBe('CIF · applies to sea and inland waterway transport only');
    as('pm');
    expect(await setContractIncotermAction('HLT-026', { incoterm: 'DAP', place: 'Le Havre — terminal site' })).toEqual({ toast: 'Contract Incoterm saved' });
    const db = await getDb();
    const last = (await db.select().from(auditEntries).where(eq(auditEntries.messageKey, 'contract.incoterm')).orderBy(auditEntries.occurredAt)).at(-1)!;
    expect(last.change).toBe('HLT-026 · contract Incoterm: DAP Le Havre — terminal site');
    expect((await db.select({ n: shipments.ref }).from(shipments)).map((r) => r.n).sort()).toEqual(['EXP-01', 'EXP-02']);
  });
});

describe('the Logistics Home', () => {
  it('the current project’s shipments, no amount', async () => {
    const { getHomeView } = await import('@/server/dal/home');
    const persona = PERSONAS.find((p) => p.role === 'logistics')!;
    const v = await getHomeView({ role: 'logistics', persona: { name: persona.name, title: persona.title }, projectCode: 'HLT-026', zone: null, lang: 'en' });
    expect([v.greeting, v.sub]).toEqual(['Good morning, Camille', 'Logistics coordinator · Friday 25 Sep 2026']);
    expect(v.kpis.map((k) => [k.label, k.value])).toEqual([['Shipments', '2'], ['Packing lists to validate', '0'], ['On the way', '1'], ['Late transport steps', '0']]);
    expect(v.left.rows.map((r) => [r.title, r.tag])).toEqual([['EXP-01', 'Prepared'], ['EXP-02', 'Picked up']]);
    expect(v.right.rows).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/€/);
  });
});

describe('the screen (EN / FR)', () => {
  it('renders the Incoterm split, the shipments, the packing control and the customs summary', async () => {
    const data = (await getProjectShipments('HLT-026'))!;
    const render = (lang: Lang, canEdit: boolean) => {
      const t = makeT(lang);
      const view = shipmentsView(data, '2026-09-25', t, lang);
      const noForm = { title: 'x', submit: 'x', fields: [] };
      const forms = { edit: noForm, load: noForm, editLoad: noForm, item: noForm, editItem: noForm, gap: noForm, step: () => noForm };
      return renderToStaticMarkup(h(I18nProvider, { lang, children: h(ShipmentsBody, { view, code: 'HLT-026', canEdit, context: '#026', formsFor: () => forms, t }) }));
    };
    const en = render('en', true);
    for (const s of ['DAP', 'Delivered At Place', 'Le Havre — terminal site', 'EXP-01 · Modules MEMU M1–M3', 'Container 40′ HC', 'Packing control cleared', 'Customs summary by HS code', 'Reopen packing list', 'Mark picked up', 'Mark in transit'])
      expect(en, s).toContain(s);
    const fr = render('fr', false);
    for (const s of ['Rendu au lieu de destination', 'Le Havre — site du terminal', 'Conteneur 40′ HC', 'Contrôle du colisage soldé', 'Synthèse douanière par code SH', 'Transport principal', 'EPC2i (vendeur)'])
      expect(fr, s).toContain(s);
    expect(fr).not.toContain('Rouvrir la liste de colisage');
  });
});
