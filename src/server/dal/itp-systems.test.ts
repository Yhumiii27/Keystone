// R-057 (E-9 'a': "les projets existants gardent le modèle de leur création"): an ITP plan keeps the systems of its machine type
// frozen when it is created (itp_plan_systems) — the plan's groups, "Add inspection" and "Plan SAT" follow the frozen list;
// editing the machine type changes only the plans created afterwards (wizard, first inspection of a project without a plan).
// A project without a plan follows its live type until its first inspection. In-memory seeded database.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listSatSystems, planSat } from './commissioning';
import { addItpInspection, getItpPlan, listItpSystems } from './itp';
import { setMachineTypeItpSystems } from './mtypes';
import { createWizardProject, getNewProjectSetup } from './projects-register';

const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const EMP = ['Structure', 'Hoist mechanisms', 'Travel (gantry)', 'Electrical HV/LV', 'Automation & safety', 'Anti-collision'];
const EMP_NEW = ['Steel structure', 'Hoists', 'Gantry travel', 'Power', 'Controls', 'Anti-collision', 'Lightning protection'];
const AUTRE_NEW = ['General', 'Site acceptance'];

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-057 · ITP systems frozen in the project (E-9 a)', () => {
  it('the seed froze HLT-026’s EMP template; a project without a plan follows its machine type today', async () => {
    expect((await getItpPlan('HLT-026'))!.systems).toEqual(EMP);
    expect(await listItpSystems('HLT-026')).toEqual(EMP);
    expect(await getItpPlan('NDC-031')).toBeNull();
    expect(await listItpSystems('NDC-031')).toEqual(['General']);
  });

  it('after the EMP type is edited, HLT-026 keeps its 6 systems — groups, "Add inspection" and "Plan SAT" lists', async () => {
    await setMachineTypeItpSystems('EMP', EMP_NEW, DIRECTOR);
    await setMachineTypeItpSystems('AUTRE', AUTRE_NEW, DIRECTOR);
    const plan = (await getItpPlan('HLT-026'))!;
    expect([plan.systems, plan.inspections.length]).toEqual([EMP, 13]);
    expect(await listItpSystems('HLT-026')).toEqual(EMP);
    expect(await addItpInspection('HLT-026', { name: 'Gantry rail alignment', system: 'Travel (gantry)', pointType: 'witness', stage: 'site' }, DIRECTOR)).toBe('I-20');
    await expect(addItpInspection('HLT-026', { name: 'x', system: 'Lightning protection', pointType: 'hold', stage: 'site' }, DIRECTOR)).rejects.toThrow(/Unknown system/);
    // HLT-026 has a commissioning plan: Plan SAT lists its systems (unchanged); a project without one lists its ITP systems.
    // R-185 part 2: + the system of its EQ-02 demo line.
    expect(await listSatSystems('HLT-026')).toEqual([...EMP, 'MEMU modules M1–M3']);
  });

  it('a project without a plan freezes the list of the moment at its first inspection; later edits leave it alone', async () => {
    expect(await listItpSystems('NDC-031')).toEqual(AUTRE_NEW);
    expect(await listSatSystems('NDC-031')).toEqual(AUTRE_NEW);
    expect(await addItpInspection('NDC-031', { name: 'Raised floor load test', system: 'Site acceptance', pointType: 'hold', stage: 'site' }, DIRECTOR)).toBe('I-20');
    expect((await getItpPlan('NDC-031'))!).toMatchObject({ template: 'AUTRE', systems: AUTRE_NEW });
    await setMachineTypeItpSystems('AUTRE', ['General'], DIRECTOR);
    expect((await getItpPlan('NDC-031'))!.systems).toEqual(AUTRE_NEW);
    expect(await listSatSystems('NDC-031')).toEqual(AUTRE_NEW);
    // Plan SAT on a frozen system the type no longer has.
    await planSat('NDC-031', { system: 'Site acceptance', date: '2027-02-03' }, DIRECTOR);
    await expect(planSat('NDC-031', { system: 'Power', date: '2027-02-03' }, DIRECTOR)).rejects.toThrow(/Unknown system/);
  });

  it('a wizard project created afterwards gets the new EMP list (in its order)', async () => {
    const setup = await getNewProjectSetup();
    const aubert = setup.managers.find((m) => m.short === 'R. Aubert')!;
    const created = await createWizardProject({
      name: 'Quay 5 crane', client: 'Port authority', das: '1', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
      categories: [{ name: 'Structures', type: 'material', budget: 500 }], contingencyPct: 10, calendar: 'standard_5x8', pmPersonId: aubert.id, actorName: 'Romain Aubert',
    });
    expect(created).toMatchObject({ itpPlan: true });
    expect((await getItpPlan(created.code))!.systems).toEqual(EMP_NEW);
    expect(await listItpSystems(created.code)).toEqual(EMP_NEW);
    // …and keeps it when the type changes again.
    await setMachineTypeItpSystems('EMP', EMP, DIRECTOR);
    expect((await getItpPlan(created.code))!.systems).toEqual(EMP_NEW);
    expect((await getItpPlan('HLT-026'))!.systems).toEqual(EMP);
  });
});
