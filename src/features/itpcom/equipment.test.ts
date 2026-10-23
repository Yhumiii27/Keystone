// R-185 part 2 (multi-equipment projects, choice 4): one ITP plan per equipment line — the demo data set (Harbor Line's EQ-01
// EMP plan of the prototype and EQ-02 MEMU plan), inspections numbered over the project's plans, "Add inspection" on a line's
// plan, punch items carrying their line (from the source inspection's plan or chosen), commissioning systems grouped by line,
// the plan of a line created / rebuilt / kept with the line (Equipment card), a line with inspections not removed, BOM lines
// moved between lines, machines registered on a line, and the ITP / commissioning screens (selector, column, groups; EN / FR).
// Session and project context are mocked; the viewer is the actor.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
}));

import { eq } from 'drizzle-orm';
import { setBomLineEquipmentAction } from '@/features/bom/actions';
import { flatView } from '@/features/bom/model';
import { DEFAULT_BOM_STATE } from '@/features/bom/links';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { itpPlanSystems, itpPlans, machines } from '@/server/db/schema';
import { getProjectBom } from '@/server/dal/bom';
import { getCommissioning, listSatSystems } from '@/server/dal/commissioning';
import { machineConfigurations, registerDeliveredMachines } from '@/server/dal/fleet';
import { addPunchItem, getItpInspection, getItpPlan, getItpPlans, listItpSystems, listPunchItems } from '@/server/dal/itp';
import { listAudit } from '@/server/dal/notifications';
import { addProjectEquipment, listProjectEquipments, removeProjectEquipment, updateProjectEquipment } from '@/server/dal/project-equipment';
import { addInspectionAction, addPunchItemAction, recordInspectionResultAction } from './actions';
import { commissioningScreenView, itpScreenView } from './model';

const HLT = 'HLT-026';
const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const lines = async (code: string) => (await listProjectEquipments(code)).map((l) => ({ ref: l.ref, label: l.ref === 'EQ-01' ? `EQ-01 · ${l.typeLabel}` : `${l.ref} · ${l.quantity} × ${l.typeLabel}`, position: l.position }));

describe('multi-equipment ITP, punch list, commissioning, BOM and installed base (R-185 part 2)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    Object.assign(viewer, { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' });
  });

  it('the demo data set: Harbor Line has one plan per line; its main plan is the prototype’s', async () => {
    const plans = await getItpPlans(HLT);
    expect(plans.map((p) => [p.equipment?.ref, p.template, p.inspections.length, p.systems.length])).toEqual([['EQ-01', 'EMP', 13, 6], ['EQ-02', 'MEMU', 2, 5]]);
    // The main line's plan: the screen of before R-185 (13 inspections, 2 custom lines).
    const main = (await getItpPlan(HLT))!;
    expect([main.equipment, main.inspections.length, main.customCount]).toEqual([{ ref: 'EQ-01', label: 'EQ-01 · EMP' }, 13, 2]);
    expect((await getItpPlan(HLT, 'EQ-02'))!.inspections.map((i) => [i.number, i.system, i.result])).toEqual([['I-14', 'Structure', 'passed'], ['I-15', 'Hoist', 'planned']]);
    expect(await getItpPlan(HLT, 'EQ-09')).toBeNull();
    expect(await listItpSystems(HLT, 'EQ-02')).toEqual(['Structure', 'Hoist', 'Travel', 'Electrical', 'Automation']);
    // A single-line project without plan: its type's systems, no plan.
    expect(await getItpPlans('WSA-044')).toEqual([]);
    // Inspections are found in any plan of the project.
    expect((await getItpInspection(HLT, 'I-15'))?.name).toBe('Load test — hoists of modules M1–M3');
    // Punch items: from an inspection → its plan's line; the others common unless chosen.
    const punch = Object.fromEntries((await listPunchItems(HLT)).map((p) => [p.number, p.equipmentRef]));
    expect(punch).toMatchObject({ 'P-01': null, 'P-02': 'EQ-01', 'P-06': null, 'P-09': 'EQ-02' });
    // Commissioning: the prototype's six systems on EQ-01, then EQ-02's; "Blocking A" unchanged for EQ-01.
    const c = (await getCommissioning(HLT))!;
    expect(c.systems.map((s) => [s.name, s.equipmentRef, s.blockingA])).toEqual([
      ['Structure', 'EQ-01', 0], ['Hoist mechanisms', 'EQ-01', 0], ['Travel (gantry)', 'EQ-01', 0], ['Electrical HV/LV', 'EQ-01', 0], ['Automation & safety', 'EQ-01', 0],
      ['Anti-collision', 'EQ-01', 0], ['MEMU modules M1–M3', 'EQ-02', 0],
    ]);
  });

  it('"Add inspection" on a line’s plan: numbered over the project, the line’s systems, unknown lines refused', async () => {
    expect(await addInspectionAction(HLT, { name: 'Brake test', system: 'Hoist mechanisms', type: 'hold', stage: 'fat' }, 'EQ-02')).toEqual({ error: 'Unknown system' });
    expect(await addInspectionAction(HLT, { name: 'Brake test', system: 'Hoist', type: 'hold', stage: 'fat' }, 'EQ-07')).toEqual({ error: 'Unknown equipment line' });
    expect(await addInspectionAction(HLT, { name: 'Brake test — module M1', system: 'Hoist', type: 'hold', stage: 'fat', date: '20 Nov' }, 'EQ-02')).toEqual({ toast: 'Inspection added to the plan' });
    expect(await addInspectionAction(HLT, { name: 'Girder camber', system: 'Structure', type: 'review', stage: 'workshop' })).toEqual({ toast: 'Inspection added to the plan' });
    expect((await getItpPlan(HLT, 'EQ-02'))!.inspections.map((i) => i.number)).toEqual(['I-14', 'I-15', 'I-20']);
    expect((await getItpPlan(HLT))!.inspections.at(-1)!.number).toBe('I-21');
    expect((await listAudit())[0].change).toContain('inspection added · Structure · Girder camber');
    // A result on an EQ-02 inspection (found across the project's plans).
    viewer.role = 'quality';
    viewer.name = 'Gabriel Comte';
    expect(await recordInspectionResultAction(HLT, 'I-20', 'planned', { result: 'passed', date: '25 Sep 2026', inspector: 'S. Haddad', witness: 'N. Bensaïd' }))
      .toEqual({ toast: 'I-20 · Passed · Inspection result recorded' });
  });

  it('"Add punch item": the line chosen, common by default, an unknown line refused; from an inspection, its plan’s line', async () => {
    expect(await addPunchItemAction(HLT, { item: 'Hoist limit switch loose', cat: 'B', equipment: 'EQ-02' })).toEqual({ toast: 'Punch item added' });
    expect(await addPunchItemAction(HLT, { item: 'Fence gate', cat: 'C' })).toEqual({ toast: 'Punch item added' });
    expect(await addPunchItemAction(HLT, { item: 'x', equipment: 'EQ-42' })).toEqual({ error: 'Unknown equipment line' });
    const items = await listPunchItems(HLT);
    expect(items.slice(-2).map((p) => [p.number, p.equipmentRef])).toEqual([['P-10', 'EQ-02'], ['P-11', null]]);
    expect((await listAudit())[1].change).toContain('· EQ-02');
    const n = await addPunchItem(HLT, { description: 'Rope wear', category: 'B', source: 'itp', sourceInspection: 'I-15' }, DIRECTOR);
    expect((await listPunchItems(HLT)).find((p) => p.number === n)).toMatchObject({ equipmentRef: 'EQ-02', sourceText: 'ITP I-15' });
  });

  it('the ITP screen: one line → the screen of before R-185; several → selector, plan title, Equipment column and filter (EN / FR)', async () => {
    const eqLines = await lines(HLT);
    const punch = await listPunchItems(HLT);
    const base = { code: HLT, punch, machineType: 'EMP', today: '2026-09-25' };
    const single = itpScreenView({ ...base, view: 'plan', plan: await getItpPlan(HLT) }, makeT('en'), 'en');
    expect([single.equipment, single.plan!.title]).toEqual([null, 'Inspection & test plan']);
    const plan = itpScreenView({ ...base, view: 'plan', plan: await getItpPlan(HLT, 'EQ-02'), equipment: { lines: eqLines, selected: 'EQ-02' } }, makeT('en'), 'en');
    expect(plan.equipment!.options.map((o) => [o.value, o.href])).toEqual([['EQ-01', '/projects/HLT-026/itp'], ['EQ-02', '/projects/HLT-026/itp?equipment=EQ-02']]);
    expect(plan.plan!.title).toBe('Inspection & test plan · EQ-02 · 3 × MEMU');
    expect(plan.kpis[0].value).toBe('2 / 3');
    const list = itpScreenView({ ...base, view: 'punch', plan: null, equipment: { lines: eqLines, selected: null, filter: 'EQ-02' } }, makeT('fr'), 'fr');
    expect(list.punch!.equipment).toBe(true);
    expect(list.punch!.rows.map((r) => [r.number, r.equipment])).toEqual([['P-09', 'EQ-02'], ['P-10', 'EQ-02'], ['P-12', 'EQ-02']]);
    expect(list.equipment!.options.map((o) => o.label)).toEqual(['Tous', 'EQ-01 · EMP', 'EQ-02 · 3 × MEMU', 'Commun au projet']);
    expect(list.equipment!.options[3].href).toBe('/projects/HLT-026/itp?view=punch&equipment=common');
    const common = itpScreenView({ ...base, view: 'punch', plan: null, equipment: { lines: eqLines, selected: null, filter: 'common' } }, makeT('fr'), 'fr');
    expect(common.punch!.rows.every((r) => r.equipment === 'Commun')).toBe(true);
    // Commissioning: grouped by line when there are several (FR).
    const c = commissioningScreenView(HLT, await getCommissioning(HLT), punch, '2026-09-25', makeT('fr'), 'fr')!;
    expect(c.groups.map((g) => [g.label, g.rows.length])).toEqual([['EQ-01 · EMP', 6], ['EQ-02 · 3 × MEMU', 1]]);
    expect(c.rows).toHaveLength(7);
    // "Plan SAT" without commissioning plan: every line's template systems, each once.
    expect(await listSatSystems('WSA-044')).toEqual(['Track', 'Switches', 'Signalling', 'Electrical']);
  });

  it('a line’s plan follows the line: created with it, rebuilt on a type change while empty, kept with inspections', async () => {
    const db = await getDb();
    const ref = await addProjectEquipment('WSA-044', { machineTypeCode: 'EMP', quantity: '1' }, DIRECTOR);
    expect(ref).toBe('EQ-02');
    const planOf = async (r: string) => (await getItpPlans('WSA-044')).find((p) => p.equipment?.ref === r);
    expect((await planOf('EQ-02'))!.systems).toEqual(['Structure', 'Hoist mechanisms', 'Travel (gantry)', 'Electrical HV/LV', 'Automation & safety', 'Anti-collision']);
    await updateProjectEquipment('WSA-044', 'EQ-02', { machineTypeCode: 'MEMU', quantity: '2' }, DIRECTOR);
    expect([(await planOf('EQ-02'))!.template, (await planOf('EQ-02'))!.systems]).toEqual(['MEMU', ['Structure', 'Hoist', 'Travel', 'Electrical', 'Automation']]);
    // With an inspection: the type change keeps the plan, the removal is refused.
    expect(await addInspectionAction('WSA-044', { name: 'Frame check', system: 'Structure', type: 'review', stage: 'workshop' }, 'EQ-02')).toEqual({ toast: 'Inspection added to the plan' });
    await updateProjectEquipment('WSA-044', 'EQ-02', { machineTypeCode: 'SPUR', quantity: '2' }, DIRECTOR);
    expect((await planOf('EQ-02'))!.template).toBe('MEMU');
    await expect(removeProjectEquipment('WSA-044', 'EQ-02', DIRECTOR)).rejects.toThrow('This equipment line has inspections in its inspection plan');
    // A line without inspection goes with its plan; its punch item becomes common; the audit counts what was detached.
    const ref3 = await addProjectEquipment('WSA-044', { machineTypeCode: 'AUTRE', quantity: '1' }, DIRECTOR);
    const item = await addPunchItem('WSA-044', { description: 'Missing bolt', category: 'C', source: 'site_walk', equipment: ref3 }, DIRECTOR);
    const plansBefore = (await db.select({ id: itpPlans.id }).from(itpPlans)).length;
    await removeProjectEquipment('WSA-044', ref3, DIRECTOR);
    expect((await db.select({ id: itpPlans.id }).from(itpPlans)).length).toBe(plansBefore - 1);
    expect((await listPunchItems('WSA-044')).find((p) => p.number === item)!.equipmentRef).toBeNull();
    const [audit] = await listAudit();
    expect(audit.change).toBe(`Equipment ${ref3} removed · 1 × AUTRE`);
    // The frozen systems of the removed plan went with it (cascade).
    const planIds = new Set((await db.select({ id: itpPlans.id }).from(itpPlans)).map((r) => r.id));
    expect((await db.select({ p: itpPlanSystems.planId }).from(itpPlanSystems)).every((r) => planIds.has(r.p))).toBe(true);
  });

  it('BOM lines: moved between lines (editors only), filtered and shown when the project has several lines', async () => {
    const before = (await getProjectBom(HLT))!;
    const ref = before.lines[0].ref;
    expect(before.lines.every((l) => l.equipmentRef === null)).toBe(true);
    viewer.canEdit = false;
    expect(await setBomLineEquipmentAction(HLT, ref, 'EQ-02')).toEqual({ error: 'This project BOM is read-only for you' });
    viewer.canEdit = true;
    expect(await setBomLineEquipmentAction(HLT, ref, 'EQ-09')).toEqual({ error: 'Unknown equipment line' });
    expect(await setBomLineEquipmentAction(HLT, 'NOPE-1', 'EQ-02')).toEqual({ error: 'Unknown article' });
    expect(await setBomLineEquipmentAction(HLT, ref, 'EQ-02')).toEqual({ toast: 'Equipment saved' });
    expect((await listAudit())[0].change).toBe(`${ref} · equipment: common → EQ-02`);
    const bom = (await getProjectBom(HLT))!;
    expect(bom.lines.find((l) => l.ref === ref)!.equipmentRef).toBe('EQ-02');
    const eqLines = await lines(HLT);
    const v = flatView(HLT, { ...DEFAULT_BOM_STATE, eq: 'EQ-02' }, bom.lines, makeT('en'), 'en', true, { lines: eqLines, canEdit: true });
    expect(v.rows.map((r) => [r.ref, r.equipment])).toEqual([[ref, { value: 'EQ-02', label: 'EQ-02' }]]);
    expect(v.equipment!.choices!.map((c) => c.value)).toEqual(['common', 'EQ-01', 'EQ-02']);
    expect(v.equipment!.options.find((o) => o.active)!.value).toBe('EQ-02');
    // Without equipment option (single line, or the golden render): no column, no filter.
    expect(flatView(HLT, DEFAULT_BOM_STATE, bom.lines, makeT('en'), 'en').equipment).toBeUndefined();
    expect(await setBomLineEquipmentAction(HLT, ref, 'common')).toEqual({ toast: 'Equipment saved' });
  });

  it('machines registered on a line take its type and its BOM lines with the common ones', async () => {
    const db = await getDb();
    await addProjectEquipment('RCF-019', { machineTypeCode: 'SPUR', quantity: '2' }, DIRECTOR);
    const bom = (await getProjectBom('RCF-019'))!;
    // One tracked part belongs to EQ-01 only: left out of EQ-02's as-built configuration.
    await setBomLineEquipmentAction('RCF-019', bom.lines.find((l) => l.revision)!.ref, 'EQ-01');
    await expect(registerDeliveredMachines('RCF-019', { count: 1, name: 'x', site: '', deliveredOn: '2026-09-25', warrantyEndOn: '2028-09-24', equipment: 'EQ-07' }, DIRECTOR))
      .rejects.toThrow(/Unknown equipment/);
    const [n] = await registerDeliveredMachines('RCF-019', { count: 1, name: 'Track system', site: '', deliveredOn: '2026-09-25', warrantyEndOn: '2028-09-24', equipment: 'EQ-02' }, DIRECTOR);
    const [m] = await db.select().from(machines).where(eq(machines.number, n));
    const eq2 = (await listProjectEquipments('RCF-019')).find((l) => l.ref === 'EQ-02')!;
    expect([m.machineTypeCode, m.equipmentId]).toEqual(['SPUR', eq2.id]);
    const [main] = await registerDeliveredMachines('RCF-019', { count: 1, name: 'Crane', site: '', deliveredOn: '2026-09-25', warrantyEndOn: '2028-09-24' }, DIRECTOR);
    const [mm] = await db.select().from(machines).where(eq(machines.number, main));
    expect(mm.machineTypeCode).toBe('MEMU');
    // The main line's machine has every tracked part; EQ-02's leaves out the part of EQ-01.
    const cfg = await machineConfigurations([n, main]);
    expect(cfg.get(main)!.length - cfg.get(n)!.length).toBe(1);
  });
});
