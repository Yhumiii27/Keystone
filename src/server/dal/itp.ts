import 'server-only';
// Inspection & test plan and punch list DAL (docs/spec/07 §2.4; site punch list 10 §3.6). Keystone owns them.
// The ITP is built from the machine-type template; R-057 (E-9 'a') freezes the template's systems in the plan when it is
// created (itp_plan_systems): editing the machine type later changes the projects created afterwards only. A project without
// a plan follows its live machine type until its first inspection creates the plan. Inspection results are recorded by
// quality and the engineering lead (R-112, Q-6a: `recordItpResult`); a failure is reported as an NCR in Vigie (Q-6b), whose
// number shows on the inspection once Vigie reports the NCR with the inspection (`vigie_ncrs.inspection_number`).
// Punch items (R-117, A-6 'a'): ONE list per project, numbered over the project, each item with its origin (Inspection or
// Site), category, owner (person and / or party), optional NCR and source inspection. Start / Close and "Add punch item"
// live on Inspections & punch list for every item; the Site screen shows the same list read-only (as in the prototype).
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { NCR_REF, canRecordItpResult } from '@/domain/itpcom';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  ITP_RECORDED_RESULTS, itpPointType, itpResult, itpStage, machineType, nextBusinessNumber, punchCategory, punchOrigin, punchOwnerParty, punchSource, punchStatus,
  type ItpPointType, type ItpRecordedResult, type ItpResult, type ItpStage, type PunchCategory, type PunchOrigin, type PunchOwnerParty, type PunchSource, type PunchStatus,
} from '@/server/db/codes';
import { findPerson, nameOf } from '@/server/db/helpers';
import { documents, itpInspections, itpPlanSystems, itpPlans, machineTypeItpSystems, machineTypes, persons, projects, punchItems, vigieNcrs } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { vigieNcrUrl } from '@/server/integrations/vigie/links';
import { isClientContactOf, isIsoDate, optionalDate, optionalText, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { onProjectTeam } from './team-guard';

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
  /** Systems of the plan, frozen from its template when it was created (R-057, E-9 'a'): the groups of the plan. */
  systems: string[];
  inspections: ItpInspectionRow[];
  /** Lines beyond the template (the seed's custom lines + every inspection added in Keystone). */
  customCount: number;
}

/** ITP systems of a machine type today (fallback AUTRE, as `itpSystems` 4940). */
async function systemsOf(q: Q, mt: string | null): Promise<string[]> {
  const read = async (code: string) =>
    (await q.select({ name: machineTypeItpSystems.name }).from(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, code)).orderBy(asc(machineTypeItpSystems.position))).map((r) => r.name);
  const own = mt ? await read(mt) : [];
  return own.length ? own : read('AUTRE');
}

/**
 * R-057 (E-9 'a'): the systems frozen in a plan, in their order. A plan without frozen systems (its type and AUTRE had none
 * when it was created) falls back to its machine type today, then AUTRE.
 */
export async function planSystemsOf(q: Q, plan: { id: string; machineTypeCode: string | null }): Promise<string[]> {
  const rows = await q.select({ name: itpPlanSystems.name }).from(itpPlanSystems).where(eq(itpPlanSystems.planId, plan.id)).orderBy(asc(itpPlanSystems.position));
  return rows.length ? rows.map((r) => r.name) : systemsOf(q, plan.machineTypeCode);
}

/** Freezes the systems of a new plan (R-057): its machine type's today, else AUTRE's; returns them. */
async function freezePlanSystems(q: Q, plan: { id: string; machineTypeCode: string | null }): Promise<string[]> {
  const systems = [...new Set(await systemsOf(q, plan.machineTypeCode))];
  if (systems.length) await q.insert(itpPlanSystems).values(systems.map((name, position) => ({ planId: plan.id, position, name }))).onConflictDoNothing();
  return systems;
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
    projectCode, template: mt?.label ?? plan.machineTypeCode, systems: await planSystemsOf(db, plan),
    inspections: rows.map(({ i, doc }) => ({
      number: i.number, system: i.system, name: i.name, pointType: i.pointType, pointTypeLabel: itpPointType.label(i.pointType), stage: i.stage, stageLabel: itpStage.label(i.stage),
      reference: i.reference, plannedOn: i.plannedOn, result: i.result, resultLabel: itpResult.label(i.result), recordRef: i.recordRef, recordInCodex: !!doc, isCustom: i.isCustom,
      resultOn: i.resultOn, inspector: i.inspectorName, clientWitness: i.clientWitness, resultComment: i.resultComment,
      ncrs: ncrRows.filter((n) => n.inspection === i.number).map((n) => ({ number: n.number, vigieUrl: vigieNcrUrl({ number: n.number, vigieRef: n.vigieRef }) })),
    })),
    customCount: rows.filter((r) => r.i.isCustom).length,
  };
}

/**
 * Template systems of a project (`ITPSYS`): its plan's frozen systems (R-057, E-9 'a'); a project without a plan follows its
 * machine type today (fallback AUTRE) — nothing was instantiated for it yet.
 */
export async function templateSystemsOf(q: Q, project: { id: string; machineTypeCode: string | null }): Promise<string[]> {
  const [plan] = await q.select({ id: itpPlans.id, machineTypeCode: itpPlans.machineTypeCode }).from(itpPlans).where(eq(itpPlans.projectId, project.id));
  return plan ? planSystemsOf(q, plan) : systemsOf(q, project.machineTypeCode);
}

/** Systems offered by "Add inspection" (the plan's frozen systems, else the project's machine-type template, fallback AUTRE — `ITPSYS`). */
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
 * A project without a plan gets one on its first line, from its machine type (AUTRE when untyped), with that type's systems
 * of the moment frozen in it (R-057, E-9 'a'); the system is checked against the plan's frozen systems.
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
    let systems: string[];
    if (!plan) {
      const mt = p.machineTypeCode && (await tx.select({ c: machineTypes.code }).from(machineTypes).where(eq(machineTypes.code, p.machineTypeCode))).length ? p.machineTypeCode : 'AUTRE';
      [plan] = await tx.insert(itpPlans).values({ projectId: p.id, machineTypeCode: mt }).returning();
      systems = await freezePlanSystems(tx, plan);
    } else systems = await planSystemsOf(tx, plan);
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
  /** Origin (R-117, A-6 'a'): 'itp' raised by an inspection, 'site' raised on site. */
  origin: PunchOrigin;
  /** "Inspection" / "Site" (English; translate with t()). */
  originLabel: string;
  number: string;
  description: string;
  /** System / location ('' when none — the Site items of the seed). */
  location: string;
  category: PunchCategory | null;
  categoryLabel: string | null;
  source: PunchSource | null;
  /** "Raised by": "Client inspection", "ITP I-03", "Site walk". */
  sourceText: string | null;
  /** Vigie's NCR number ("NCR-029"); internal only (P-10b). */
  ncrNumber: string | null;
  /** Owner as shown: the person ("L. Fabre"), else the party ("Client", "Keystone" — English labels). */
  owner: string | null;
  /** The owner person as recorded (typed text); null when only a party owns the item. */
  ownerName: string | null;
  ownerParty: PunchOwnerParty | null;
  dueOn: string | null;
  status: PunchStatus;
  statusLabel: string;
  open: boolean;
  /** Next status of "Start" / "Close" (every open item, R-117); null once closed. */
  next: PunchStatus | null;
  position: number;
}

async function loadPunch(q: Q, projectId: string, origin?: PunchOrigin): Promise<PunchRow[]> {
  const rows = await q
    .select({ p: punchItems, insp: itpInspections.number })
    .from(punchItems)
    .leftJoin(itpInspections, eq(itpInspections.id, punchItems.sourceInspectionId))
    .where(and(eq(punchItems.projectId, projectId), origin ? eq(punchItems.register, origin) : undefined))
    .orderBy(asc(punchItems.position), asc(punchItems.number));
  return rows.map(({ p, insp }) => {
    const sourceText = !p.source ? null : p.source === 'itp' && insp ? `ITP ${insp}` : punchSource.label(p.source);
    return {
      origin: p.register, originLabel: punchOrigin.label(p.register), number: p.number, description: p.description, location: p.location, category: p.category,
      categoryLabel: p.category ? punchCategory.label(p.category) : null, source: p.source, sourceText, ncrNumber: p.ncrNumber,
      owner: p.ownerName ?? (p.ownerParty ? punchOwnerParty.label(p.ownerParty) : null), ownerName: p.ownerName, ownerParty: p.ownerParty,
      dueOn: p.dueOn, status: p.status, statusLabel: punchStatus.label(p.status), open: p.status !== 'closed',
      next: p.status === 'closed' ? null : p.status === 'open' ? 'in_progress' : 'closed', position: p.position,
    };
  });
}

/** The project's punch list (R-117: one list, every origin) — or the items of one origin. */
export async function listPunchItems(projectCode: string, origin?: PunchOrigin): Promise<PunchRow[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  return loadPunch(db, p.id, origin);
}

/**
 * Who changes the punch list of a project (re-checked by the writers, R-041): an internal actor on the project's named team
 * (or the director); a client contact of the project's own organisation (the prototype's client has the screen and its
 * primary action, P-10a). Workspace: the Inspections & punch list screen (`requireWorkspace`).
 */
async function editsPunchList(q: Q, actor: Actor, project: { id: string; clientId: string | null }): Promise<boolean> {
  if (actor.role === 'client') return isClientContactOf(q, actor, project.clientId);
  return onProjectTeam(q, actor, project.id);
}

export interface NewPunchInput {
  description: string;
  location?: string | null;
  category: PunchCategory;
  source: PunchSource;
  /** Origin (R-117): raised by an inspection (default) or on site. */
  origin?: PunchOrigin;
  /** Person short or full name ("S. Haddad"); optional. */
  owner?: string | null;
  /** Responsible party (default Keystone). */
  ownerParty?: PunchOwnerParty;
  /** Vigie's NCR number ("NCR-029"); ignored for a client (P-10b). */
  ncrNumber?: string | null;
  dueOn?: string | null;
}

/**
 * "Add punch item" (AF.punch, R-117): Open, numbered over the whole project — P-10, P-11… (demo floor 9, the prototype's
 * `added.punch`), else after the project's highest number — with its origin, owner (person and / or party) and NCR.
 */
export async function addPunchItem(projectCode: string, input: NewPunchInput, actor: Actor): Promise<string> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  const description = requiredText(input.description, 'Item', 300);
  if (!punchCategory.isCode(input.category)) throw new Error('Invalid category');
  if (!punchSource.isCode(input.source)) throw new Error('Invalid source');
  const origin = input.origin ?? 'itp';
  if (!punchOrigin.isCode(origin)) throw new Error('Invalid origin');
  const ownerParty = input.ownerParty ?? 'keystone';
  if (!punchOwnerParty.isCode(ownerParty)) throw new Error('Invalid owner party');
  const dueOn = optionalDate(input.dueOn, 'due date');
  const location = optionalText(input.location, 'System / location', 200) ?? '';
  // P-10b: a client never records (nor sees) a Vigie NCR number.
  const ncrNumber = actor.role === 'client' ? null : optionalText(input.ncrNumber, 'NCR', 40);
  if (ncrNumber && !NCR_REF.test(ncrNumber)) throw new Error('Invalid NCR');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (!(await editsPunchList(tx, actor, p))) throw new Error(`The punch list of ${projectCode} is read-only for ${actor.name}`);
    const ownerName = optionalText(input.owner, 'Owner', 120);
    let ownerPersonId: string | null = null;
    if (ownerName) {
      const [o] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, ownerName));
      const [f] = o ? [o] : await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, ownerName));
      ownerPersonId = f?.id ?? null;
    }
    const existing = await tx.select({ n: punchItems.number, pos: punchItems.position }).from(punchItems).where(eq(punchItems.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, await demoFloor(tx, 9));
    const [row] = await tx.insert(punchItems).values({
      projectId: p.id, register: origin, number, description, location, category: input.category, source: input.source, ncrNumber, ownerName, ownerPersonId, ownerParty,
      dueOn, status: 'open', position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: punchItems.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `punch item added · ${punchOrigin.label(origin)} · ${input.category} · ${description}`, area: 'Punch list', entityType: 'punch_item',
      entityId: row.id, projectId: p.id, after: { origin, category: input.category, ownerParty, owner: ownerName, ncr: ncrNumber, dueOn },
      activity: { text: `Added punch item ${number} (${input.category}) ${description}`, kind: 'quality' },
    });
    return number;
  });
}

/**
 * "Start" (Open → In progress) / "Close" (In progress → Closed) on any item of the project's punch list (R-117: every
 * origin). Returns the new status. With `expected` (the status the viewer saw), an item that moved on in the meantime is
 * refused ("… has moved on") instead of taking a second step.
 */
export async function advancePunchItem(projectCode: string, number: string, actor: Actor, on: string | null = null, expected?: PunchStatus): Promise<PunchStatus> {
  requireWorkspace('itp', actor, 'Inspections & punch list');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (!(await editsPunchList(tx, actor, p))) throw new Error(`The punch list of ${projectCode} is read-only for ${actor.name}`);
    const [it] = await tx.select().from(punchItems).where(and(eq(punchItems.projectId, p.id), eq(punchItems.number, number)));
    if (!it) throw new Error(`Unknown punch item ${number} on ${projectCode}`);
    if (it.status === 'closed') throw new Error(`${number} is closed`);
    if (expected && it.status !== expected) throw new Error(`${number} has moved on`);
    const next: PunchStatus = it.status === 'open' ? 'in_progress' : 'closed';
    await tx.update(punchItems).set({ status: next, closedOn: next === 'closed' ? on : null, updatedAt: new Date() }).where(eq(punchItems.id, it.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `status: ${punchStatus.label(it.status)} → ${punchStatus.label(next)}`, area: 'Punch list', entityType: 'punch_item', entityId: it.id, projectId: p.id,
      before: { status: it.status }, after: { status: next },
    });
    return next;
  });
}

/** Open category-A punch items per project, every origin (R-117: ITP nav badge `itpBadge`; Commissioning "Blocking A"). */
export async function openPunchAByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, status: punchItems.status }).from(punchItems).innerJoin(projects, eq(projects.id, punchItems.projectId))
    .where(eq(punchItems.category, 'A'));
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
