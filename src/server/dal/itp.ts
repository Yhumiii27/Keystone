import 'server-only';
// Inspection & test plan and punch lists DAL (docs/spec/07 §2.4; site punch list 10 §3.6). Keystone owns them.
// The ITP is built from the machine-type template (machine_type_itp_systems); inspection results are read-only
// (OPEN QUESTION Q-6). Punch items live in two registers (OPEN QUESTION A-6): `itp` — the categorised list of the
// ITP screen (Start / Close, "Add punch item") — and `site` — the Site screen's punch list & reserves (read-only there).
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  itpPointType, itpResult, itpStage, machineType, nextBusinessNumber, punchCategory, punchOwnerParty, punchSource, punchStatus,
  type ItpPointType, type ItpResult, type ItpStage, type PunchCategory, type PunchOwnerParty, type PunchRegister, type PunchSource, type PunchStatus,
} from '@/server/db/codes';
import { documents, itpInspections, itpPlans, machineTypeItpSystems, machineTypes, persons, projects, punchItems } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { optionalDate, optionalText, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

export type { Actor };
type Q = DB | Tx;

export interface ItpInspectionRow {
  number: string;
  system: string;
  name: string;
  pointType: ItpPointType;
  pointTypeLabel: string;
  stage: ItpStage;
  stageLabel: string;
  /** '' when none. */
  reference: string;
  plannedOn: string | null;
  result: ItpResult;
  resultLabel: string;
  /** Record document ("REC-HLT-007"); `recordInCodex` when it is a record of the Codex index. */
  recordRef: string | null;
  recordInCodex: boolean;
  isCustom: boolean;
}

export interface ItpPlan {
  projectCode: string;
  /** Template the plan was built from ("EMP"); null when the project has no plan yet. */
  template: string | null;
  /** Systems of the template (ITP_TEMPLATES order), the groups of the plan. */
  systems: string[];
  inspections: ItpInspectionRow[];
  /** Lines beyond the template (the seed's custom lines + every inspection added in Keystone). */
  customCount: number;
}

/** ITP systems of a machine type (fallback AUTRE, as `itpSystems` 4940). */
async function systemsOf(q: Q, mt: string | null): Promise<string[]> {
  const read = async (code: string) =>
    (await q.select({ name: machineTypeItpSystems.name }).from(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, code)).orderBy(asc(machineTypeItpSystems.position))).map((r) => r.name);
  const own = mt ? await read(mt) : [];
  return own.length ? own : read('AUTRE');
}

/** The inspection & test plan of a project (null when it has none and nothing was added). */
export async function getItpPlan(projectCode: string): Promise<ItpPlan | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [plan] = await db.select().from(itpPlans).where(eq(itpPlans.projectId, p.id));
  if (!plan) return null;
  const rows = await db
    .select({ i: itpInspections, doc: documents.number })
    .from(itpInspections)
    .leftJoin(documents, eq(documents.id, itpInspections.recordDocumentId))
    .where(eq(itpInspections.planId, plan.id))
    .orderBy(asc(itpInspections.position));
  const [mt] = await db.select({ label: machineTypes.label }).from(machineTypes).where(eq(machineTypes.code, plan.machineTypeCode));
  return {
    projectCode, template: mt?.label ?? plan.machineTypeCode, systems: await systemsOf(db, plan.machineTypeCode),
    inspections: rows.map(({ i, doc }) => ({
      number: i.number, system: i.system, name: i.name, pointType: i.pointType, pointTypeLabel: itpPointType.label(i.pointType), stage: i.stage, stageLabel: itpStage.label(i.stage),
      reference: i.reference, plannedOn: i.plannedOn, result: i.result, resultLabel: itpResult.label(i.result), recordRef: i.recordRef, recordInCodex: !!doc, isCustom: i.isCustom,
    })),
    customCount: rows.filter((r) => r.i.isCustom).length,
  };
}

/** Template systems of a project (`ITPSYS`): its plan's machine type, else the project's, fallback AUTRE. */
export async function templateSystemsOf(q: Q, project: { id: string; machineTypeCode: string | null }): Promise<string[]> {
  const [plan] = await q.select({ mt: itpPlans.machineTypeCode }).from(itpPlans).where(eq(itpPlans.projectId, project.id));
  return systemsOf(q, plan?.mt ?? project.machineTypeCode);
}

/** Systems offered by "Add inspection" (the project's machine-type template, fallback AUTRE — `ITPSYS`). */
export async function listItpSystems(projectCode: string): Promise<string[]> {
  const db = await getDb();
  return templateSystemsOf(db, await projectOf(db, projectCode));
}

export interface NewInspectionInput {
  name: string;
  system: string;
  pointType: ItpPointType;
  stage: ItpStage;
  reference?: string | null;
  /** ISO date; optional. */
  plannedOn?: string | null;
}

/**
 * "Add inspection" (AF.itp): a Planned line of the plan, numbered I-20, I-21… per project (the prototype's `added.itp`).
 * A project without a plan gets one on its first line, from its machine type (AUTRE when untyped).
 */
export async function addItpInspection(projectCode: string, input: NewInspectionInput, actor: Actor): Promise<string> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  const name = requiredText(input.name, 'Inspection / test', 200);
  if (!itpPointType.isCode(input.pointType)) throw new Error('Invalid type');
  if (!itpStage.isCode(input.stage)) throw new Error('Invalid stage');
  const plannedOn = optionalDate(input.plannedOn, 'planned date');
  const reference = optionalText(input.reference, 'Standard / reference', 200) ?? '';
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    let [plan] = await tx.select().from(itpPlans).where(eq(itpPlans.projectId, p.id));
    if (!plan) {
      const mt = p.machineTypeCode && (await tx.select({ c: machineTypes.code }).from(machineTypes).where(eq(machineTypes.code, p.machineTypeCode))).length ? p.machineTypeCode : 'AUTRE';
      [plan] = await tx.insert(itpPlans).values({ projectId: p.id, machineTypeCode: mt }).returning();
    }
    const systems = await systemsOf(tx, plan.machineTypeCode);
    if (!systems.includes(input.system)) throw new Error(`Unknown system "${input.system}" for this plan`);
    const existing = await tx.select({ n: itpInspections.number, pos: itpInspections.position }).from(itpInspections).where(eq(itpInspections.planId, plan.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'I-', 2, await demoFloor(tx, 19));
    const [row] = await tx.insert(itpInspections).values({
      planId: plan.id, number, system: input.system, name, pointType: input.pointType, stage: input.stage, reference, plannedOn, result: 'planned', isCustom: true,
      position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: itpInspections.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `inspection added · ${input.system} · ${name}`, area: 'ITP', entityType: 'itp_inspection', entityId: row.id, projectId: p.id,
      activity: { text: `Added inspection ${number} ${name} to the ITP`, kind: 'quality' },
    });
    return number;
  });
}

// ── Punch items ────────────────────────────────────────────────────────────────────────────────────────

export interface PunchRow {
  register: PunchRegister;
  number: string;
  description: string;
  /** System / location ('' on the Site register). */
  location: string;
  category: PunchCategory | null;
  categoryLabel: string | null;
  source: PunchSource | null;
  /** "Raised by" as the ITP register shows it: "Client inspection", "ITP I-03", "Site walk". */
  sourceText: string | null;
  ncrNumber: string | null;
  /** Owner: the person ("L. Fabre") or the party ("Client", "Keystone"). */
  owner: string | null;
  ownerParty: PunchOwnerParty | null;
  dueOn: string | null;
  status: PunchStatus;
  statusLabel: string;
  open: boolean;
  /** Next status of "Start" / "Close" (ITP register; null when closed or on the Site register). */
  next: PunchStatus | null;
  position: number;
}

async function loadPunch(q: Q, projectId: string, register?: PunchRegister): Promise<PunchRow[]> {
  const rows = await q
    .select({ p: punchItems, insp: itpInspections.number })
    .from(punchItems)
    .leftJoin(itpInspections, eq(itpInspections.id, punchItems.sourceInspectionId))
    .where(and(eq(punchItems.projectId, projectId), register ? eq(punchItems.register, register) : undefined))
    .orderBy(asc(punchItems.register), asc(punchItems.position));
  return rows.map(({ p, insp }) => {
    const sourceText = !p.source ? null : p.source === 'itp' && insp ? `ITP ${insp}` : punchSource.label(p.source);
    return {
      register: p.register, number: p.number, description: p.description, location: p.location, category: p.category, categoryLabel: p.category ? punchCategory.label(p.category) : null,
      source: p.source, sourceText, ncrNumber: p.ncrNumber, owner: p.ownerName ?? (p.ownerParty ? punchOwnerParty.label(p.ownerParty) : null), ownerParty: p.ownerParty,
      dueOn: p.dueOn, status: p.status, statusLabel: punchStatus.label(p.status), open: p.status !== 'closed',
      next: p.register === 'itp' && p.status !== 'closed' ? (p.status === 'open' ? 'in_progress' : 'closed') : null, position: p.position,
    };
  });
}

/** Punch items of a project — one register, or both (ITP first). */
export async function listPunchItems(projectCode: string, register?: PunchRegister): Promise<PunchRow[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  return loadPunch(db, p.id, register);
}

export interface NewPunchInput {
  description: string;
  location?: string | null;
  category: PunchCategory;
  source: PunchSource;
  /** Person short or full name ("S. Haddad"). */
  owner?: string | null;
  dueOn?: string | null;
}

/** "Add punch item" (AF.punch) on the ITP register: Open, numbered P-10, P-11… per project. */
export async function addPunchItem(projectCode: string, input: NewPunchInput, actor: Actor): Promise<string> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  const description = requiredText(input.description, 'Item', 300);
  if (!punchCategory.isCode(input.category)) throw new Error('Invalid category');
  if (!punchSource.isCode(input.source)) throw new Error('Invalid source');
  const dueOn = optionalDate(input.dueOn, 'due date');
  const location = optionalText(input.location, 'System / location', 200) ?? '';
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const ownerName = optionalText(input.owner, 'Owner', 120);
    let ownerPersonId: string | null = null;
    if (ownerName) {
      const [o] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, ownerName));
      const [f] = o ? [o] : await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, ownerName));
      ownerPersonId = f?.id ?? null;
    }
    const existing = await tx.select({ n: punchItems.number, pos: punchItems.position }).from(punchItems).where(and(eq(punchItems.projectId, p.id), eq(punchItems.register, 'itp')));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, await demoFloor(tx, 9));
    const [row] = await tx.insert(punchItems).values({
      projectId: p.id, register: 'itp', number, description, location, category: input.category, source: input.source, ownerName, ownerPersonId, dueOn, status: 'open',
      position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: punchItems.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `punch item added · ${input.category} · ${description}`, area: 'Punch list', entityType: 'punch_item', entityId: row.id, projectId: p.id,
      activity: { text: `Added punch item ${number} (${input.category}) ${description}`, kind: 'quality' },
    });
    return number;
  });
}

/**
 * "Start" (Open → In progress) / "Close" (In progress → Closed) on the ITP register. Returns the new status. With
 * `expected` (the status the viewer saw), an item that moved on in the meantime is refused ("… has moved on") instead
 * of taking a second step.
 */
export async function advancePunchItem(projectCode: string, number: string, actor: Actor, on: string | null = null, expected?: PunchStatus): Promise<PunchStatus> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [it] = await tx.select().from(punchItems).where(and(eq(punchItems.projectId, p.id), eq(punchItems.register, 'itp'), eq(punchItems.number, number)));
    if (!it) throw new Error(`Unknown punch item ${number} on ${projectCode}`);
    if (it.status === 'closed') throw new Error(`${number} is closed`);
    if (expected && it.status !== expected) throw new Error(`${number} has moved on`);
    const next: PunchStatus = it.status === 'open' ? 'in_progress' : 'closed';
    await tx.update(punchItems).set({ status: next, closedOn: next === 'closed' ? on : null, updatedAt: new Date() }).where(eq(punchItems.id, it.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `status: ${punchStatus.label(it.status)} → ${punchStatus.label(next)}`, area: 'Punch list', entityType: 'punch_item', entityId: it.id, projectId: p.id,
    });
    return next;
  });
}

/** Open category-A items of the ITP register per project (ITP nav badge `itpBadge`; Commissioning "Blocking A"). */
export async function openPunchAByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, status: punchItems.status }).from(punchItems).innerJoin(projects, eq(projects.id, punchItems.projectId))
    .where(and(eq(punchItems.register, 'itp'), eq(punchItems.category, 'A')));
  const out: Record<string, number> = {};
  for (const r of rows) if (r.status !== 'closed') out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}

/** Label of the machine type a plan would be built from (KPI "Template" without a plan: the project's machine type or "—"). */
export async function projectMachineTypeLabel(projectCode: string): Promise<string | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  return p.machineTypeCode ? (machineType.isCode(p.machineTypeCode) ? machineType.label(p.machineTypeCode) : p.machineTypeCode) : null;
}
