// R-187 (Arche K-02, K-03, K-10): the Arche connector's row (both seeds) and the demo machine needs with Keystone's answers.
// Demo: the mirror holds what the simulated source returns (src/server/integrations/capex/simulation.ts — two CAPEX, five needs:
// submitted, withdrawn and ordered), and five answers dated before the demo day (DEMO_TODAY_ISO, 25 Sep 2026): a qualification
// "to be studied" (the withdrawn need), two firm offers E10 accepted at G2 — one already delivered by RCF-019 (its CAPEX link and
// EQ-01 need set), one whose project is still to be created —, an indicative price E50 and a budgetary quote E30 on the Kénitra
// extrusion line. The production seed has the connector row only (the needs come from Arche).
import { and, eq, sql } from 'drizzle-orm';
import { estimateRange } from '@/domain/estimate-class';
import { snapshotOf, applyCapexSnapshot, recordCapexRun } from '@/server/integrations/capex/mirror';
import { simulatedArcheViews } from '@/server/integrations/capex/simulation';
import { findPerson, nameOf } from '../helpers';
import { capexMirror, connectors, needAnswers, projectEquipments, projects } from '../schema';
import type { DB, Tx } from '../types';

/** Arche's row in the connectors table (not in the prototype's CONNECTORS: the CAPEX application came with delivery 9). */
export const ARCHE_CONNECTOR = {
  name: 'Arche',
  dataScope: 'Subsidiaries’ CAPEX and machine needs (Arche → Keystone) · Keystone’s answers and the project created at the order (Keystone → Arche, pub_reponses_besoins)',
  frequency: 'Every 15 min',
};

/** Adds Arche's row once (seeds, and a database seeded before R-187); never changes an existing row (IT's file may have set it). */
export async function ensureArcheConnector(q: DB | Tx): Promise<void> {
  const [{ max }] = await q.select({ max: sql<number>`coalesce(max(${connectors.position}), -1)::int` }).from(connectors);
  await q.insert(connectors).values({
    name: ARCHE_CONNECTOR.name, kind: 'static', dataScope: ARCHE_CONNECTOR.dataScope, frequency: ARCHE_CONNECTOR.frequency, direction: null,
    status: 'ready', lastSyncAt: null, lastVolume: '', position: max + 1,
  }).onConflictDoNothing({ target: connectors.name });
}

const DIRECTOR = 'Hélène Marchetti';

type Answer = Omit<typeof needAnswers.$inferInsert, 'answeredByName' | 'lowKeur' | 'highKeur'> & { project?: string };

const priced = (central: number, c: 'E50' | 'E30' | 'E10') => {
  const r = estimateRange(central, c);
  return { estimateClass: c, centralKeur: r.central, lowKeur: r.low, highKeur: r.high };
};

/** The demo answers (DEMO_ANSWERS.length rows), oldest first. */
export const DEMO_ANSWERS: (Answer & { lowKeur?: number | null; highKeur?: number | null })[] = [
  {
    number: 'RB-001', needRef: 'CPX-SAI-2026-01/B02', capexCode: 'CPX-SAI-2026-01', nature: 'qualification', qualification: 'a_etudier',
    reason: 'Version SPUR-2X en fin de vie : variante sur mesure à étudier avec le lot utilités', status: 'remise', answeredAt: new Date('2026-04-20T09:00:00Z'),
  },
  {
    number: 'RB-002', needRef: 'CPX-SAI-2026-01/B03', capexCode: 'CPX-SAI-2026-01', nature: 'offre_ferme', qualification: 'faisable', ...priced(8436, 'E10'),
    leadTimeWeeks: 52, validUntil: '2026-12-31', documentRef: 'OFF-CPX-SAI-2026-01-002', status: 'acceptee', answeredAt: new Date('2026-06-20T09:00:00Z'),
  },
  {
    number: 'RB-003', needRef: 'CPX-SAI-2026-01/B01', capexCode: 'CPX-SAI-2026-01', nature: 'offre_ferme', qualification: 'faisable', ...priced(1945, 'E10'),
    leadTimeWeeks: 36, validUntil: '2026-12-31', documentRef: 'OFF-CPX-SAI-2026-01-001', status: 'acceptee', answeredAt: new Date('2026-07-02T09:00:00Z'), project: 'RCF-019',
  },
  {
    number: 'RB-004', needRef: 'CPX-APM-2026-01/B01', capexCode: 'CPX-APM-2026-01', nature: 'indicatif', qualification: 'faisable', ...priced(4218, 'E50'),
    leadTimeWeeks: 52, status: 'remise', answeredAt: new Date('2026-09-10T09:00:00Z'),
  },
  {
    number: 'RB-005', needRef: 'CPX-APM-2026-01/B01', capexCode: 'CPX-APM-2026-01', nature: 'devis', qualification: 'faisable', ...priced(4150, 'E30'),
    leadTimeWeeks: 50, validUntil: '2027-01-31', documentRef: 'DEV-CPX-APM-2026-01-001', status: 'remise', answeredAt: new Date('2026-09-24T09:00:00Z'),
  },
];

/** The demo project already delivering an ordered need (K-10): RCF-019 ← CPX-SAI-2026-01/B01. */
export const DEMO_NEED_PROJECT = { project: 'RCF-019', capexCode: 'CPX-SAI-2026-01', needRef: 'CPX-SAI-2026-01/B01' } as const;

/** The demo mirror (simulated read), the answers and RCF-019's CAPEX link. */
export async function seedDemoCapexNeeds(tx: Tx): Promise<void> {
  const at = new Date('2026-09-25T06:00:00Z');
  const snap = snapshotOf(simulatedArcheViews());
  await applyCapexSnapshot(tx, snap, at);
  await recordCapexRun(tx, { source: 'simulation', trigger: 'seed', ok: true, capexCount: snap.capex.length, needCount: snap.needs.length, at });
  const director = await findPerson(tx, DIRECTOR);
  const [rcf] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, DEMO_NEED_PROJECT.project));
  for (const { project, ...a } of DEMO_ANSWERS) {
    await tx.insert(needAnswers).values({
      ...a, projectId: project && rcf ? rcf.id : null, answeredByPersonId: director?.id ?? null, answeredByName: director ? nameOf(director) : DIRECTOR,
      createdAt: a.answeredAt, updatedAt: a.answeredAt,
    });
  }
  if (rcf) {
    await tx.update(projects).set({ capexCode: DEMO_NEED_PROJECT.capexCode, besoinRef: DEMO_NEED_PROJECT.needRef }).where(eq(projects.id, rcf.id));
    await tx.update(projectEquipments).set({ besoinRef: DEMO_NEED_PROJECT.needRef }).where(and(eq(projectEquipments.projectId, rcf.id), eq(projectEquipments.ref, 'EQ-01')));
  }
}

/** A demo database seeded before R-187: no mirrored CAPEX and no answer. Backfilled once (index.ts). */
export async function demoCapexNeedsToBackfill(db: DB | Tx): Promise<boolean> {
  const [[{ c }], [{ a }]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(capexMirror),
    db.select({ a: sql<number>`count(*)::int` }).from(needAnswers),
  ]);
  return c === 0 && a === 0;
}
