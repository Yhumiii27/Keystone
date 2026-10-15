// Chapter 4 — Settings-driven modules, the one health rule and the New project wizard against an in-memory database
// (A-13, A-14, A-2 / L-3, budget categories). Rules: src/domain/settings-rules.ts, src/domain/health.ts,
// src/domain/project-template.ts.
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRegisterModel } from '@/features/projects/register-model';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityLinks, auditEntries, itpPlans, persons, projects, wbsNodes } from '@/server/db/schema';
import { addProjectCostCategory, nextCategoryCode, updateProjectCostCategory } from './budget-categories';
import { getCostControl } from './cost';
import { getSkillsMatrix, addSkill, listPublicHolidays } from './hr';
import { createMachineType } from './mtypes';
import { getPlanData } from './plan';
import { getPortfolioOverview } from './portfolio';
import { getProject, listProjects } from './projects';
import { createWizardProject, getNewProjectSetup, getRegisterData, missingDeliverables, setDeliverableAndAdvance } from './projects-register';
import { createRisk, getRiskRegister, listRisks } from './risks';
import { addReferenceValue, removeReferenceValue, setHealthThresholds, resetSettings } from './settings';
import { costCategoryOptions, inactiveStageCodes, riskCategoryOptions, settingsHolidayRows } from './settings-lists';
import { listStages } from './lifecycle';

const DIRECTOR = { role: 'director', name: 'Marie Lefebvre' };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('A-13 — one health rule with the Settings thresholds', () => {
  it('the register, the header and the Overview give the same verdict and follow the thresholds', async () => {
    const health = async () => Object.fromEntries((await listProjects()).filter((p) => p.hasData).map((p) => [p.code, p.health]));
    // Delivery 7 (R-073, C-2a): progress, actual cost and SPI come from the activities and the BL1 baseline, no longer the seeded
    // figures — HLT-026 min(CPI 0.89, SPI 0.82) = 0.82 (was 0.90) → off track (was at risk); NDC-031 SPI 0.96 → at risk (was on
    // track); RCF-019 min(0.97, 0.91) → at risk (was off track at 0.84).
    expect(await health()).toMatchObject({ 'HLT-026': 'off_track', 'RCF-019': 'at_risk', 'NDC-031': 'at_risk' });
    const overview = await getPortfolioOverview(null, 'en');
    for (const r of overview.rows) expect([r.code, r.metrics.health]).toEqual([r.code, r.health]);
    // HLT-026: 0.82 → on track once "At risk below" is 0.80 (off track below 0.75).
    await setHealthThresholds({ off: 0.75 }, DIRECTOR);
    await setHealthThresholds({ risk: 0.8 }, DIRECTOR);
    expect((await getProject('HLT-026'))!.health).toBe('on_track');
    expect((await getPortfolioOverview(null, 'en')).rows.find((r) => r.code === 'HLT-026')!.metrics.health).toBe('on_track');
    await resetSettings(DIRECTOR);
    expect((await getProject('HLT-026'))!.health).toBe('off_track');
  });
});

describe('A-14 — Settings lists drive the modules', () => {
  it('risk categories: a Settings category is offered, stored and labelled; removing it deactivates it while in use', async () => {
    expect(await addReferenceValue('riskCats', 'Cyber security', DIRECTOR)).toBe('cyber_security');
    expect((await riskCategoryOptions()).active.map((c) => c.code)).toContain('cyber_security');
    const id = await createRisk('HLT-026', { title: 'Ransomware on the SCADA', category: 'cyber_security', response: 'mitigate' }, 'Romain Aubert');
    expect((await listRisks('HLT-026')).find((r) => r.id === id)).toMatchObject({ category: 'cyber_security', categoryLabel: 'Cyber security' });
    expect((await getRiskRegister('HLT-026'))!.categories.find((c) => c.code === 'cyber_security')).toMatchObject({ label: 'Cyber security', count: 1 });
    expect(await removeReferenceValue('riskCats', 'cyber_security', DIRECTOR)).toEqual({ label: 'Cyber security', mode: 'deactivated', inUse: 1 });
    expect((await riskCategoryOptions()).active.map((c) => c.code)).not.toContain('cyber_security');
    expect((await listRisks('HLT-026')).find((r) => r.id === id)!.categoryLabel).toBe('Cyber security');
    expect(await addReferenceValue('riskCats', 'Drone delivery', DIRECTOR)).toBe('drone_delivery');
    expect(await removeReferenceValue('riskCats', 'drone_delivery', DIRECTOR)).toEqual({ label: 'Drone delivery', mode: 'deleted', inUse: 0 });
  });

  it('skills: a Settings skill is a matrix column; a removed one in use is hidden (levels kept); HR "Add skill" feeds Settings', async () => {
    await addReferenceValue('skills', 'Welding', DIRECTOR);
    expect((await getSkillsMatrix()).skills.map((s) => s.name)).toContain('Welding');
    expect(await removeReferenceValue('skills', 'structural', DIRECTOR)).toMatchObject({ mode: 'deactivated' });
    expect((await getSkillsMatrix()).skills.map((s) => s.name)).not.toContain('Structural');
    await addSkill({ name: 'Rigging' }, 'Marie Lefebvre');
    expect((await addReferenceValue('skills', 'rigging', DIRECTOR).catch((e: Error) => e.message))).toBe('"rigging" is already in the list');
    await addReferenceValue('skills', 'Structural', DIRECTOR);
    expect((await getSkillsMatrix()).skills.map((s) => s.name)).toContain('Structural');
  });

  it('holidays: the leave calendar and the work calendars read Settings › Public holidays', async () => {
    const fr = await listPublicHolidays();
    expect(fr).toHaveLength(11);
    expect(fr.find((h) => h.date === '2026-11-11')).toEqual({ date: '2026-11-11', name: 'Armistice', label: '11 Nov · Armistice' });
    await addReferenceValue('holidays', '24 Dec · Fermeture', DIRECTOR);
    expect((await listPublicHolidays()).map((h) => h.date)).toContain('2026-12-24');
    expect((await settingsHolidayRows()).map((h) => h.date)).toContain('2026-12-24');
    await removeReferenceValue('holidays', '2026-12-24', DIRECTOR);
    expect((await listPublicHolidays()).map((h) => h.date)).not.toContain('2026-12-24');
  });

  it('project statuses: a deactivated stage is skipped by "Move to" and the auto-advance', async () => {
    await removeReferenceValue('statuses', 'fat', DIRECTOR);
    expect(await inactiveStageCodes()).toEqual(['fat']);
    const data = await getRegisterData();
    expect(buildRegisterModel(data, null, makeT('en'), 'en').stages.find((s) => s.code === 'fat')).toMatchObject({ inactive: true });
    const stages = await listStages();
    const fab = stages.find((s) => s.code === 'fabrication_assemblage')!;
    const missing = await missingDeliverables('HLT-026', 'fabrication_assemblage');
    let entered = null;
    for (const label of missing) entered = await setDeliverableAndAdvance('HLT-026', 'fabrication_assemblage', fab.deliverables.indexOf(label), true);
    expect(entered).toBe('expedition');
    await addReferenceValue('statuses', 'FAT', DIRECTOR);
    expect(await inactiveStageCodes()).toEqual([]);
  });

  it('cost categories: "Add category" from Settings, "Edit category"; the BAC is untouched', async () => {
    expect((await costCategoryOptions()).map((o) => [o.code, o.type])).toEqual([
      ['labor', 'labor'], ['materials', 'material'], ['equipment', 'equipment'], ['subcontractors', 'subcontract'], ['permits_fees', 'fees'], ['contingency', 'reserve'],
    ]);
    const before = (await getCostControl('NDC-031'))!;
    expect(nextCategoryCode(before.categories.map((c) => c.code))).toBe(`C${String(before.categories.length + 1).padStart(2, '0')}`);
    const code = await addProjectCostCategory('NDC-031', { name: 'Permits & fees', type: 'fees', budgetKeur: 40 }, 'Marie Lefebvre');
    await expect(addProjectCostCategory('NDC-031', { name: 'permits & FEES', type: 'fees', budgetKeur: 1 }, 'Marie Lefebvre')).rejects.toThrow(/already a cost category/);
    await expect(addProjectCostCategory('NDC-031', { name: 'X', type: 'fees', budgetKeur: -1 }, 'Marie Lefebvre')).rejects.toThrow(/budget/);
    // Delivery 8 (R-081, C-3a): NDC-031 has BL1 — the category starts at 0 k€ (was: the 40 k€ given) and its amount changes only
    // through an approved change request (was: edited to 55.5 k€); the name stays editable.
    await expect(updateProjectCostCategory('NDC-031', code, { name: 'Permits & local fees', budgetKeur: 55.5 }, 'Marie Lefebvre')).rejects.toThrow(/approved change request/);
    await updateProjectCostCategory('NDC-031', code, { name: 'Permits & local fees' }, 'Marie Lefebvre');
    const after = (await getCostControl('NDC-031'))!;
    expect(after.categories.at(-1)).toMatchObject({ code, name: 'Permits & local fees', costType: 'fees', budget: 0, forecast: 0, actual: 0 });
    expect(after.bac).toBe(before.bac);
    const db = await getDb();
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, `NDC-031 · ${code}`)).orderBy(asc(auditEntries.occurredAt));
    expect(a).toMatchObject({ actorName: 'Marie Lefebvre', area: 'Budget' });
  });
});

describe('A-2 / L-3 — the New project wizard instantiates the machine-type template', () => {
  it('setup: machine types of the Machine types screen, project managers, Settings categories', async () => {
    const setup = await getNewProjectSetup({ name: 'Romain Aubert', role: 'pm' });
    const aubert = setup.managers.find((m) => m.short === 'R. Aubert')!;
    expect(setup.defaultManagerId).toBe(aubert.id);
    expect((await getNewProjectSetup({ name: 'Marie Lefebvre', role: 'director' })).defaultManagerId).toBe(setup.managers.find((m) => m.short === 'S. Perrin')!.id);
    expect(setup.machineTypes).toEqual(['EMP', 'MEMU', 'SPUR', 'AUTRE', 'R&D']);
    expect(setup.templates.find((x) => x.id === 'SPUR')).toMatchObject({ calCode: 'site_6x10', wbs: '6 phases · 6 work packages' });
    expect(setup.settingsCategories.map((c) => c.type)).not.toContain('Reserve');
  });

  it('creates the WBS, the chained activities, the cost categories and the ITP plan with the chosen PM, window and calendar', async () => {
    const setup = await getNewProjectSetup();
    const aubert = setup.managers.find((m) => m.short === 'R. Aubert')!;
    const created = await createWizardProject({
      name: 'Dakar rail spur', client: 'Transit BU', das: '3', machineType: 'SPUR', currency: 'EUR', templateCode: 'SPUR',
      categories: [{ name: 'Génie civil', type: 'subcontract', budget: 270 }, { name: 'Structures', type: 'material', budget: 450 }],
      contingencyPct: 10, calendar: 'site_6x10', pmPersonId: aubert.id, plannedStart: '2027-02-01', plannedFinish: '2027-12-17', actorName: 'Romain Aubert',
    });
    expect(created).toMatchObject({ workPackages: 6, activities: 6, links: 5, itpPlan: true });
    const p = (await getProject(created.code))!;
    expect(p).toMatchObject({ pm: 'R. Aubert', start: 'Feb 2027', finish: 'Dec 2027', status: 'Initiative', hasData: false, health: null });
    const db = await getDb();
    const [row] = await db.select().from(projects).where(eq(projects.code, created.code));
    expect(row).toMatchObject({ calendar: 'site_6x10', currency: 'EUR', plannedStartDate: '2027-02-01', plannedFinishDate: '2027-12-17', templateCode: 'SPUR' });
    const nodes = await db.select().from(wbsNodes).where(eq(wbsNodes.projectId, row.id)).orderBy(asc(wbsNodes.position));
    expect(nodes.map((n) => [n.code, n.level])).toEqual([['1', 0], ['1.1', 1], ['1.2', 1], ['1.3', 1], ['1.4', 1], ['1.5', 1], ['1.6', 1]]);
    const acts = await db.select().from(activities).where(eq(activities.projectId, row.id)).orderBy(asc(activities.position));
    expect(acts.map((a) => a.code)).toEqual(['A1010', 'A1020', 'A1030', 'A1040', 'A1050', 'A1060']);
    expect(acts[0].startDate).toBe('2027-02-01');
    expect(acts.at(-1)!.finishDate! <= '2027-12-17').toBe(true);
    // Chantier 6d · 10h: Saturdays are worked.
    expect(acts.reduce((s, a) => s + a.budgetKeur, 0)).toBeCloseTo(720);
    const links = await db.select().from(activityLinks).where(eq(activityLinks.projectId, row.id));
    expect(links.every((l) => l.type === 'FS' && l.lagDays === 0)).toBe(true);
    expect((await db.select().from(itpPlans).where(eq(itpPlans.projectId, row.id)))[0]).toMatchObject({ machineTypeCode: 'SPUR' });
    const plan = (await getPlanData(created.code))!;
    expect(plan.packages).toHaveLength(6);
    expect(plan.activities.map((a) => a.preds.map((x) => x[0]))).toEqual([[], ['A1010'], ['A1020'], ['A1030'], ['A1040'], ['A1050']]);
    const model = buildRegisterModel(await getRegisterData(), null, makeT('en'), 'en');
    expect(model.rows.find((r) => r.code === created.code)!.openHref).toBe(`/projects/${created.code}/plan`);
    const [audit] = await db.select().from(auditEntries).where(and(eq(auditEntries.objectRef, created.code), eq(auditEntries.area, 'Projects')));
    expect(audit).toMatchObject({ actorName: 'Romain Aubert' });
    expect(audit.change).toContain('template SPUR · 6 work packages · 6 activities');
  });

  it('a blank template creates no WBS nor ITP plan; a custom machine type is instantiated from its own phases', async () => {
    const blank = await createWizardProject({
      name: 'Feasibility', client: 'Energy BU', das: '1', machineType: 'AUTRE', currency: 'USD', templateCode: 'blank', categories: [], contingencyPct: 5,
      calendar: 'standard_5x8',
    });
    expect(blank).toMatchObject({ workPackages: 0, activities: 0, itpPlan: false });
    expect(await getPlanData(blank.code)).toBeNull();
    await createMachineType({ code: 'TST', label: 'Test bench', base: 'MEMU', calendar: 'standard_5x8' }, DIRECTOR);
    const setup = await getNewProjectSetup();
    expect(setup.machineTypes).toContain('TST');
    const custom = await createWizardProject({
      name: 'Bench', client: 'Energy BU', das: '1', machineType: 'TST', currency: 'EUR', templateCode: 'TST', categories: [], contingencyPct: 5,
      calendar: 'standard_5x8',
    });
    expect(custom).toMatchObject({ workPackages: 6, activities: 6, itpPlan: true });
    const db = await getDb();
    const [row] = await db.select({ templateCode: projects.templateCode, mt: projects.machineTypeCode }).from(projects).where(eq(projects.code, custom.code));
    expect(row).toEqual({ templateCode: null, mt: 'TST' });
    await expect(
      createWizardProject({
        name: 'X', client: 'Y', das: '1', machineType: 'EMP', currency: 'EUR', templateCode: 'blank', categories: [], contingencyPct: 5, calendar: 'standard_5x8',
        pmPersonId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(/Unknown project manager/);
    const [p] = await db.select({ id: persons.id }).from(persons).where(eq(persons.shortName, 'S. Perrin'));
    expect(p).toBeTruthy();
  });
});

describe('P-14 — machine-type edits are gated server-side (mtCanEdit: director, PM, engineering lead, quality)', () => {
  it('refuses the other roles in every writer', async () => {
    const { removeRexReference, setMachineTypeCostCategories, setMachineTypeItpSystems, setMachineTypePhases, updateMachineType } = await import('./mtypes');
    for (const role of ['depthead', 'procurement', 'member', 'client']) {
      const actor = { role, name: 'Someone' };
      await expect(updateMachineType('EMP', { label: 'x' }, actor)).rejects.toThrow(/outside your workspace/);
      await expect(setMachineTypePhases('EMP', ['x'], actor)).rejects.toThrow(/outside your workspace/);
      await expect(setMachineTypeItpSystems('EMP', ['x'], actor)).rejects.toThrow(/outside your workspace/);
      await expect(setMachineTypeCostCategories('EMP', [], actor)).rejects.toThrow(/outside your workspace/);
      await expect(removeRexReference('EMP', 'HAV001', actor)).rejects.toThrow(/outside your workspace/);
      await expect(createMachineType({ code: 'ZZ', label: 'x', base: 'blank', calendar: 'standard_5x8' }, actor)).rejects.toThrow(/outside your workspace/);
    }
    for (const role of ['director', 'pm', 'englead', 'quality']) await updateMachineType('EMP', { description: `edited by ${role}` }, { role, name: 'Marie Lefebvre' });
  });
});
