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
// R-185 part 2 (choice 4): one plan per equipment line of the project (`itp_plans.equipment_id`; the main line's plan is the
// plan of before R-185), inspections numbered over the project's plans; a punch item carries its line (that of the source
// inspection's plan, else the one chosen, else common).
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { lineOfRef, mainLineOf } from '@/domain/equipment-scope';
import { equipmentLotLabel } from '@/domain/project-equipment';
import { NCR_REF, canRecordItpResult } from '@/domain/itpcom';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  ITP_RECORDED_RESULTS, itpPointType, itpResult, itpStage, machineType, nextBusinessNumber, punchCategory, punchOrigin, punchOwnerParty, punchSource, punchStatus,
  type ItpPointType, type ItpRecordedResult, type ItpResult, type ItpStage, type MachineTypeCode, type PunchCategory, type PunchOrigin, type PunchOwnerParty, type PunchSource, type PunchStatus,
} from '@/server/db/codes';
import { findPerson, nameOf } from '@/server/db/helpers';
import { documents, itpInspections, itpPlanSystems, itpPlans, machineTypeItpSystems, machineTypes, persons, projectEquipments, projects, punchItems, vigieNcrs } from '@/server/db/schema';
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
  /** R-185 (choice 4): the equipment line of the plan ("EQ-02", "EQ-02 · 3 × MEMU"); null for a project without line. */
  equipment?: { ref: string; label: string } | null;
  /** Template the plan was built from ("EMP"); null when the project has no plan yet. */
  template: string | null;
  /** Systems of the plan, frozen from its template when it was created (R-057, E-9 'a'): the groups of the plan. */
  systems: string[];
  inspections: ItpInspectionRow[];
  /** Lines beyond the template (the seed's custom lines + every inspection added in Keystone). */
  customCount: number;
}

/** R-185: an equipment line as the ITP sees it — "EQ-02 · 3 × MEMU" (`equipmentLotLabel`). */
export interface PlanLine {
  id: string;
  ref: string;
  machineTypeCode: string;
  quantity: number;
  position: number;
  label: string;
}

/** The equipment lines of a project, main line first. */
export async function planLinesOf(q: Q, projectId: string): Promise<PlanLine[]> {
  const rows = await q
    .select({ e: projectEquipments, typeLabel: machineTypes.label })
    .from(projectEquipments)
    .leftJoin(machineTypes, eq(machineTypes.code, projectEquipments.machineTypeCode))
    .where(eq(projectEquipments.projectId, projectId))
    .orderBy(asc(projectEquipments.position), asc(projectEquipments.ref));
  return rows.map(({ e, typeLabel }) => {
    const type = typeLabel ?? (machineType.isCode(e.machineTypeCode) ? machineType.label(e.machineTypeCode) : e.machineTypeCode);
    return { id: e.id, ref: e.ref, machineTypeCode: e.machineTypeCode, quantity: e.quantity, position: e.position, label: equipmentLotLabel({ ref: e.ref, typeLabel: type, quantity: e.quantity }) };
  });
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

type PlanRow = typeof itpPlans.$inferSelect;

/** The plans of a project. */
const plansOf = (q: Q, projectId: string): Promise<PlanRow[]> => q.select().from(itpPlans).where(eq(itpPlans.projectId, projectId));

/**
 * R-185: the plan of a line — or, for a project without line (`line` null), its plan without line. A project whose lines all
 * came after its plan without line (an untyped project given a line on the Contract screen) still reads that plan for its main
 * line until the line's plan is created (`ensureEquipmentPlan` attaches it).
 */
function planOfLine(plans: readonly PlanRow[], line: PlanLine | null, main: boolean): PlanRow | null {
  if (!line) return plans.find((p) => p.equipmentId === null) ?? null;
  return plans.find((p) => p.equipmentId === line.id) ?? (main ? plans.find((p) => p.equipmentId === null) ?? null : null);
}

/** The line a request names (`ref`), else the main line; throws on an unknown reference. Null for a project without line. */
function requireLine(lines: readonly PlanLine[], ref: string | null | undefined, projectCode: string): PlanLine | null {
  const line = lineOfRef(lines, ref);
  if (ref && !line) throw new Error(`Unknown equipment ${ref} on ${projectCode}`);
  return line;
}

async function loadPlan(q: Q, projectCode: string, plan: PlanRow, line: PlanLine | null): Promise<ItpPlan> {
  const rows = await q
    .select({ i: itpInspections, doc: documents.number })
    .from(itpInspections)
    .leftJoin(documents, eq(documents.id, itpInspections.recordDocumentId))
    .where(eq(itpInspections.planId, plan.id))
    .orderBy(asc(itpInspections.position));
  const [[mt], ncrRows] = await Promise.all([
    q.select({ label: machineTypes.label }).from(machineTypes).where(eq(machineTypes.code, plan.machineTypeCode)),
    q.select({ number: vigieNcrs.number, vigieRef: vigieNcrs.vigieRef, inspection: vigieNcrs.inspectionNumber }).from(vigieNcrs)
      .where(and(eq(vigieNcrs.projectCode, projectCode), isNotNull(vigieNcrs.inspectionNumber))).orderBy(asc(vigieNcrs.position)),
  ]);
  return {
    projectCode, equipment: line ? { ref: line.ref, label: line.label } : null, template: mt?.label ?? plan.machineTypeCode, systems: await planSystemsOf(q, plan),
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
 * The inspection & test plan of a project's equipment line (R-185, choice 4: one plan per line) — `equipmentRef` "EQ-02", else
 * the main line (the plan of before R-185). Null when the line has no plan yet (or the reference is unknown).
 */
export async function getItpPlan(projectCode: string, equipmentRef?: string | null): Promise<ItpPlan | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [lines, plans] = await Promise.all([planLinesOf(db, p.id), plansOf(db, p.id)]);
  const line = lineOfRef(lines, equipmentRef);
  if (equipmentRef && !line) return null;
  const plan = planOfLine(plans, line, !!line && line === mainLineOf(lines));
  return plan ? loadPlan(db, projectCode, plan, line) : null;
}

/** R-185: every plan of a project, in the order of its lines (the plan without line of an untyped project alone). */
export async function getItpPlans(projectCode: string): Promise<ItpPlan[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [lines, plans] = await Promise.all([planLinesOf(db, p.id), plansOf(db, p.id)]);
  const main = mainLineOf(lines);
  const out: ItpPlan[] = [];
  const seen = new Set<string>();
  for (const line of lines.length ? lines : [null]) {
    const plan = planOfLine(plans, line, line === main);
    if (!plan || seen.has(plan.id)) continue;
    seen.add(plan.id);
    out.push(await loadPlan(db, projectCode, plan, line));
  }
  return out;
}

/**
 * Template systems of a line (`ITPSYS`): its plan's frozen systems (R-057, E-9 'a'); a line without a plan follows its machine
 * type today (fallback AUTRE) — nothing was instantiated for it yet. Without `line`: the project's plan without line, else its
 * main type.
 */
async function lineSystemsOf(q: Q, project: { id: string; machineTypeCode: string | null }, line: PlanLine | null, lines: readonly PlanLine[]): Promise<string[]> {
  const plan = planOfLine(await plansOf(q, project.id), line, !!line && line === mainLineOf(lines));
  return plan ? planSystemsOf(q, plan) : systemsOf(q, line ? line.machineTypeCode : project.machineTypeCode);
}

/**
 * Template systems of a project (`ITPSYS`, the "Plan SAT" systems without commissioning plan): R-185 — the systems of every
 * line's plan (else its type today), main line first, each name once. One line: its plan's systems, as before R-185.
 */
export async function templateSystemsOf(q: Q, project: { id: string; machineTypeCode: string | null }): Promise<string[]> {
  const lines = await planLinesOf(q, project.id);
  const out: string[] = [];
  for (const line of lines.length ? lines : [null]) for (const s of await lineSystemsOf(q, project, line, lines)) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Systems offered by "Add inspection" for a line (`equipmentRef`, else the main line): the plan's frozen systems, else the
 * line's machine-type template, fallback AUTRE — `ITPSYS`. [] for an unknown line.
 */
export async function listItpSystems(projectCode: string, equipmentRef?: string | null): Promise<string[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const lines = await planLinesOf(db, p.id);
  const line = lineOfRef(lines, equipmentRef);
  if (equipmentRef && !line) return [];
  return lineSystemsOf(db, p, line, lines);
}

/** The "Plan SAT" systems without commissioning plan: every line's template systems (R-185), each once. */
export async function listProjectTemplateSystems(projectCode: string): Promise<string[]> {
  const db = await getDb();
  return templateSystemsOf(db, await projectOf(db, projectCode));
}

/**
 * Creates the plan of a line (R-185, choice 4) with its machine type's ITP systems of today frozen (R-057, E-9 'a'), unless the
 * line has one. The first line of a project that had a plan without line (an untyped project) takes that plan instead. Used by
 * the wizard (lines after the first) and by the Equipment card's "Add". Returns the plan id.
 */
export async function ensureEquipmentPlan(tx: Tx, projectId: string, equipmentId: string): Promise<string> {
  const plans = await plansOf(tx, projectId);
  const own = plans.find((p) => p.equipmentId === equipmentId);
  if (own) return own.id;
  const orphan = plans.find((p) => p.equipmentId === null);
  if (orphan && !plans.some((p) => p.equipmentId !== null)) {
    await tx.update(itpPlans).set({ equipmentId, updatedAt: new Date() }).where(eq(itpPlans.id, orphan.id));
    return orphan.id;
  }
  const [line] = await tx.select({ mt: projectEquipments.machineTypeCode }).from(projectEquipments).where(eq(projectEquipments.id, equipmentId));
  if (!line) throw new Error('Unknown equipment line');
  const [plan] = await tx.insert(itpPlans).values({ projectId, equipmentId, machineTypeCode: line.mt }).returning();
  await freezePlanSystems(tx, plan);
  return plan.id;
}

/** Inspections of a line's plan (0 without plan): a line whose plan has inspections is not removed (`equipmentRemovalBlocker`). */
export async function equipmentPlanInspections(q: Q, equipmentId: string): Promise<number> {
  const rows = await q.select({ id: itpInspections.id }).from(itpInspections).innerJoin(itpPlans, eq(itpPlans.id, itpInspections.planId)).where(eq(itpPlans.equipmentId, equipmentId));
  return rows.length;
}

/**
 * A line's type changed (R-185): its plan without inspection is rebuilt from the new type (systems of today frozen); a plan
 * with inspections keeps its type and systems (R-057: what was instantiated stays). Returns whether the plan was rebuilt.
 */
export async function rebuildEquipmentPlan(tx: Tx, equipmentId: string, machineTypeCode: string): Promise<boolean> {
  const [plan] = await tx.select().from(itpPlans).where(eq(itpPlans.equipmentId, equipmentId));
  if (!plan || plan.machineTypeCode === machineTypeCode) return false;
  if (await equipmentPlanInspections(tx, equipmentId)) return false;
  await tx.delete(itpPlanSystems).where(eq(itpPlanSystems.planId, plan.id));
  await tx.update(itpPlans).set({ machineTypeCode: machineTypeCode as MachineTypeCode, updatedAt: new Date() }).where(eq(itpPlans.id, plan.id));
  await freezePlanSystems(tx, { id: plan.id, machineTypeCode });
  return true;
}

/** Every inspection number of a project's plans (R-185: numbered over the project, so "I-14" names one inspection). */
async function projectInspectionNumbers(q: Q, projectId: string): Promise<string[]> {
  return (await q.select({ n: itpInspections.number }).from(itpInspections).innerJoin(itpPlans, eq(itpPlans.id, itpInspections.planId)).where(eq(itpPlans.projectId, projectId))).map((r) => r.n);
}

export interface NewInspectionInput {
  name: string;
  system: string;
  pointType: ItpPointType;
  stage: ItpStage;
  reference?: string | null;
  /** ISO date; optional. */
  plannedOn?: string | null;
  /** R-185: the equipment line whose plan gets the line ("EQ-02"); default the main line. */
  equipment?: string | null;
}

/**
 * "Add inspection" (AF.itp): a Planned line of a plan, numbered I-20, I-21… over the project (the prototype's `added.itp`;
 * R-185: one numbering for every plan of the project). The plan is the equipment line's (`input.equipment`, default the main
 * line); a line without a plan gets one on its first line, from its machine type (a project without line: its type, AUTRE when
 * untyped), with that type's systems of the moment frozen in it (R-057, E-9 'a'); the system is checked against the plan's
 * frozen systems.
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
    const lines = await planLinesOf(tx, p.id);
    const line = requireLine(lines, input.equipment, projectCode);
    let plan = planOfLine(await plansOf(tx, p.id), line, !!line && line === mainLineOf(lines));
    if (!plan) {
      if (line) [plan] = await tx.select().from(itpPlans).where(eq(itpPlans.id, await ensureEquipmentPlan(tx, p.id, line.id)));
      else {
        const mt = p.machineTypeCode && (await tx.select({ c: machineTypes.code }).from(machineTypes).where(eq(machineTypes.code, p.machineTypeCode))).length ? p.machineTypeCode : 'AUTRE';
        [plan] = await tx.insert(itpPlans).values({ projectId: p.id, machineTypeCode: mt as MachineTypeCode }).returning();
        await freezePlanSystems(tx, plan);
      }
    }
    const systems = await planSystemsOf(tx, plan);
    if (!systems.includes(input.system)) throw new Error(`Unknown system "${input.system}" for this plan`);
    const existing = await tx.select({ pos: itpInspections.position }).from(itpInspections).where(eq(itpInspections.planId, plan.id));
    const number = nextBusinessNumber(await projectInspectionNumbers(tx, p.id), 'I-', 2, await demoFloor(tx, 19));
    const [row] = await tx.insert(itpInspections).values({
      planId: plan.id, number, system: input.system, name, pointType: input.pointType, stage: input.stage, reference, plannedOn, result: 'planned', isCustom: true,
      position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: itpInspections.id });
    const on = line && lines.length > 1 ? ` · ${line.ref}` : '';
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `inspection added · ${input.system} · ${name}${on}`, area: 'ITP', entityType: 'itp_inspection', entityId: row.id, projectId: p.id,
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
 * failure); the audit trail keeps every result. The inspection is found in any plan of the project (R-185). Returns the
 * inspection's number.
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
    const plans = await plansOf(tx, p.id);
    if (!plans.length) throw new Error(`No inspection plan on ${projectCode}`);
    const [i] = await tx.select().from(itpInspections).where(and(inArray(itpInspections.planId, plans.map((x) => x.id)), eq(itpInspections.number, number)));
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

/** One inspection of a project's plans ("I-03", any equipment line); null when unknown. */
export async function getItpInspection(projectCode: string, number: string): Promise<ItpInspectionRow | null> {
  return (await getItpPlans(projectCode)).flatMap((p) => p.inspections).find((i) => i.number === number) ?? null;
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
  /** R-185: the equipment line concerned ("EQ-02"); null = common to the project. */
  equipmentRef?: string | null;
}

async function loadPunch(q: Q, projectId: string, origin?: PunchOrigin): Promise<PunchRow[]> {
  const rows = await q
    .select({ p: punchItems, insp: itpInspections.number, eq: projectEquipments.ref })
    .from(punchItems)
    .leftJoin(itpInspections, eq(itpInspections.id, punchItems.sourceInspectionId))
    .leftJoin(projectEquipments, eq(projectEquipments.id, punchItems.equipmentId))
    .where(and(eq(punchItems.projectId, projectId), origin ? eq(punchItems.register, origin) : undefined))
    .orderBy(asc(punchItems.position), asc(punchItems.number));
  return rows.map(({ p, insp, eq: equipmentRef }) => {
    const sourceText = !p.source ? null : p.source === 'itp' && insp ? `ITP ${insp}` : punchSource.label(p.source);
    return {
      origin: p.register, originLabel: punchOrigin.label(p.register), number: p.number, description: p.description, location: p.location, category: p.category,
      categoryLabel: p.category ? punchCategory.label(p.category) : null, source: p.source, sourceText, ncrNumber: p.ncrNumber,
      owner: p.ownerName ?? (p.ownerParty ? punchOwnerParty.label(p.ownerParty) : null), ownerName: p.ownerName, ownerParty: p.ownerParty,
      dueOn: p.dueOn, status: p.status, statusLabel: punchStatus.label(p.status), open: p.status !== 'closed',
      next: p.status === 'closed' ? null : p.status === 'open' ? 'in_progress' : 'closed', position: p.position, equipmentRef: equipmentRef ?? null,
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
  /** R-185: the equipment line concerned ("EQ-02"); null / absent = common to the project. */
  equipment?: string | null;
  /** R-185: the inspection that raised the item ("I-14", any plan of the project): the item takes its plan's line. */
  sourceInspection?: string | null;
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
    // R-185: the line of the source inspection's plan, else the line chosen, else common.
    const lines = await planLinesOf(tx, p.id);
    let equipment: PlanLine | null = null;
    let sourceInspectionId: string | null = null;
    if (input.sourceInspection) {
      const [i] = await tx.select({ id: itpInspections.id, equipmentId: itpPlans.equipmentId }).from(itpInspections).innerJoin(itpPlans, eq(itpPlans.id, itpInspections.planId))
        .where(and(eq(itpPlans.projectId, p.id), eq(itpInspections.number, input.sourceInspection)));
      if (!i) throw new Error(`Unknown inspection ${input.sourceInspection} on ${projectCode}`);
      sourceInspectionId = i.id;
      equipment = lines.find((l) => l.id === i.equipmentId) ?? null;
    }
    if (!equipment && input.equipment) {
      equipment = lines.find((l) => l.ref === input.equipment) ?? null;
      if (!equipment) throw new Error(`Unknown equipment ${input.equipment} on ${projectCode}`);
    }
    const existing = await tx.select({ n: punchItems.number, pos: punchItems.position }).from(punchItems).where(eq(punchItems.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, await demoFloor(tx, 9));
    const [row] = await tx.insert(punchItems).values({
      projectId: p.id, register: origin, number, description, location, category: input.category, source: input.source, sourceInspectionId, ncrNumber, ownerName, ownerPersonId, ownerParty,
      dueOn, status: 'open', position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0), equipmentId: equipment?.id ?? null,
    }).returning({ id: punchItems.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `punch item added · ${punchOrigin.label(origin)} · ${input.category} · ${description}${equipment && lines.length > 1 ? ` · ${equipment.ref}` : ''}`, area: 'Punch list', entityType: 'punch_item',
      entityId: row.id, projectId: p.id, after: { origin, category: input.category, ownerParty, owner: ownerName, ncr: ncrNumber, dueOn, ...(equipment ? { equipment: equipment.ref } : {}) },
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
