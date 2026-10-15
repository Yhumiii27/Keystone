import 'server-only';
// Commissioning & handover dossier DAL (docs/spec/07 §2.6). Keystone owns it. The grid (system × step) and the
// dossier are read-only in the prototype (OPEN QUESTION Q-5); "Plan SAT" is recorded (sat_plans) and dates the
// system's SAT step. "Blocking A" per system = open category-A punch items whose location starts with the system's
// first word (`cmRows` 4973) — R-117 (A-6 'a'): items of every origin (one punch list per project).
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  HANDOVER_STATUS_TAG, commissioningCellStatus, commissioningStep, displayOfIso, handoverItemStatus,
  type CommissioningCellStatus, type CommissioningStep, type HandoverItemStatus,
} from '@/server/db/codes';
import { commissioningSteps, commissioningSystems, documents, handoverItems, punchItems, satPlans } from '@/server/db/schema';
import { listItpSystems, templateSystemsOf } from './itp';
import { isIsoDate, projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';

export type { Actor };

export interface CommissioningCell {
  step: CommissioningStep;
  stepLabel: string;
  status: CommissioningCellStatus;
  statusLabel: string;
  /** Done / planned date; null when none ("In progress"). */
  dateOn: string | null;
  /** "IF-02" when blocked by an interface or a punch item. */
  blockingRef: string | null;
}

export interface CommissioningSystemRow {
  name: string;
  cells: CommissioningCell[];
  /** Open category-A punch items of the system, every origin (R-117). */
  blockingA: number;
}

export interface HandoverItemRow {
  item: string;
  /** Codex document type code ("MAN"). */
  documentType: string;
  documentRef: string | null;
  /** The reference is a record of the Codex index (the "open document" button). */
  documentInCodex: boolean;
  status: HandoverItemStatus;
  statusLabel: string;
  statusTag: string;
}

export interface SatPlanRow {
  system: string;
  plannedOn: string;
  clientWitnesses: string;
  prerequisites: string;
  plannedBy: string;
  createdAt: string;
}

export interface Commissioning {
  projectCode: string;
  /** Step columns in order (Mechanical completion … Handover). */
  steps: { step: CommissioningStep; label: string }[];
  systems: CommissioningSystemRow[];
  dossier: HandoverItemRow[];
  satPlans: SatPlanRow[];
}

/** Commissioning grid and handover dossier of a project; null when it has no commissioning plan. */
export async function getCommissioning(projectCode: string): Promise<Commissioning | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const systems = await db.select().from(commissioningSystems).where(eq(commissioningSystems.projectId, p.id)).orderBy(asc(commissioningSystems.position));
  if (!systems.length) return null;
  const [cells, dossier, punch, sats] = await Promise.all([
    db.select().from(commissioningSteps).where(inArray(commissioningSteps.systemId, systems.map((s) => s.id))).orderBy(asc(commissioningSteps.position)),
    db.select({ h: handoverItems, doc: documents.number }).from(handoverItems).leftJoin(documents, eq(documents.id, handoverItems.documentId))
      .where(eq(handoverItems.projectId, p.id)).orderBy(asc(handoverItems.position)),
    db.select({ location: punchItems.location, status: punchItems.status }).from(punchItems)
      .where(and(eq(punchItems.projectId, p.id), eq(punchItems.category, 'A'))),
    db.select().from(satPlans).where(eq(satPlans.projectId, p.id)).orderBy(asc(satPlans.createdAt)),
  ]);
  const openA = punch.filter((x) => x.status !== 'closed');
  return {
    projectCode,
    steps: commissioningStep.codes.map((step) => ({ step, label: commissioningStep.label(step) })),
    systems: systems.map((s) => ({
      name: s.name,
      cells: cells.filter((c) => c.systemId === s.id).map((c) => ({
        step: c.step, stepLabel: commissioningStep.label(c.step), status: c.status, statusLabel: commissioningCellStatus.label(c.status), dateOn: c.dateOn, blockingRef: c.blockingRef,
      })),
      blockingA: openA.filter((x) => x.location.startsWith(s.name.split(' ')[0])).length,
    })),
    dossier: dossier.map(({ h, doc }) => ({
      item: h.item, documentType: h.documentTypeCode, documentRef: h.documentRef, documentInCodex: !!doc, status: h.status, statusLabel: handoverItemStatus.label(h.status),
      statusTag: HANDOVER_STATUS_TAG[h.status],
    })),
    satPlans: sats.map((x) => ({
      system: x.systemName, plannedOn: x.plannedOn, clientWitnesses: x.clientWitnesses, prerequisites: x.prerequisites, plannedBy: x.plannedByName, createdAt: x.createdAt.toISOString(),
    })),
  };
}

export interface PlanSatInput {
  system: string;
  /** ISO date. */
  date: string;
  clientWitnesses?: string | null;
  prerequisites?: string | null;
}

/**
 * "Plan SAT" (AF.commissioning: "SAT planned · invitation sent to the client"): records the SAT plan and dates the
 * system's SAT step (status unchanged). On a project without a commissioning plan the form offers the inspection
 * template's systems (`ITPSYS`, as the prototype): the plan is recorded and the screen keeps its empty panel (no grid is
 * invented). The invitation itself is not sent (no mail connector — Outlook, SMTP).
 */
export async function planSat(projectCode: string, input: PlanSatInput, actor: Actor): Promise<void> {
  requireWorkspace('commissioning', actor, 'Commissioning & handover');
  if (!isIsoDate(input.date)) throw new Error('Invalid date');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const own = await tx.select().from(commissioningSystems).where(eq(commissioningSystems.projectId, p.id));
    const sys = own.find((s) => s.name === input.system) ?? null;
    const known = own.length ? !!sys : (await templateSystemsOf(tx, p)).includes(input.system);
    if (!known) throw new Error(`Unknown system "${input.system}" on ${projectCode}`);
    const [cell] = sys ? await tx.select().from(commissioningSteps).where(and(eq(commissioningSteps.systemId, sys.id), eq(commissioningSteps.step, 'sat'))) : [];
    if (cell?.status === 'done') throw new Error(`SAT of ${input.system} is already done`);
    const who = await whoIs(tx, actor);
    const witnesses = (input.clientWitnesses ?? '').trim();
    const prerequisites = (input.prerequisites ?? '').trim();
    await tx.insert(satPlans).values({
      projectId: p.id, systemName: input.system, plannedOn: input.date, clientWitnesses: witnesses, prerequisites, plannedByName: who.who, plannedByPersonId: who.personId,
    });
    if (sys && cell) await tx.update(commissioningSteps).set({ dateOn: input.date }).where(and(eq(commissioningSteps.systemId, sys.id), eq(commissioningSteps.step, 'sat')));
    const on = displayOfIso(input.date);
    await trace(tx, who, {
      objectRef: `SAT · ${input.system}`, change: `SAT planned ${on}${witnesses ? ` · witnesses ${witnesses}` : ''}`, area: 'Commissioning',
      entityType: sys ? 'commissioning_system' : undefined, entityId: sys?.id ?? null, projectId: p.id,
      activity: { text: `Planned the SAT of ${input.system} on ${on} · invitation to the client`, kind: 'client' },
    });
  });
}

/** Interfaces (or punch items) blocking a commissioning step of a project ("Blocked · IF-02") — Interfaces "Blocking commissioning". */
export async function commissioningBlockingRefs(projectCode: string): Promise<string[]> {
  const c = await getCommissioning(projectCode);
  if (!c) return [];
  return [...new Set(c.systems.flatMap((s) => s.cells.filter((x) => x.status === 'blocked' && x.blockingRef).map((x) => x.blockingRef!)))];
}

/** Systems of the commissioning plan. */
export async function listCommissioningSystems(projectCode: string): Promise<string[]> {
  return (await getCommissioning(projectCode))?.systems.map((s) => s.name) ?? [];
}

/** Systems of the "Plan SAT" select: the commissioning plan's, else the project's inspection template (`ITPSYS`). */
export async function listSatSystems(projectCode: string): Promise<string[]> {
  const own = await listCommissioningSystems(projectCode);
  return own.length ? own : listItpSystems(projectCode);
}
