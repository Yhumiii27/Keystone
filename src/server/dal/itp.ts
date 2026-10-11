import 'server-only';
// Inspection & test plan and punch lists DAL (docs/spec/07 §2.4; site punch list 10 §3.6). Keystone owns them.
// The ITP is built from the machine-type template (machine_type_itp_systems). Inspection results are recorded by quality
// and the engineering lead (R-112, Q-6a: `recordItpResult`); a failure is reported as an NCR in Vigie (Q-6b), whose
// number shows on the inspection once Vigie reports the NCR with the inspection (`vigie_ncrs.inspection_number`).
// Punch items live in two registers (OPEN QUESTION A-6): `itp` — the categorised list of the ITP screen (Start / Close,
// "Add punch item") — and `site` — the Site screen's punch list & reserves (read-only there).
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { canRecordItpResult } from '@/domain/itpcom';
import { getDb } from '@/server/db/client';
import {
  ITP_RECORDED_RESULTS, itpPointType, itpResult, itpStage, machineType, nextBusinessNumber, punchCategory, punchOwnerParty, punchSource, punchStatus,
  type ItpPointType, type ItpRecordedResult, type ItpResult, type ItpStage, type PunchCategory, type PunchOwnerParty, type PunchRegister, type PunchSource, type PunchStatus,
} from '@/server/db/codes';
import { findPerson, nameOf } from '@/server/db/helpers';
import { documents, itpInspections, itpPlans, machineTypeItpSystems, machineTypes, persons, projects, punchItems, vigieNcrs } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { vigieNcrUrl } from '@/server/integrations/vigie/links';
import { isIsoDate, optionalDate, optionalText, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

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
  /** Result recorded in Keystone (R-112): date, inspector, client representative, comment; null / empty for the seed's results. */
  resultOn: string | null;
  inspector: string | null;
  clientWitness: string | null;
  resultComment: string | null;
  /** Vigie NCRs reported from this inspection (Vigie echoes the inspection, Q-6b / V-3), Vigie order. */
  ncrs: { number: string; vigieUrl: string }[];
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
  const [[mt], ncrRows] = await Promise.all([
    db.select({ label: machineTypes.label }).from(machineTypes).where(eq(machineTypes.code, plan.machineTypeCode)),
    db.select({ number: vigieNcrs.number, vigieRef: vigieNcrs.vigieRef, inspection: vigieNcrs.inspectionNumber }).from(vigieNcrs)
      .where(and(eq(vigieNcrs.projectCode, projectCode), isNotNull(vigieNcrs.inspectionNumber))).orderBy(asc(vigieNcrs.position)),
  ]);
  return {
    projectCode, template: mt?.label ?? plan.machineTypeCode, systems: await systemsOf(db, plan.machineTypeCode),
    inspections: rows.map(({ i, doc }) => ({
      number: i.number, system: i.system, name: i.name, pointType: i.pointType, pointTypeLabel: itpPointType.label(i.pointType), stage: i.stage, stageLabel: itpStage.label(i.stage),
      reference: i.reference, plannedOn: i.plannedOn, result: i.result, resultLabel: itpResult.label(i.result), recordRef: i.recordRef, recordInCodex: !!doc, isCustom: i.isCustom,
      resultOn: i.resultOn, inspector: i.inspectorName, clientWitness: i.clientWitness, resultComment: i.resultComment,
      ncrs: ncrRows.filter((n) => n.inspection === i.number).map((n) => ({ number: n.number, vigieUrl: vigieNcrUrl({ number: n.number, vigieRef: n.vigieRef }) })),
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
    const number = nextBusinessNumber(existing.map((e) => e.n), 'I-', 2, 19);
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

export interface InspectionResultInput {
  result: ItpRecordedResult;
  /** ISO date of the inspection. */
  resultOn: string;
  inspector: string;
  clientWitness?: string | null;
  comment?: string | null;
}

/**
 * "Record result" (R-112, Q-6a): the result of an inspection — Passed, Passed with reservations or Failed — with its date,
 * inspector, the client representative present (hold / witness points) and a comment. Quality, the engineering lead and
 * the director only. With `expected` (the result the viewer saw), a line whose result changed meanwhile is refused
 * ("… has changed") instead of being overwritten blindly. A new result replaces the previous one (re-inspection after a
 * failure); the audit trail keeps every result. Returns the inspection's number.
 */
export async function recordItpResult(projectCode: string, number: string, input: InspectionResultInput, actor: Actor, expected?: ItpResult): Promise<string> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  if (!canRecordItpResult(actor.role)) throw new Error('Only quality and the engineering lead record inspection results');
  if (!ITP_RECORDED_RESULTS.includes(input.result)) throw new Error('Invalid result');
  if (!isIsoDate(input.resultOn)) throw new Error('Invalid inspection date');
  const inspector = requiredText(input.inspector, 'Inspector', 200);
  const clientWitness = optionalText(input.clientWitness, 'Client representative', 200);
  const comment = optionalText(input.comment, 'Comment', 1000);
  if (input.result !== 'passed' && !comment) throw new Error('A comment is required for a failure or reservations');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [plan] = await tx.select({ id: itpPlans.id }).from(itpPlans).where(eq(itpPlans.projectId, p.id));
    if (!plan) throw new Error(`No inspection plan on ${projectCode}`);
    const [i] = await tx.select().from(itpInspections).where(and(eq(itpInspections.planId, plan.id), eq(itpInspections.number, number)));
    if (!i) throw new Error(`Unknown inspection ${number} on ${projectCode}`);
    if (expected && i.result !== expected) throw new Error(`${number} has changed`);
    if (i.pointType === 'hold' && !clientWitness) throw new Error('A hold point names the client representative present');
    const who = await whoIs(tx, actor);
    const person = await findPerson(tx, inspector);
    await tx.update(itpInspections).set({
      result: input.result, resultOn: input.resultOn, inspectorName: person ? nameOf(person) : inspector, inspectorPersonId: person?.id ?? null,
      clientWitness: i.pointType === 'hold' || i.pointType === 'witness' ? clientWitness : null, resultComment: comment, resultRecordedByName: who.who,
      resultRecordedAt: new Date(), updatedAt: new Date(),
    }).where(eq(itpInspections.id, i.id));
    const label = itpResult.label(input.result);
    await trace(tx, who, {
      objectRef: number, change: `result: ${itpResult.label(i.result)} → ${label} · ${input.resultOn} · ${inspector}${comment ? ` · ${comment}` : ''}`, area: 'ITP',
      entityType: 'itp_inspection', entityId: i.id, projectId: p.id,
      activity: { text: `Recorded result ${label} for inspection ${number} ${i.name}`, kind: 'quality' },
    });
    return number;
  });
}

/** One inspection of a project's plan ("I-03"); null when unknown. */
export async function getItpInspection(projectCode: string, number: string): Promise<ItpInspectionRow | null> {
  return (await getItpPlan(projectCode))?.inspections.find((i) => i.number === number) ?? null;
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
    const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, 9);
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
