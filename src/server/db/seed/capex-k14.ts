// K-14 (Arche's request of 30 Oct 2026, approved by the owner on 2 Nov 2026; docs/delivery-9/notes-k14-demo.md): the demo aligned
// with Arche's. Arche's demo CAPEX CPX-APM-2025-01 "Ageing oven and finishing line" (Kénitra, start-up phase since 1 Jul 2026)
// ordered its ageing oven — the free need CPX-APM-2025-01/B01, "Ageing oven 2 × 6 m" — at its G2 of 15 Sep 2025; EPC2i delivered
// it with the demo project APM-008, now in warranty, whose installed base gives the machine of Arche's ramp-up line "Ageing oven"
// (MCH-045: under the floor of "Add machine", whose numbers continue at MCH-050 — Arche's seed names the line's machine with its
// own simulation, `simulatedMachineNumber(simulatedProjectCode(…/B01), 0)` = MCH-443, to replace by MCH-045 on its side). The
// project is a minimal one, like the prototype's closed projects (register row, site, equipment line, stage history, one machine,
// its commissioning grid): no schedule, budget detail or team. Its client is the subsidiary, an internal client (R-190).
// Also: the SAT of RCF-019 planned (Arche's criterion K3 of CPX-SAI-2026-01 reads pub_jalons_projets `sat`.prevu_le).
// Demo only: seeded with the demo machine needs (./capex-needs.ts), backfilled once on a demo database seeded before (index.ts).
import { eq, or, sql } from 'drizzle-orm';
import { estimateRange } from '@/domain/estimate-class';
import { nextAnswerNumber } from '@/domain/capex-needs';
import { mIdx } from '@/lib/format';
import { isoOfDemoDate, type StageCode } from '../codes';
import { findPerson, nameOf } from '../helpers';
import {
  clients, commissioningSteps, commissioningSystems, machines, needAnswers, projectEquipments, projectSites, projects, satPlans, stageTransitions,
} from '../schema';
import type { DB, Tx } from '../types';

type Q = DB | Tx;

/** The subsidiary of CPX-APM-2025-01 as an internal client (R-190: Arche's and Matrix's code). */
export const K14_CLIENT = { name: 'Atlas Process Maroc', code3: 'APM', subsidiaryCode: 'APM' } as const;

/** The demo project delivering CPX-APM-2025-01/B01 (number below the prototype's: the next wizard project stays #045). */
export const K14_PROJECT = {
  code: 'APM-008', number: '#008', analyticCode: 'APM001', name: 'Ageing oven and finishing line — Ageing oven 2 × 6 m',
  capexCode: 'CPX-APM-2025-01', needRef: 'CPX-APM-2025-01/B01', pm: 'C. Moreau', start: 'Sep 2025', finish: 'Jun 2026',
} as const;

/** The oven in the installed base: Arche's ramp-up line reads this number (below 050: "Add machine" keeps MCH-050, MCH-051…). */
export const K14_MACHINE = 'MCH-045';

/** The firm offer accepted at the order (the price Arche's simulation answers for the oven: 650 k€ × 1.02, 26 weeks). */
const K14_OFFER = {
  needRef: K14_PROJECT.needRef, capexCode: K14_PROJECT.capexCode, nature: 'offre_ferme' as const, qualification: 'faisable' as const,
  leadTimeWeeks: 26, validUntil: '2025-11-29', documentRef: 'OFF-CPX-APM-2025-01-001', status: 'acceptee' as const, answeredAt: new Date('2025-08-01T09:00:00Z'),
};

/** APM-008's stage history: ordered on 15 Sep 2025, delivered on site on 11 May 2026, accepted (warranty) on 29 Jun 2026. */
const K14_STAGES: [StageCode, string][] = [
  ['initiative', '2025-09-15'], ['etudes', '2025-09-15'], ['approvisionnements', '2025-11-14'], ['fabrication_assemblage', '2025-12-08'],
  ['fat', '2026-03-16'], ['expedition', '2026-04-13'], ['chantier', '2026-05-11'], ['mise_en_service_sat', '2026-05-25'], ['garantie', '2026-06-29'],
];

/** APM-008's commissioning grid: one system (the AUTRE template's), every step done; its SAT on 19 Jun 2026. */
const K14_COMMISSIONING: [string, string][] = [
  ['mechanical_completion', '2026-05-22'], ['pre_commissioning', '2026-05-29'], ['commissioning', '2026-06-12'], ['sat', '2026-06-19'], ['handover', '2026-06-29'],
];

/** RCF-019's SAT (K3 of CPX-SAI-2026-01): planned on the mobile unit's automation, after its arrival on site (7 Sep). */
export const K14_RCF_SAT = { project: 'RCF-019', system: 'Automation', on: () => isoOfDemoDate('16 Nov')! } as const;

const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

/** The subsidiary's client: the existing one (same subsidiary, name or code), else registered as internal. */
async function k14Client(tx: Tx): Promise<string> {
  const [c] = await tx.select({ id: clients.id }).from(clients)
    .where(or(eq(clients.subsidiaryCode, K14_CLIENT.subsidiaryCode), eq(clients.name, K14_CLIENT.name), eq(clients.code3, K14_CLIENT.code3)));
  if (c) return c.id;
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${clients.sortOrder}), 0)::int` }).from(clients);
  const [{ id }] = await tx.insert(clients).values({ ...K14_CLIENT, isInternal: true, sortOrder: max + 1 }).returning({ id: clients.id });
  return id;
}

/** APM-008, its line, site, stage history, machine and commissioning grid, and the accepted offer pointing at it. */
export async function seedDemoK14Project(tx: Tx): Promise<void> {
  const clientId = await k14Client(tx);
  const pm = await findPerson(tx, K14_PROJECT.pm);
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${projects.sortOrder}), 0)::int` }).from(projects);
  const stamp = at('2026-06-29');
  const [{ id: projectId }] = await tx.insert(projects).values({
    code: K14_PROJECT.code, number: K14_PROJECT.number, shortCode: K14_PROJECT.code.slice(0, 3), name: K14_PROJECT.name, clientId, pmPersonId: pm?.id ?? null,
    stage: 'garantie', das: '1', machineTypeCode: 'AUTRE', analyticCode: K14_PROJECT.analyticCode, startText: K14_PROJECT.start, finishText: K14_PROJECT.finish,
    startMonth: mIdx(K14_PROJECT.start), finishMonth: mIdx(K14_PROJECT.finish), budgetKeur: 663, actualKeur: 641, progress: 1, spi: 1, currency: 'EUR',
    sortOrder: max + 1, capexCode: K14_PROJECT.capexCode, besoinRef: K14_PROJECT.needRef, createdAt: at('2025-09-15'), updatedAt: stamp,
  }).returning({ id: projects.id });
  const [{ id: equipmentId }] = await tx.insert(projectEquipments).values({
    projectId, ref: 'EQ-01', machineTypeCode: 'AUTRE', quantity: 1, label: 'Ageing oven 2 × 6 m', position: 0, capacityValue: 2, capacityUnit: 't/h',
    besoinRef: K14_PROJECT.needRef, createdAt: at('2025-09-15'), updatedAt: at('2025-09-15'),
  }).returning({ id: projectEquipments.id });
  await tx.insert(projectSites).values({ projectId, city: 'Kénitra', countryName: 'Morocco', lat: 34.26, lng: -6.58 });
  await tx.insert(stageTransitions).values(K14_STAGES.map(([to, on], i) => ({
    projectId, seq: i + 1, fromStage: i ? K14_STAGES[i - 1][0] : null, toStage: to, effectiveOn: on, mode: 'auto' as const, createdAt: at(on),
  })));
  const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${machines.position}), -1)::int` }).from(machines);
  await tx.insert(machines).values({
    number: K14_MACHINE, machineTypeCode: 'AUTRE', name: 'Ageing oven 2 × 6 m', clientName: K14_CLIENT.name, clientId, siteText: 'Kénitra · finishing hall',
    projectCode: K14_PROJECT.code, projectId, equipmentId, deliveredOn: '2026-05-11', warrantyEndOn: '2028-05-10', warrantyStatus: 'in_warranty', position: pos + 1,
    createdAt: at('2026-05-11'), updatedAt: at('2026-05-11'),
  });
  const [{ id: systemId }] = await tx.insert(commissioningSystems).values({ projectId, equipmentId, name: 'General', position: 0 }).returning({ id: commissioningSystems.id });
  await tx.insert(commissioningSteps).values(K14_COMMISSIONING.map(([step, on], position) => ({
    systemId, step: step as typeof commissioningSteps.$inferInsert.step, status: 'done' as const, dateOn: on, position,
  })));
  const director = await findPerson(tx, 'Hélène Marchetti');
  const numbers = (await tx.select({ n: needAnswers.number }).from(needAnswers)).map((r) => r.n);
  const r = estimateRange(663, 'E10');
  await tx.insert(needAnswers).values({
    ...K14_OFFER, number: nextAnswerNumber(numbers), estimateClass: 'E10', centralKeur: r.central, lowKeur: r.low, highKeur: r.high, projectId,
    answeredByPersonId: director?.id ?? null, answeredByName: director ? nameOf(director) : 'Hélène Marchetti', createdAt: K14_OFFER.answeredAt, updatedAt: at('2025-09-15'),
  });
}

/** RCF-019's SAT plan (planned by its PM a few days before the demo day); nothing when RCF-019 is missing. */
export async function seedDemoK14RcfSat(tx: Tx): Promise<void> {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, K14_RCF_SAT.project));
  if (!p) return;
  const pm = await findPerson(tx, 'C. Moreau');
  await tx.insert(satPlans).values({
    projectId: p.id, systemName: K14_RCF_SAT.system, plannedOn: K14_RCF_SAT.on(), clientWitnesses: 'Plant manager and process lead of the client',
    prerequisites: 'Utilities connected · operators trained · tomato supply for the test runs', plannedByName: pm ? nameOf(pm) : 'C. Moreau',
    plannedByPersonId: pm?.id ?? null, createdAt: at(isoOfDemoDate('21 Sep')!),
  });
}

/** Both, in the demo seed (after the demo machine needs and answers). */
export async function seedDemoK14(tx: Tx): Promise<void> {
  await seedDemoK14Project(tx);
  await seedDemoK14RcfSat(tx);
}

/**
 * A demo database seeded before K-14: no project delivers the oven's need, and the project's code, number, analytic code and
 * machine number are all free. Backfilled once (index.ts).
 */
export async function demoK14ProjectToBackfill(db: Q): Promise<boolean> {
  const [[{ p }], [{ m }]] = await Promise.all([
    db.select({ p: sql<number>`count(*)::int` }).from(projects).where(or(
      eq(projects.besoinRef, K14_PROJECT.needRef), eq(projects.code, K14_PROJECT.code), eq(projects.number, K14_PROJECT.number), eq(projects.analyticCode, K14_PROJECT.analyticCode),
    )),
    db.select({ m: sql<number>`count(*)::int` }).from(machines).where(eq(machines.number, K14_MACHINE)),
  ]);
  return p === 0 && m === 0;
}

/** A demo database seeded before K-14 whose RCF-019 has no SAT planned (nor a commissioning grid). Backfilled once (index.ts). */
export async function demoK14RcfSatToBackfill(db: Q): Promise<boolean> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, K14_RCF_SAT.project));
  if (!p) return false;
  const [[{ s }], [{ c }]] = await Promise.all([
    db.select({ s: sql<number>`count(*)::int` }).from(satPlans).where(eq(satPlans.projectId, p.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(commissioningSystems).where(eq(commissioningSystems.projectId, p.id)),
  ]);
  return s === 0 && c === 0;
}
