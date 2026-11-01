// R-204 — supplier schedules and activity codes on the demo database (HLT-026): a supplier schedule created on an order (empty,
// or with the standard steps chained and the delivery committed at the order's expected date), its consolidation into
// Reschedule (the delivery drives the reception activity it is tied to; a supplier slip moves it), logic loops refused through
// the project, the forecast and slips, the audit rows, the Gantt's « Suppliers » band, the plan trash taking the ties with an
// activity and giving them back, and the activity codes (derived equipment and purchasing package, stored types and values,
// assignment, the equipment type writing the activity's equipment line).
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addActivityCodeType, addActivityCodeValue, ActivityCodeWriteError, getActivityCodes, removeActivityCodeValue, setActivityCode } from './activity-codes';
import { getGanttNetwork } from './gantt';
import { listAudit } from './notifications';
import { restorePlanTrash, trashPlanRow } from './plan-trash';
import { rescheduleProject } from './schedule';
import { loadScheduleNetwork } from './schedule-network';
import {
  SupplierScheduleError, addSupplierLink, addSupplierTie, createSupplierSchedule, listSupplierSchedules, recordSupplierProgress, removeSupplierActivity,
  removeSupplierTie, saveSupplierActivity,
} from './supplier-schedules';
import { supplierSchedulesView } from '@/features/supplier-schedules/model';

const PM = { name: 'Romain Aubert', role: 'pm' };
const BUYER = { name: 'Fabien Bertrand', role: 'procurement' };
const startOf = async (code: string) =>
  ((await (await getDb()).execute(sql`select a.start_date::text s from activities a join projects p on p.id = a.project_id where p.code = 'HLT-026' and a.code = ${code}`)).rows[0] as { s: string }).s;

beforeAll(async () => setDb(await openDatabase()), 120_000);

describe('supplier schedules (R-204)', () => {
  it('creates a schedule with the standard steps, chained, the delivery committed at the order’s expected date', async () => {
    await createSupplierSchedule('HLT-026', 'PO-1082', { template: true }, BUYER);
    const [s] = (await listSupplierSchedules('HLT-026')).filter((x) => x.poNumber === 'PO-1082');
    expect(s.activities.map((a) => [a.code, a.durationDays])).toEqual([['F10', 10], ['F20', 40], ['F30', 3], ['F40', 5], ['F50', 0]]);
    expect(s.activities.at(-1)).toMatchObject({ committedStart: '2026-11-13', committedFinish: '2026-11-13' });
    expect(s.links.map((l) => `${l.pred}>${l.succ}`)).toEqual(['F10>F20', 'F20>F30', 'F30>F40', 'F40>F50']);
    await expect(createSupplierSchedule('HLT-026', 'PO-1082', { template: true }, BUYER)).rejects.toMatchObject({ code: 'exists' });
    await expect(createSupplierSchedule('HLT-026', 'PO-9999', { template: false }, BUYER)).rejects.toMatchObject({ code: 'unknownOrder' });
    // Not tied: not in the project network (the project is unchanged).
    const net = await loadScheduleNetwork('HLT-026', undefined, { suppliers: true });
    expect(net!.input.activities.some((a) => a.id.startsWith('PO-1082/'))).toBe(false);
    expect((await listAudit())[0]).toMatchObject({ object: 'HLT-026 · PO-1082', change: 'supplier schedule created (standard steps)' });
  });

  it('consolidates a tied schedule: the delivery drives the reception; a supplier slip moves the project', async () => {
    await createSupplierSchedule('HLT-026', 'PO-1078', { template: false }, BUYER);
    await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F10', name: 'Manufacturing', duration: '20', committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: true }, BUYER);
    await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F20', name: 'Delivery', duration: '0', committedStart: '2026-11-06', committedFinish: '2026-11-06' }, { chain: true }, BUYER);
    expect((await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1078')!.links).toMatchObject([{ pred: 'F10', succ: 'F20', type: 'FS', lag: 0 }]);

    const before = await rescheduleProject('HLT-026', PM.name);
    expect(before.ok).toBe(true);
    const a1430 = await startOf('A1430');

    await addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F20', activity: 'A1430', direction: 'to_project', lag: '0' }, PM);
    // The supplier now takes 45 working days instead of 20: the delivery and A1430 slip.
    await saveSupplierActivity('HLT-026', 'PO-1078', 'F10', { code: 'F10', name: 'Manufacturing', duration: '45', committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: false }, BUYER);
    const view = await supplierSchedulesView('HLT-026');
    const po = view!.schedules.find((x) => x.po === 'PO-1078')!;
    expect(po).toMatchObject({ consolidated: true, late: true, invalid: false });
    const delivery = po.activities.find((a) => a.code === 'F20')!;
    expect(delivery.finishSlip).toBeGreaterThan(0);
    expect(delivery.forecastFinish! > '2026-11-06').toBe(true);

    const after = await rescheduleProject('HLT-026', PM.name);
    expect(after.ok).toBe(true);
    const moved = await startOf('A1430');
    expect(moved > a1430).toBe(true);
    expect(moved).toBe(delivery.forecastFinish);
    if (after.ok) expect(after.changed).toContain('A1430');

    // The buyer records the delivery done earlier than forecast: A1430 comes back.
    await recordSupplierProgress('HLT-026', 'PO-1078', 'F10', { actualStart: '2026-09-01', actualFinish: '2026-09-24' }, '2026-09-25', BUYER);
    await recordSupplierProgress('HLT-026', 'PO-1078', 'F20', { actualStart: '2026-09-25', actualFinish: '2026-09-25' }, '2026-09-25', BUYER);
    await rescheduleProject('HLT-026', PM.name);
    expect(await startOf('A1430')).toBe(a1430);
    await expect(recordSupplierProgress('HLT-026', 'PO-1078', 'F20', { actualStart: '2026-09-26' }, '2026-09-25', BUYER)).rejects.toMatchObject({ code: 'actualFuture' });
    expect((await listAudit()).find((x) => x.change.startsWith('supplier activity F20 progress'))).toMatchObject({ object: 'HLT-026 · PO-1078' });
  });

  it('refuses a loop through the supplier schedule and the project, a duplicate and an unknown activity', async () => {
    // A1430 → F10 → F20 → A1430 would loop.
    const loop = await addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F10', activity: 'A1430', direction: 'from_project', lag: 0 }, PM).catch((x) => x);
    expect(loop).toBeInstanceOf(SupplierScheduleError);
    expect(loop.code).toBe('cycle');
    await expect(addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F20', activity: 'A1430', direction: 'to_project', lag: 3 }, PM)).rejects.toMatchObject({ code: 'duplicate' });
    // A1610 follows A1430 in the project's logic: A1610 → F10 → F20 → A1430 → … → A1610.
    const e = await addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F10', activity: 'A1610', direction: 'from_project', lag: 0 }, PM).catch((x) => x);
    expect(e).toBeInstanceOf(SupplierScheduleError);
    expect(e.code).toBe('cycle');
    expect(e.cycle.length).toBeGreaterThan(2);
    const l = await addSupplierLink('HLT-026', 'PO-1078', { pred: 'F20', succ: 'F10', type: 'FS', lag: 0 }, BUYER).catch((x) => x);
    expect(l).toMatchObject({ code: 'cycle' });
    await expect(addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F99', activity: 'A1430', direction: 'to_project', lag: 0 }, PM)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('shows the tied schedule in the Gantt’s « Suppliers » band, read-only, with the supplier’s commitment as baseline', async () => {
    const g = await getGanttNetwork('HLT-026');
    expect(g!.packages.filter((p) => p.supplier).map((p) => p.code)).toEqual(['PO-1078']);
    const f20 = g!.activities.find((a) => a.id === 'PO-1078/F20')!;
    expect(f20).toMatchObject({ source: 'PO-1078', wbs: 'PO-1078', baselineFinish: '2026-11-06', finishActual: true, codes: { purchase_package: ['PO-1078'] } });
    expect(g!.links).toContainEqual({ pred: 'PO-1078/F20', succ: 'A1430', type: 'FS', lag: 0 });
    // The untied PO-1082 schedule is not in the band.
    expect(g!.activities.some((a) => a.source === 'PO-1082')).toBe(false);
  });

  it('the plan trash takes the ties with a removed activity and gives them back', async () => {
    const id = await trashPlanRow('HLT-026', 'act', 'A1430', PM.name);
    expect((await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1078')!.ties).toEqual([]);
    expect(await restorePlanTrash('HLT-026', id!, PM.name)).toMatchObject({ ok: true });
    expect((await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1078')!.ties).toMatchObject([{ supplier: 'F20', activity: 'A1430', direction: 'to_project' }]);
  });

  it('removing a supplier activity removes its ties; untying', async () => {
    await removeSupplierTie('HLT-026', 'PO-1078', 'F20', 'A1430', PM);
    expect((await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1078')!.ties).toEqual([]);
    await addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F20', activity: 'A1430', direction: 'to_project', lag: 0 }, PM);
    await removeSupplierActivity('HLT-026', 'PO-1078', 'F20', BUYER);
    const s = (await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1078')!;
    expect([s.activities.map((a) => a.code), s.ties, s.links]).toEqual([['F10'], [], []]);
  });
});

describe('activity codes (R-204)', () => {
  it('derives the equipment line and the purchasing package', async () => {
    const c = (await getActivityCodes('HLT-026'))!;
    expect(c.types.map((x) => x.key)).toEqual(['equipment', 'purchase_package']);
    expect(c.types[0].values.map((v) => [v.code, v.label])).toEqual([['EQ-01', '1 × EMP'], ['EQ-02', '3 × MEMU']]);
    expect(c.types[1].values.map((v) => v.code)).toEqual(['PO-1041', 'PO-1052', 'PO-1063', 'PO-1071', 'PO-1078', 'PO-1082']);
    // A1430 is needed by two orders.
    expect(c.map.A1430.purchase_package).toEqual(['PO-1078', 'PO-1082']);
    expect(c.map.A1010).toEqual({});
  });

  it('stores types and values, assigns one value per type, sets the equipment line', async () => {
    const zone = await addActivityCodeType('HLT-026', { name: 'Zone', kind: 'custom' }, PM);
    await expect(addActivityCodeType('HLT-026', { name: 'zone' }, PM)).rejects.toMatchObject({ code: 'typeTaken' });
    const site = await addActivityCodeType('HLT-026', { name: 'Site', kind: 'site' }, PM);
    await expect(addActivityCodeType('HLT-026', { name: 'Lieu', kind: 'site' }, PM)).rejects.toMatchObject({ code: 'siteTaken' });
    const z1 = await addActivityCodeValue('HLT-026', zone, { code: 'Z1', label: 'Hall A' }, PM);
    const z2 = await addActivityCodeValue('HLT-026', zone, { code: 'Z2', label: '' }, PM);
    await expect(addActivityCodeValue('HLT-026', zone, { code: 'z1' }, PM)).rejects.toBeInstanceOf(ActivityCodeWriteError);
    await setActivityCode('HLT-026', 'A1250', zone, z1, PM);
    await setActivityCode('HLT-026', 'A1250', zone, z2, PM);
    await setActivityCode('HLT-026', 'A1260', zone, z1, PM);
    await setActivityCode('HLT-026', 'A1250', 'equipment', (await getActivityCodes('HLT-026'))!.types[0].values[1].key, PM);
    await expect(setActivityCode('HLT-026', 'A1250', 'purchase_package', null, PM)).rejects.toMatchObject({ code: 'derived' });
    await expect(setActivityCode('HLT-026', 'A1250', site, z1, PM)).rejects.toMatchObject({ code: 'unknownValue' });
    const c = (await getActivityCodes('HLT-026'))!;
    expect(c.types.map((x) => x.name)).toEqual(['Equipment', 'Purchasing package', 'Zone', 'Site']);
    expect(c.map.A1250).toMatchObject({ [zone]: [z2], equipment: [c.types[0].values[1].key] });
    expect(c.map.A1260[zone]).toEqual([z1]);
    expect((await listAudit()).some((a) => a.change === 'equipment: — → EQ-02')).toBe(true);
    expect((await listAudit()).some((a) => a.change === 'Zone: Z1 → Z2')).toBe(true);
    // Removing a value clears it from the activities.
    await removeActivityCodeValue('HLT-026', z1, PM);
    expect((await getActivityCodes('HLT-026'))!.map.A1260[zone]).toBeUndefined();
  });
});
