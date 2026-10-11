// Delivery 7 — stock issues and reservations through the Server Function, against an in-memory database:
// - SC-5a = a (R-098): an issue names an activity of the current project's plan; its value (quantity × the stock unit
//   cost, A-11) is charged to the activity's work package, which the Budget's work packages show in their actual cost;
//   a return naming an activity credits it back;
// - NEW-D4-2 / SC-5b = a (R-099): an issue or a scrap never takes units reserved for another project; "Release
//   reservation" belongs to the reserving project's PM and the director; the director alone may override (audited, the
//   reserving project sees it in its audit and activity).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'procurement' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { and, desc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { activityEvents, auditEntries, projects, stockMovements } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getCostControl } from '@/server/dal/cost';
import { listIssueActivityOptions, listStock, stockCostByWorkPackage } from '@/server/dal/stock';
import { applyStockMovementAction } from './actions';

const CENTRAL = 'Entrepôt central — Lyon';
const ATELIER = 'Atelier mécanique — Lyon';
const line = async (ref: string, loc: string) => (await listStock()).find((s) => s.ref === ref && s.location === loc)!;
const projectId = async (code: string) => (await (await getDb()).select({ id: projects.id }).from(projects).where(eq(projects.code, code)))[0].id;
const wp = async (code: string, wbs: string) => (await getCostControl(code))!.workPackages.find((w) => w.wbs === wbs)!;

describe('stock issues charged to the work package (SC-5a, R-098)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.role = 'procurement';
    viewer.lang = 'en';
  });

  it('the activity of an issue is required and must belong to the current project’s plan', async () => {
    const id = (await line('FD-SPR-HD', CENTRAL)).id;
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2' }, 'HLT-026')).toEqual({ error: 'Choose the activity the parts are issued to' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2', activity: '' }, 'HLT-026')).toEqual({ error: 'Choose the activity the parts are issued to' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2', activity: '<b>' }, 'HLT-026')).toEqual({ error: 'Choose an activity of the project plan' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2', activity: 42 }, 'HLT-026')).toEqual({ error: 'Choose an activity of the project plan' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2', activity: 'A9999' }, 'HLT-026')).toEqual({ error: 'Choose an activity of the project plan' });
    viewer.lang = 'fr';
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '2' }, 'HLT-026')).toEqual({ error: 'Choisissez l’activité à laquelle les pièces sont sorties' });
    expect((await line('FD-SPR-HD', CENTRAL)).onHand).toBe(900);
  });

  it('an issue is valued at the stock unit cost and charged to the activity’s work package; a return credits it', async () => {
    const acts = await listIssueActivityOptions('HLT-026');
    expect(acts[0]).toMatchObject({ code: expect.stringMatching(/^A\d{4}$/), label: expect.stringMatching(/^A\d{4} · /) });
    expect(acts.length).toBeGreaterThan(12); // the whole plan, not the BOM form's 12 first
    const l = await line('FD-SPR-HD', CENTRAL);
    const pid = await projectId('HLT-026');
    const db = await getDb();
    const [a] = await db.select({ id: stockMovements.id }).from(stockMovements).limit(1);
    expect(a).toBeTruthy();
    const before = new Map(await stockCostByWorkPackage(pid));
    expect([...before.values()]).toEqual([]); // the X3 seed movements carry no value (their cost is in the actuals)
    expect(await applyStockMovementAction(l.id, { op: 'issue', qty: '10', activity: 'A1250' }, 'HLT-026')).toEqual({ ok: true });
    const [m] = await db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt)).limit(1);
    expect(m).toMatchObject({ type: 'issue', qty: 10, unitCostEur: l.unitCostEur, valueEur: Math.round(10 * l.unitCostEur * 100) / 100, overrideQty: null });
    expect(m.wbsCode).toMatch(/^1\.\d+$/);
    const value = m.valueEur!;
    const after = await stockCostByWorkPackage(pid);
    expect(after.get(m.wbsCode!)).toBeCloseTo(value / 1000, 6);
    const wbs = m.wbsCode!;
    const seeded = (await db.select().from(stockMovements).where(and(eq(stockMovements.projectId, pid), eq(stockMovements.type, 'issue')))).length;
    expect(seeded).toBeGreaterThan(1);
    // The Budget's work package shows it in its actual cost.
    const w = await wp('HLT-026', wbs);
    const [aud] = await db.select().from(auditEntries).where(eq(auditEntries.area, 'Stock')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(aud.change).toContain(`· charged to A1250 (WP ${wbs}) · €${value.toFixed(2)}`);
    expect(aud.actorName).toBe('Fabien Bertrand');
    // A return naming the activity credits the package back.
    expect(await applyStockMovementAction(l.id, { op: 'return', qty: '4', activity: 'A1250' }, 'HLT-026')).toEqual({ ok: true });
    const back = (await wp('HLT-026', wbs)).actual;
    expect(back).toBeCloseTo(w.actual - Math.round(4 * l.unitCostEur * 100) / 100 / 1000, 6);
    // A return without activity credits nothing.
    expect(await applyStockMovementAction(l.id, { op: 'return', qty: '1' }, 'HLT-026')).toEqual({ ok: true });
    expect((await wp('HLT-026', wbs)).actual).toBeCloseTo(back, 6);
  });
});

describe('stock reserved for another project (R-099)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.role = 'procurement';
    viewer.lang = 'en';
  });

  it('an issue or a scrap takes the free units only; the message names the reserving project', async () => {
    // SG-BRK-SS2 at the workshop: 140 on hand, 120 reserved for MSR-012.
    const id = (await line('SG-BRK-SS2', ATELIER)).id;
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '21', activity: 'A1250' }, 'HLT-026')).toEqual({ error: '120 reserved for MSR-012 — its project manager must release them first' });
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: '21' }, 'HLT-026')).toEqual({ error: '120 reserved for MSR-012 — its project manager must release them first' });
    viewer.lang = 'fr';
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: '21' }, 'HLT-026')).toEqual({ error: '120 réservés pour MSR-012 — son chef de projet doit d’abord les libérer' });
    viewer.lang = 'en';
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '20', activity: 'A1250' }, 'HLT-026')).toEqual({ ok: true });
    expect(await line('SG-BRK-SS2', ATELIER)).toMatchObject({ onHand: 120, reserved: 120, reservedForProject: 'MSR-012' });
  });

  it('only the director may override, on an issue or a scrap; audited on both projects', async () => {
    const id = (await line('SG-BRK-SS2', ATELIER)).id;
    for (const role of ['procurement', 'pm', 'quality'] as RoleKey[]) {
      viewer.role = role;
      expect(await applyStockMovementAction(id, { op: 'issue', qty: '5', activity: 'A1250', override: true }, 'HLT-026')).toEqual({ error: 'Only the portfolio director can take stock reserved for another project' });
    }
    viewer.role = 'director';
    expect(await applyStockMovementAction(id, { op: 'reserve', qty: '1', override: true }, 'HLT-026')).toEqual({ error: 'Invalid request' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '5', activity: 'A1250', override: 'yes' }, 'HLT-026')).toEqual({ error: 'Invalid request' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '5', activity: 'A1250', override: true }, 'HLT-026')).toEqual({ ok: true });
    expect(await line('SG-BRK-SS2', ATELIER)).toMatchObject({ onHand: 115, reserved: 115, reservedForProject: 'MSR-012' });
    const db = await getDb();
    const msr = await projectId('MSR-012');
    const [m] = await db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt)).limit(1);
    expect(m).toMatchObject({ type: 'issue', overrideQty: 5, overrideFromProjectId: msr });
    const [aud] = await db.select().from(auditEntries).where(eq(auditEntries.projectId, msr)).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(aud.change).toBe('reservation 120 → 115 · 5 taken for HLT-026 · director override');
    const [ev] = await db.select().from(activityEvents).where(eq(activityEvents.projectId, msr)).orderBy(desc(activityEvents.occurredAt)).limit(1);
    expect(ev.text).toBe(`Reservation reduced · SG-BRK-SS2 × 5 · ${ATELIER} · director override`);
    // A scrap override too.
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: '15', override: true }, null)).toEqual({ ok: true });
    expect(await line('SG-BRK-SS2', ATELIER)).toMatchObject({ onHand: 100, reserved: 100 });
  });

  it('"Release reservation": the reserving project’s PM or the director only', async () => {
    // FD-DET-OPT central: 210 on hand, 180 reserved for HLT-026 (PM R. Aubert = the pm persona).
    const hlt = (await line('FD-DET-OPT', CENTRAL)).id;
    const msr = (await line('SG-BRK-SS2', ATELIER)).id;
    for (const role of ['procurement', 'quality'] as RoleKey[]) {
      viewer.role = role;
      expect(await applyStockMovementAction(hlt, { op: 'release', qty: '10' }, 'HLT-026')).toEqual({ error: 'Only the reserving project’s manager or the director can release this reservation' });
    }
    viewer.role = 'pm';
    expect(await applyStockMovementAction(msr, { op: 'release', qty: '10' }, 'HLT-026')).toEqual({ error: 'Only the reserving project’s manager or the director can release this reservation' });
    expect(await applyStockMovementAction(hlt, { op: 'release', qty: '181' }, 'NDC-031')).toEqual({ error: `Only 180 reserved at ${CENTRAL}` });
    viewer.lang = 'fr';
    expect(await applyStockMovementAction(hlt, { op: 'release', qty: '181' }, 'NDC-031')).toEqual({ error: `Seulement 180 réservés à ${CENTRAL}` });
    viewer.lang = 'en';
    // The current project does not matter: the line's own reservation is released.
    expect(await applyStockMovementAction(hlt, { op: 'release', qty: '30' }, 'NDC-031')).toEqual({ ok: true });
    expect(await line('FD-DET-OPT', CENTRAL)).toMatchObject({ onHand: 210, reserved: 150, reservedForProject: 'HLT-026', source: 'local' });
    viewer.role = 'director';
    expect(await applyStockMovementAction(msr, { op: 'release', qty: '100' }, 'HLT-026')).toEqual({ ok: true });
    expect(await line('SG-BRK-SS2', ATELIER)).toMatchObject({ reserved: 0, reservedForProject: null });
    expect(await applyStockMovementAction(msr, { op: 'release', qty: '1' }, 'HLT-026')).toEqual({ error: 'This line holds no reservation for this project' });
    // Once released, the units are free for any project.
    viewer.role = 'procurement';
    expect(await applyStockMovementAction(msr, { op: 'issue', qty: '40', activity: 'A1250' }, 'HLT-026')).toEqual({ ok: true });
  });
});
