// R-110 (E-4 = a): only the parts a machine actually carries are kept for the installed base. Pure rule (a configured machine
// pins the ECO parts it carries at the revision fitted on it; a machine without configuration keeps every ECO part; rejected
// ECOs and non-pinning dispositions pin nothing), then the data layer on the seeded in-memory database: the seed's effect
// (EL-HMI-15 and FD-DET-OPT2 are no longer pinned), and "Mark done" fitting EL-HMI-15 on a targeted machine makes its pin
// appear with the fitted revision.
import { beforeAll, describe, expect, it } from 'vitest';
import { installedBasePinsOf } from '@/domain/eco';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { completeIntervention, planIntervention } from './claims';
import { installedBasePins, pinSummary } from './eco';
import { getVigieEcoConnector } from '@/server/integrations/vigie/eco-connector';
import { machineConfigurations } from './fleet';

const target = (ref: string, disposition: 'pinned' | 'retrofit' | 'replace' | null = 'pinned', fittedRevision: string | null = 'B') =>
  ({ targetType: 'machine' as const, targetRef: ref, disposition: disposition as never, fittedRevision });

describe('R-110 rule', () => {
  const eco = { number: 'ECO-1', status: 'in_approval' as const, parts: ['P-OLD', 'P-NEW'], effectivity: [target('MCH-1'), target('MCH-2', 'retrofit', 'A'), target('MCH-3', 'replace')] };

  it('a machine with a recorded configuration pins only the ECO parts it carries, at its fitted revision', () => {
    const cfg = new Map([['MCH-1', [{ ref: 'P-OLD', revision: 'C' }, { ref: 'X', revision: 'A' }]], ['MCH-2', [{ ref: 'Y', revision: 'A' }]]]);
    expect(installedBasePinsOf([eco], cfg)).toEqual({ 'P-OLD': [{ eco: 'ECO-1', machine: 'MCH-1', revision: 'C', disposition: 'pinned' }] });
  });

  it('a machine without configuration (added by hand, unknown to Keystone) keeps every ECO part, at Vigie’s fitted revision', () => {
    expect(installedBasePinsOf([eco], new Map())).toEqual({
      'P-OLD': [{ eco: 'ECO-1', machine: 'MCH-1', revision: 'B', disposition: 'pinned' }, { eco: 'ECO-1', machine: 'MCH-2', revision: 'A', disposition: 'retrofit' }],
      'P-NEW': [{ eco: 'ECO-1', machine: 'MCH-1', revision: 'B', disposition: 'pinned' }, { eco: 'ECO-1', machine: 'MCH-2', revision: 'A', disposition: 'retrofit' }],
    });
    // An empty configuration counts as none.
    expect(Object.keys(installedBasePinsOf([eco], new Map([['MCH-1', []]])))).toEqual(['P-OLD', 'P-NEW']);
  });

  it('a rejected ECO, a project target and a "replace" disposition pin nothing', () => {
    expect(installedBasePinsOf([{ ...eco, status: 'rejected' as const }], new Map())).toEqual({});
    expect(installedBasePinsOf([{ ...eco, effectivity: [{ ...target('HLT-026'), targetType: 'project' as never }, target('MCH-3', 'replace')] }], new Map())).toEqual({});
  });
});

describe('R-110 on the seed', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('EL-HMI-15 and FD-DET-OPT2 are no longer pinned; the parts the machines carry keep their pins', async () => {
    const pins = await installedBasePins();
    expect([pins['EL-HMI-15'], pins['FD-DET-OPT2']]).toEqual([undefined, undefined]);
    expect(pinSummary(pins['FD-DET-OPT'])).toEqual({ machines: 1, ecos: ['ECO-2026-015'], firstEco: 'ECO-2026-015' });
    // Every pin names a revision fitted on its machine (its recorded configuration).
    const cfg = await machineConfigurations([...new Set(Object.values(pins).flat().map((p) => p.machine))]);
    for (const [ref, ps] of Object.entries(pins)) for (const p of ps) expect(cfg.get(p.machine)?.find((c) => c.ref === ref)?.revision, `${ref} ${p.machine}`).toBe(p.revision);
  });

  it('"Mark done" fitting EL-HMI-15 on a machine an ECO pins makes its pin appear, with the fitted revision', async () => {
    const ecos = await getVigieEcoConnector().listEcos();
    const eco = ecos.find((e) => e.status !== 'rejected' && e.parts.includes('EL-HMI-15'))!;
    const machine = eco.effectivity.find((t) => t.targetType === 'machine' && (t.disposition === 'pinned' || t.disposition === 'retrofit'))!.targetRef;
    const actor = { name: 'Gabriel Comte', role: 'quality' };
    const iv = await planIntervention({ machineNumber: machine, claimNumber: null, type: 'preventive', scheduledOn: '2026-10-05', technicians: 'L. Moreau', durationDays: 1 }, actor);
    await completeIntervention(iv, { doneOn: '2026-10-06', report: 'HMI replaced', partRef: 'EL-HMI-15', revision: 'B' }, actor);
    const pin = (await installedBasePins())['EL-HMI-15'];
    expect(pin).toContainEqual(expect.objectContaining({ eco: eco.number, machine, revision: 'B' }));
  });
});
