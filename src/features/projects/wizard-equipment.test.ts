// R-185 (choices 2 and 3 of 23 Oct 2026): the New project wizard with several equipment lines, against an in-memory database —
// the lines validated and stored (EQ-01 = the main type, projects.machine_type_code), the lots specific to an equipment
// generated per line from its type's phases and marked with their line (wbs_nodes / activities.equipment_id), the common phases
// once, the ITP plan of the main type; the reference categories of the lines (type budget × quantity).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'pm' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { asc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { activities, itpPlans, projectEquipments, projects, wbsNodes } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getProject } from '@/server/dal/projects';
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import { createProjectAction, type NewProjectDraft } from './actions';
import { draftCategories, draftLines, draftPlanShape, defaultDraft } from './new-project-wizard';

const draft = (patch: Partial<NewProjectDraft> = {}): NewProjectDraft => ({
  name: 'Quay 6 handling', client: 'Port authority', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP',
  cats: [{ name: 'Études', type: 'Labor', budget: '160' }], cont: 5, cal: 'standard_5x8_workshop', pm: null, start: '2027-01-11', finish: '',
  city: 'Le Havre', country: 'France',
  ...patch,
});

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('wizard with several equipment lines (R-185)', () => {
  it('validates the lines: known types, whole quantities 1–999, the first one of the main type', async () => {
    expect(await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 1 }, { mt: 'XYZ', qty: 1 }] }))).toEqual({ ok: false, error: 'Choose the machine type among the proposed types' });
    expect(await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 0 }] }))).toEqual({ ok: false, error: 'The quantity is a whole number from 1 to 999' });
    expect(await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 2.5 }] }))).toEqual({ ok: false, error: 'The quantity is a whole number from 1 to 999' });
    expect(await createProjectAction(draft({ lines: [{ mt: 'MEMU', qty: 1 }] }))).toEqual({ ok: false, error: 'Invalid project setup' });
    expect(await createProjectAction(draft({ lines: [] }))).toEqual({ ok: false, error: 'Invalid project setup' });
    expect(await createProjectAction(draft({ lines: 'EMP' as unknown as NewProjectDraft['lines'] }))).toEqual({ ok: false, error: 'Invalid project setup' });
  });

  it('1 × EMP + 3 × MEMU: the lines stored, common phases once, the lots specific to an equipment per line and marked', async () => {
    const r = await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 1 }, { mt: 'MEMU', qty: 3 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = await getDb();
    const [p] = await db.select({ id: projects.id, mt: projects.machineTypeCode }).from(projects).where(eq(projects.code, r.code));
    expect(p.mt).toBe('EMP');
    const lines = await listProjectEquipments(r.code);
    expect(lines.map((l) => [l.ref, l.machineTypeCode, l.quantity, l.position])).toEqual([['EQ-01', 'EMP', 1, 0], ['EQ-02', 'MEMU', 3, 1]]);
    expect((await getProject(r.code))?.equipment).toBe('1 × EMP · 3 × MEMU');

    const byId = new Map(lines.map((l) => [l.id, l.ref]));
    const wbs = await db.select({ code: wbsNodes.code, name: wbsNodes.name, eq: wbsNodes.equipmentId }).from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position));
    expect(wbs.map((w) => [w.code, w.name, w.eq ? byId.get(w.eq) : null])).toEqual([
      ['1', 'Quay 6 handling', null],
      ['1.1', 'Études & approvisionnements longs', null],
      ['1.2', 'Fabrication structure — EQ-01 · EMP', 'EQ-01'],
      ['1.3', 'Montage mécanique — EQ-01 · EMP', 'EQ-01'],
      ['1.4', 'Installation électrique & automatisme — EQ-01 · EMP', 'EQ-01'],
      ['1.5', 'Fabrication modules — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.6', 'Assemblage & câblage — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.7', 'Essais plateforme — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.8', 'Essais & mise en service', null],
      ['1.9', 'Réception & transfert', null],
    ]);
    const acts = await db.select({ code: activities.code, eq: activities.equipmentId, start: activities.startDate }).from(activities).where(eq(activities.projectId, p.id)).orderBy(asc(activities.code));
    expect(acts.map((a) => (a.eq ? byId.get(a.eq) : null))).toEqual([null, 'EQ-01', 'EQ-01', 'EQ-01', 'EQ-02', 'EQ-02', 'EQ-02', null, null]);
    // The two lines run in parallel after the common studies.
    expect(acts[1].start).toBe(acts[4].start);
    // ITP (R-185 part 2, choice 4): one plan per line — the main line's from the template, EQ-02's from MEMU.
    const plans = await db.select({ mt: itpPlans.machineTypeCode, eq: itpPlans.equipmentId }).from(itpPlans).where(eq(itpPlans.projectId, p.id));
    expect(plans.map((x) => [x.eq ? byId.get(x.eq) : null, x.mt]).sort()).toEqual([['EQ-01', 'EMP'], ['EQ-02', 'MEMU']]);
  });

  it('without lines: one line of the main type, the plan before R-185', async () => {
    const r = await createProjectAction(draft({ name: 'Single crane', mt: 'SPUR', template: 'SPUR' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await listProjectEquipments(r.code)).map((l) => [l.ref, l.machineTypeCode, l.quantity])).toEqual([['EQ-01', 'SPUR', 1]]);
    expect((await getProject(r.code))?.equipment).toBe('SPUR');
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, r.code));
    const wbs = await db.select({ name: wbsNodes.name }).from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position));
    expect(wbs.slice(1).map((w) => w.name)).toEqual(['Études & permis', 'Génie civil', 'Structures & supports', 'Équipements électriques', 'Raccordement & essais', 'Mise en service']);
    // A blank template keeps its line (the project has a machine type) and no plan.
    const blank = await createProjectAction(draft({ name: 'Blank one', template: 'blank', lines: [{ mt: 'EMP', qty: 2 }] }));
    expect(blank.ok && (await listProjectEquipments(blank.code)).map((l) => l.quantity)).toEqual([2]);
    expect(await db.select({ n: projectEquipments.id }).from(projectEquipments).innerJoin(projects, eq(projects.id, projectEquipments.projectId)).where(eq(projects.name, 'Blank one'))).toHaveLength(1);
  });

  it('the wizard draft: lines, reference categories × quantity, the plan counted before creation', async () => {
    const setup = await getNewProjectSetup();
    expect(setup.templates.find((t) => t.id === 'EMP')?.perEquipmentPhases).toEqual(['Fabrication structure', 'Montage mécanique', 'Installation électrique & automatisme']);
    const d = { ...defaultDraft('2026-09-25'), lines: [{ mt: 'EMP', qty: 1 }, { mt: 'MEMU', qty: 3 }] };
    expect(draftLines({ mt: 'EMP', lines: null })).toEqual([{ mt: 'EMP', qty: 1 }]);
    // The main type always leads.
    expect(draftLines({ mt: 'SPUR', lines: [{ mt: 'EMP', qty: 2 }] })).toEqual([{ mt: 'SPUR', qty: 2 }]);
    const cats = draftCategories(setup, d);
    const total = cats.reduce((a, c) => a + parseFloat(c.budget), 0);
    // EMP 1 940 k + 3 × MEMU 1 130 k.
    expect(total).toBe(1940 + 3 * 1130);
    expect(cats.find((c) => c.name === 'Études')).toEqual({ name: 'Études', type: 'Labor', budget: String(160 + 3 * 120) });
    // One line of one machine: the template's categories as before R-185.
    expect(draftCategories(setup, { ...d, lines: null })).toEqual(setup.templates.find((t) => t.id === 'EMP')!.cats);
    expect(draftPlanShape(setup, d)).toEqual({ packages: 9, activities: 9, links: 9 });
    expect(draftPlanShape(setup, { ...d, lines: null })).toEqual({ packages: 6, activities: 6, links: 5 });
  });
});

describe('wizard lines referencing the machine catalogue (R-186)', () => {
  it('offers the published versions with their type; a line takes one of its type, stored with its code and version', async () => {
    const setup = await getNewProjectSetup({ name: 'Romain Aubert', role: 'pm' });
    expect(setup.catalogue.map((c) => [c.value, c.mt])).toEqual([['EMP-40T@1', 'EMP'], ['MEMU-16@1', 'MEMU']]);
    expect(await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 1, cat: 'MEMU-16@1' }] }))).toEqual({ ok: false, error: 'Unknown catalogue entry' });
    // A draft version (EMP-40T v2) is not offered.
    expect(await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 1, cat: 'EMP-40T@2' }] }))).toEqual({ ok: false, error: 'Unknown catalogue entry' });
    const r = await createProjectAction(draft({ lines: [{ mt: 'EMP', qty: 1, cat: 'EMP-40T@1' }, { mt: 'MEMU', qty: 2, cat: '' }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await listProjectEquipments(r.code)).map((l) => [l.ref, l.catalogueCode, l.catalogueVersion])).toEqual([['EQ-01', 'EMP-40T', 1], ['EQ-02', null, null]]);
  });
});
