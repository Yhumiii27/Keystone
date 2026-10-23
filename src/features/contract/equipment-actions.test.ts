// R-185: the "Equipment" card of the Contract screen — the Server Functions' rights (the director and the project's leads, not
// Finance nor a team member, never on a read-only project), validation, the writes with their audit rows and activity events,
// the main type kept in sync (projects.machine_type_code = the first line's), the last line kept, the planning lots of a removed
// line left common to the project; the demo data set's multi-equipment project and the card (EN / FR). Session and project
// context are mocked; the viewer is the actor.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lead: true, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, canEdit: () => viewer.edit }),
}));

import { eq } from 'drizzle-orm';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { activities, itpInspections, itpPlans, projects, wbsNodes } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { listMachineTypeOptions } from '@/server/dal/mtypes';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getRexPattern } from '@/server/dal/budget';
import { listProjectEquipments, type EquipmentLine } from '@/server/dal/project-equipment';
import { getProject, listProjects } from '@/server/dal/projects';
import { addEquipmentAction, removeEquipmentAction, updateEquipmentAction, type EquipmentLineDraft } from './actions';
import { EquipmentCard } from './equipment-card';

const line = (patch: Partial<EquipmentLineDraft> = {}): EquipmentLineDraft => ({
  machineTypeCode: 'SPUR', quantity: '2', label: '', capacityValue: '', capacityUnit: '', options: '', besoinRef: '', ...patch,
});
const REFUSED = { error: 'Only the project’s leads and the director change its equipment' };
const mainType = async (code: string) => {
  const db = await getDb();
  return (await db.select({ mt: projects.machineTypeCode }).from(projects).where(eq(projects.code, code)))[0]?.mt;
};
const card = async (lang: Lang, canEdit: boolean, lines: EquipmentLine[]) =>
  renderToStaticMarkup(h(I18nProvider, {
    lang, children: h(EquipmentCard, { lines, code: 'HLT-026', canEdit, types: await listMachineTypeOptions(), context: '#026 · Harbor Line', t: makeT(lang), lang }),
  }));

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('equipment lines in the demo data set (R-185)', () => {
  it('every typed project has EQ-01 of its type; Harbor Line supplies its EMP and three MEMU', async () => {
    expect((await listProjectEquipments('HLT-026')).map((l) => [l.ref, l.typeLabel, l.quantity])).toEqual([['EQ-01', 'EMP', 1], ['EQ-02', 'MEMU', 3]]);
    expect((await listProjectEquipments('RCF-019')).map((l) => [l.ref, l.typeLabel, l.quantity])).toEqual([['EQ-01', 'MEMU', 1]]);
    const rows = await listProjects();
    expect(Object.fromEntries(rows.filter((p) => p.machineType).map((p) => [p.code, p.equipment]))).toEqual({
      'HLT-026': '1 × EMP · 3 × MEMU', 'NDC-031': 'AUTRE', 'RCF-019': 'MEMU', 'ERP-202': 'R&D', 'WSA-044': 'SPUR', 'MSR-012': 'MEMU',
    });
    // The main type stays the first line's; the projects without type have no line.
    expect((await getProject('HLT-026'))?.machineType).toBe('EMP');
    expect(rows.filter((p) => !p.machineType).every((p) => p.equipment == null)).toBe(true);
    // Budget › Cost profile: the main type's REX pattern, plus the references of the other type.
    const rex = await getRexPattern('HLT-026');
    expect(rex?.mt).toBe('EMP');
    expect(rex?.others?.map((o) => o.mt)).toEqual(['MEMU']);
    expect((await getRexPattern('RCF-019'))?.others).toBeUndefined();
  });
});

describe('equipment Server Functions (R-185)', () => {
  it('refuses Finance, a team member who is not a lead, and a read-only project', async () => {
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false, edit: true });
    expect(await addEquipmentAction('WSA-044', line())).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Romain Aubert', role: 'member', lead: false });
    expect(await removeEquipmentAction('HLT-026', 'EQ-02')).toEqual(REFUSED);
    Object.assign(viewer, { role: 'pm', lead: true, edit: false });
    expect(await updateEquipmentAction('HLT-026', 'EQ-02', line())).toEqual(REFUSED);
    Object.assign(viewer, { role: 'client', lead: true, edit: true });
    expect(await addEquipmentAction('HLT-026', line())).toEqual(REFUSED);
    expect((await listProjectEquipments('HLT-026'))).toHaveLength(2);
  });

  it('validates the input', async () => {
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: true });
    expect(await addEquipmentAction('WSA-044', line({ machineTypeCode: 'XYZ' }))).toEqual({ error: 'Choose the machine type among the proposed types' });
    expect(await addEquipmentAction('WSA-044', line({ quantity: '0' }))).toEqual({ error: 'The quantity is a whole number from 1 to 999' });
    expect(await addEquipmentAction('WSA-044', line({ capacityValue: '40' }))).toEqual({ error: 'Enter the unit of the target capacity' });
    expect(await addEquipmentAction('WSA-044', line({ besoinRef: 'B01' }))).toEqual({ error: 'The machine need follows the CAPEX application’s format (CPX-SAI-2026-01/B01)' });
    expect(await addEquipmentAction('NOPE-000', line())).toEqual({ error: 'Unknown project' });
    expect(await updateEquipmentAction('WSA-044', 'EQ-09', line())).toEqual({ error: 'Unknown equipment line' });
    expect(await updateEquipmentAction('WSA-044', 'drop table', line())).toEqual({ error: 'Invalid request' });
    expect(await addEquipmentAction(42 as unknown as string, line())).toEqual({ error: 'Invalid request' });
  });

  it('adds, edits and removes a line: audited, in the activity feed, the main type in sync, the last line kept', async () => {
    expect(await addEquipmentAction('WSA-044', line({ machineTypeCode: 'EMP', label: 'Portique quai 6', capacityValue: '40', capacityUnit: 't', options: 'Cabine, Radio', besoinRef: 'cpx-sai-2026-01/b03' }))).toEqual({ ok: true });
    const added = await listProjectEquipments('WSA-044');
    expect(added.map((l) => [l.ref, l.machineTypeCode, l.quantity, l.label, l.capacityValue, l.capacityUnit, l.options, l.besoinRef])).toEqual([
      ['EQ-01', 'SPUR', 1, null, null, null, [], null],
      ['EQ-02', 'EMP', 2, 'Portique quai 6', 40, 't', ['Cabine', 'Radio'], 'CPX-SAI-2026-01/B03'],
    ]);
    expect((await listAudit())[0]).toMatchObject({ object: 'WSA-044 · EQ-02', change: 'Equipment EQ-02 added · 2 × EMP · Portique quai 6' });
    expect((await listActivity()).some((e) => e.what === 'Equipment EQ-02 added · 2 × EMP · Portique quai 6')).toBe(true);
    expect((await getProject('WSA-044'))?.equipment).toBe('1 × SPUR · 2 × EMP');

    // Edit the first line's type: the main type follows.
    expect(await updateEquipmentAction('WSA-044', 'EQ-01', line({ machineTypeCode: 'AUTRE', quantity: '1' }))).toEqual({ ok: true });
    expect(await mainType('WSA-044')).toBe('AUTRE');
    expect((await listAudit())[0]).toMatchObject({ change: 'Equipment EQ-01: 1 × SPUR → 1 × AUTRE' });
    // No change → no audit row.
    const n = (await listAudit()).length;
    expect(await updateEquipmentAction('WSA-044', 'EQ-01', line({ machineTypeCode: 'AUTRE', quantity: '1' }))).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);

    // Remove the first line: EQ-02 becomes the main one; the last line is kept.
    Object.assign(viewer, { name: 'Hélène Marchetti', role: 'director', lead: false });
    expect(await removeEquipmentAction('WSA-044', 'EQ-01')).toEqual({ ok: true });
    expect(await mainType('WSA-044')).toBe('EMP');
    expect((await listAudit())[0]).toMatchObject({ change: 'Equipment EQ-01 removed · 1 × AUTRE' });
    expect(await removeEquipmentAction('WSA-044', 'EQ-02')).toEqual({ error: 'A project keeps at least one equipment line' });
    // The next reference follows the highest in use.
    expect(await addEquipmentAction('WSA-044', line({ machineTypeCode: 'MEMU', quantity: '1' }))).toEqual({ ok: true });
    expect((await listProjectEquipments('WSA-044')).map((l) => l.ref)).toEqual(['EQ-02', 'EQ-03']);
  });

  it('a removed line’s planning lots stay, common to the project', async () => {
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: true });
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const [eq2] = (await listProjectEquipments('HLT-026')).filter((l) => l.ref === 'EQ-02');
    const [lot] = await db.select({ id: wbsNodes.id }).from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).limit(1);
    const [act] = await db.select({ id: activities.id }).from(activities).where(eq(activities.projectId, p.id)).limit(1);
    await db.update(wbsNodes).set({ equipmentId: eq2.id }).where(eq(wbsNodes.id, lot.id));
    await db.update(activities).set({ equipmentId: eq2.id }).where(eq(activities.id, act.id));
    // R-185 part 2: EQ-02's ITP plan has inspections (demo data) — the line is kept until they are gone.
    expect(await removeEquipmentAction('HLT-026', 'EQ-02')).toEqual({ error: 'This equipment line has inspections in its inspection plan' });
    const [plan] = await db.select({ id: itpPlans.id }).from(itpPlans).where(eq(itpPlans.equipmentId, eq2.id));
    await db.delete(itpInspections).where(eq(itpInspections.planId, plan.id));
    expect(await removeEquipmentAction('HLT-026', 'EQ-02')).toEqual({ ok: true });
    expect(await db.select({ id: itpPlans.id }).from(itpPlans).where(eq(itpPlans.id, plan.id))).toEqual([]);
    expect((await db.select({ e: wbsNodes.equipmentId }).from(wbsNodes).where(eq(wbsNodes.id, lot.id)))[0].e).toBeNull();
    expect((await db.select({ e: activities.equipmentId }).from(activities).where(eq(activities.id, act.id)))[0].e).toBeNull();
    expect((await getProject('HLT-026'))?.equipment).toBe('EMP');
  });

  it('the card: the lines for everyone, the buttons for the leads only (EN / FR)', async () => {
    const lines = await listProjectEquipments('WSA-044');
    const fr = await card('fr', true, lines);
    expect(fr).toContain('Équipement');
    expect(fr).toContain('Ajouter une ligne d’équipement');
    expect(fr).toContain('type principal');
    expect(fr).toContain('2 × EMP');
    expect(fr).toContain('Portique quai 6');
    expect(fr).toContain('40 t');
    expect(fr).toContain('CPX-SAI-2026-01/B03');
    const ro = await card('en', false, lines);
    expect(ro).toContain('2 × EMP · 1 × MEMU · 3 machines');
    expect(ro).not.toContain('Add equipment line');
    expect(ro).not.toContain('Remove');
    expect(await card('en', true, [])).toContain('No equipment line');
  });
});
