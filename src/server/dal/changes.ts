import 'server-only';
// Change control & baselines DAL (docs/spec/07 §2.2, 11 §3.5 ChangeRequest, §7 #2): the change-request register
// (HLT_CRS_X + CR-005 from the Budget dataset, A-4 resolution of 11 §7) with its 4-step approval chain and WBS
// impact, the baselines, and the writers (new CR, submit, step decisions with the status derived from the chain —
// not the prototype's stuck "In review", 07 OQ1 — and the BL2 → current switch when its CR is approved).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { projectDataDate } from '@/domain/ch4-defaults';
import { getDb, type Tx } from '@/server/db/client';
import {
  CHANGE_STEPS, STATUS_ISO, changeStatus, shortDateOfIso, stepDecision,
  type ChangeStatus, type ChangeStep, type ChangeType, type StepDecision,
} from '@/server/db/codes';
import { findPerson, nameOf, nextNumber, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  baselines, changeRequestSteps, changeRequestWbs, changeRequests, persons, projectControls, projects, users, wbsNodes,
} from '@/server/db/schema';
import { baselineSnapshotSize, createProposedBaseline, snapshotIntoBaseline } from './baselines';
import { getBaselines, type BaselineRow } from './planning';

/** Labels of the change types (CR_TYPES 3497). */
export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = { budget: 'Budget', scope: 'Scope', schedule: 'Schedule' };
/** Approval chain steps (CHAIN 4598): EN source labels. */
export const CHANGE_STEP_LABEL: Record<ChangeStep, string> = {
  pm: 'Project manager', director: 'Portfolio director', client: 'Client / sponsor', ccb: 'Change control board',
};
/** Drawer tag of a step decision. */
export const STEP_DECISION_TAG: Record<StepDecision, string> = { ok: 'Approved', rejected: 'Rejected', na: 'Not required', pending: 'Pending' };

export interface ChainStep {
  step: ChangeStep;
  /** EN source label ("Portfolio director"). */
  label: string;
  /** Who decides: the project PM, the portfolio director, the project's client contact; the director who records the CCB decision (P-6a). */
  approver: string | null;
  /** Null when the dataset has no chain for this CR (CR-005, only known from the Budget dataset). */
  decision: StepDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface ChangeRequestDetail {
  /** "CR-008". */
  id: string;
  title: string;
  types: ChangeType[];
  /** "Budget · Schedule". */
  typesLabel: string;
  /** Signed k€. */
  amount: number;
  /** Signed days on handover (negative = gain). */
  days: number;
  status: ChangeStatus;
  /** 'Draft' | 'In review' | 'Approved' | 'Rejected'. */
  statusLabel: string;
  /** "R. Aubert" / "Steering committee". */
  by: string;
  /** "24 Sep" (display) and ISO date. */
  date: string;
  requestedOn: string | null;
  justification: string | null;
  /** "BL1" / "BL2". */
  baseline: string | null;
  chain: ChainStep[];
  /** WBS impacted with the summary names ("1.4 · Steel structure"). */
  wbs: { code: string; name: string | null; amount: number | null }[];
}

export interface ChangeControl {
  projectCode: string;
  /** Register order (seed order; new CRs are prepended). */
  changeRequests: ChangeRequestDetail[];
  baselines: BaselineRow[];
  /** BL1 original budget (recon.orig), current BAC and contingency (recon.cont); null without project controls. */
  originalBudget: number | null;
  bac: number;
  contingency: number | null;
}

/**
 * CR status from its chain (logic 4593 without the stuck override): drafts stay drafts; once submitted, any
 * rejected step → rejected; every required (non-n/a) step ok → approved; else in review.
 */
export function deriveChangeStatus(current: ChangeStatus, chain: Partial<Record<ChangeStep, StepDecision>>): ChangeStatus {
  if (current === 'draft') return 'draft';
  const need = Object.values(chain).filter((d) => d !== 'na');
  if (!need.length) return current;
  if (need.some((d) => d === 'rejected')) return 'rejected';
  if (need.every((d) => d === 'ok')) return 'approved';
  return 'in_review';
}

/** Approvers of each step for a project (CHAIN follows the project instead of the prototype's fixed names). */
async function chainApprovers(projectCode: string): Promise<Record<ChangeStep, string | null>> {
  const db = await getDb();
  const pm = alias(persons, 'pm');
  const [p] = await db
    .select({ pmFull: pm.fullName, pmShort: pm.shortName, clientId: projects.clientId })
    .from(projects)
    .leftJoin(pm, eq(pm.id, projects.pmPersonId))
    .where(eq(projects.code, projectCode));
  const people = await db
    .select({ role: users.role, clientId: users.clientId, full: persons.fullName, short: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId));
  const director = people.find((u) => u.role === 'director');
  const client = p?.clientId ? people.find((u) => u.clientId === p.clientId) : undefined;
  return {
    pm: p ? (p.pmFull ?? p.pmShort) : null,
    director: director ? (director.full ?? director.short) : null,
    client: client ? (client.full ?? client.short) : null,
    // P-6a: the portfolio director records the change control board's decision (R-169: the prototype printed the
    // constant cadence "Monthly · next 8 Oct").
    ccb: director ? (director.full ?? director.short) : null,
  };
}

/** Change requests of a project with chain and WBS (empty for projects without changes). */
export async function listChangeRequestDetails(projectCode: string): Promise<ChangeRequestDetail[]> {
  const db = await getDb();
  const crs = await db
    .select({ cr: changeRequests })
    .from(changeRequests)
    .innerJoin(projects, eq(projects.id, changeRequests.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(changeRequests.position));
  if (!crs.length) return [];
  const ids = crs.map(({ cr }) => cr.id);
  const decider = alias(persons, 'decider');
  const [steps, wbs, approvers] = await Promise.all([
    db
      .select({ s: changeRequestSteps, full: decider.fullName, short: decider.shortName })
      .from(changeRequestSteps)
      .leftJoin(decider, eq(decider.id, changeRequestSteps.decidedByPersonId))
      .where(inArray(changeRequestSteps.changeRequestId, ids))
      .orderBy(asc(changeRequestSteps.position)),
    db
      .select({ w: changeRequestWbs, name: wbsNodes.name })
      .from(changeRequestWbs)
      .leftJoin(wbsNodes, eq(wbsNodes.id, changeRequestWbs.wbsNodeId))
      .where(inArray(changeRequestWbs.changeRequestId, ids))
      .orderBy(asc(changeRequestWbs.position)),
    chainApprovers(projectCode),
  ]);
  return crs.map(({ cr }) => {
    const own = steps.filter((s) => s.s.changeRequestId === cr.id);
    return {
      id: cr.number, title: cr.title, types: cr.types, typesLabel: cr.types.map((t) => CHANGE_TYPE_LABEL[t]).join(' · '), amount: cr.amountKeur,
      days: cr.scheduleDays, status: cr.status, statusLabel: changeStatus.label(cr.status), by: cr.requestedBy, date: cr.requestedOnText,
      requestedOn: cr.requestedOn, justification: cr.justification, baseline: cr.baselineCode,
      chain: CHANGE_STEPS.map((step) => {
        const s = own.find((x) => x.s.step === step);
        return {
          step, label: CHANGE_STEP_LABEL[step], approver: approvers[step], decision: s?.s.decision ?? null,
          decidedBy: s ? (s.full ?? s.short ?? null) : null, decidedAt: s?.s.decidedAt?.toISOString() ?? null, comment: s?.s.comment ?? null,
        };
      }),
      wbs: wbs.filter((w) => w.w.changeRequestId === cr.id).map((w) => ({ code: w.w.wbsCode, name: w.name, amount: w.w.amountKeur })),
    };
  });
}

/** Everything the Change control screen reads; null for an unknown project. */
export async function getChangeControl(projectCode: string): Promise<ChangeControl | null> {
  const db = await getDb();
  const [p] = await db
    .select({ bac: projects.budgetKeur, orig: projectControls.reconOrigKeur, cont: projectControls.contingencyKeur })
    .from(projects)
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) return null;
  const [crs, bls] = await Promise.all([listChangeRequestDetails(projectCode), getBaselines(projectCode)]);
  return { projectCode, changeRequests: crs, baselines: bls, originalBudget: p.orig ?? null, bac: p.bac, contingency: p.cont ?? null };
}

/** CRs in review whose step for `step` is pending — the My approvals "Change request" source (pm, director, client). */
export async function listChangeRequestsAwaiting(projectCode: string, step: ChangeStep): Promise<ChangeRequestDetail[]> {
  return (await listChangeRequestDetails(projectCode)).filter((c) => c.status === 'in_review' && c.chain.find((s) => s.step === step)?.decision === 'pending');
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface NewChangeRequestInput {
  title: string;
  /** AF.changes type: Scope, Budget, Schedule, or Scope + budget. */
  types: ChangeType[];
  amountKeur: number;
  scheduleDays: number;
  /** WBS codes ("1.4"); default the project root "1". */
  wbsCodes?: string[];
  /** Required by the form (stored, unlike the prototype — 07 OQ17). */
  justification?: string;
  baselineCode?: string;
  /** false → saved as Draft; default true: submitted, every step pending (afSubmit). */
  submit?: boolean;
  /** Business date (default the status date). */
  requestedOn?: string;
  /**
   * S-3: the request proposes the project's next baseline (Plan "Set baseline" after BL1). An empty proposed BLn is linked to
   * it and becomes the request's baseline; the snapshot is taken at approval.
   */
  proposeBaseline?: boolean;
}

/** Raises a change request (CR-011…, global sequence) prepended to the register. Returns its number. */
export async function createChangeRequest(projectCode: string, input: NewChangeRequestInput, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const number = await nextNumber(tx, changeRequests, changeRequests.number, 'CR-', 3, 10);
    const actor = await findPerson(tx, actorName);
    const [{ minPos }] = await tx
      .select({ minPos: sql<number>`coalesce(min(${changeRequests.position}), 0)::int` })
      .from(changeRequests)
      .where(eq(changeRequests.projectId, p.id));
    const on = input.requestedOn ?? STATUS_ISO;
    const status: ChangeStatus = input.submit === false ? 'draft' : 'in_review';
    const [cr] = await tx
      .insert(changeRequests)
      .values({
        projectId: p.id, number, title: input.title.trim(), types: input.types, amountKeur: Math.round(input.amountKeur) || 0,
        scheduleDays: Math.round(input.scheduleDays) || 0, status, requestedBy: actor?.shortName ?? actorName, requestedByPersonId: actor?.id ?? null,
        requestedOnText: shortDateOfIso(on), requestedOn: on, baselineCode: input.baselineCode ?? 'BL1', justification: input.justification?.trim() || null,
        position: minPos - 1,
      })
      .returning({ id: changeRequests.id });
    await tx.insert(changeRequestSteps).values(CHANGE_STEPS.map((step, position) => ({ changeRequestId: cr.id, step, decision: 'pending' as const, position })));
    if (input.proposeBaseline) {
      const blCode = await createProposedBaseline(tx, { projectId: p.id, changeRequestId: cr.id, changeRequestNumber: number, actorName, comment: input.justification });
      await tx.update(changeRequests).set({ baselineCode: blCode }).where(eq(changeRequests.id, cr.id));
    }
    const codes = input.wbsCodes?.length ? input.wbsCodes : ['1'];
    const nodes = await tx.select({ id: wbsNodes.id, code: wbsNodes.code }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), inArray(wbsNodes.code, codes)));
    await tx.insert(changeRequestWbs).values(
      codes.map((wbsCode, position) => ({ changeRequestId: cr.id, wbsCode, wbsNodeId: nodes.find((n) => n.code === wbsCode)?.id ?? null, position })),
    );
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `created · status: ${changeStatus.label(status)}`,
      area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: p.id,
    });
    return number;
  });
}

async function loadCr(tx: Tx, projectCode: string, number: string) {
  const p = await requireProject(tx, projectCode);
  const [cr] = await tx.select().from(changeRequests).where(and(eq(changeRequests.projectId, p.id), eq(changeRequests.number, number)));
  if (!cr) throw new Error(`Unknown change request ${number} on ${projectCode}`);
  return { p, cr };
}

/** "Submit for review": Draft → In review (audit + activity "Submitted CR-008 for review · +85 k€ · −12 d"). */
export async function submitChangeRequest(projectCode: string, number: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, cr } = await loadCr(tx, projectCode, number);
    if (cr.status !== 'draft') throw new Error(`${number} is not a draft`);
    await tx.update(changeRequests).set({ status: 'in_review', updatedAt: new Date() }).where(eq(changeRequests.id, cr.id));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: 'status: Draft → In review', area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: p.id });
    const amt = cr.amountKeur ? ` · ${cr.amountKeur > 0 ? '+' : '−'}${Math.abs(cr.amountKeur)} k€` : '';
    const days = cr.scheduleDays ? ` · ${cr.scheduleDays > 0 ? '+' : '−'}${Math.abs(cr.scheduleDays)} d` : '';
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Submitted ${number} for review${amt}${days}`, kind: 'change', projectId: p.id });
  });
}

/**
 * Records one approval-chain decision (crOv.chain): only on a CR in review and a pending step. The status is
 * re-derived from the chain; when the CR becomes approved, the proposed baseline it carries (BL2 ↔ CR-009)
 * becomes current and the previous current one superseded. Returns the new status. Permission (which persona
 * decides which step; the CCB has none, 07 OQ2) is the caller's check.
 */
export async function decideChangeStep(
  projectCode: string, number: string, step: ChangeStep, decision: 'ok' | 'rejected', actorName: string, comment?: string,
): Promise<ChangeStatus> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, cr } = await loadCr(tx, projectCode, number);
    if (cr.status !== 'in_review') throw new Error(`${number} is not in review`);
    const steps = await tx.select().from(changeRequestSteps).where(eq(changeRequestSteps.changeRequestId, cr.id));
    const s = steps.find((x) => x.step === step);
    if (!s || s.decision !== 'pending') throw new Error(`${number}: step ${step} is not pending`);
    const actor = await findPerson(tx, actorName);
    const at = new Date();
    await tx
      .update(changeRequestSteps)
      .set({ decision, decidedByPersonId: actor?.id ?? null, decidedAt: at, comment: comment?.trim() || null })
      .where(and(eq(changeRequestSteps.changeRequestId, cr.id), eq(changeRequestSteps.step, step)));
    const chain = Object.fromEntries(steps.map((x) => [x.step, x.step === step ? decision : x.decision])) as Record<ChangeStep, StepDecision>;
    const status = deriveChangeStatus(cr.status, chain);
    const who = actor ? nameOf(actor) : actorName;
    const changes = [`${step}: pending → ${stepDecision.label(decision)}`];
    if (status !== cr.status) {
      await tx.update(changeRequests).set({ status, updatedAt: at }).where(eq(changeRequests.id, cr.id));
      changes.push(`status: ${changeStatus.label(cr.status)} → ${changeStatus.label(status)}`);
    }
    if (status === 'approved') {
      const [bl] = await tx.select().from(baselines).where(and(eq(baselines.changeRequestId, cr.id), eq(baselines.state, 'proposed')));
      if (bl) {
        // S-3 / §3.1 gap (1): the proposed baseline becomes current, set on the project data date (S-4). A baseline without an
        // activity snapshot (the seed's BL2 "Pending CR-009", or one proposed from the Plan) is filled with the activities now;
        // one frozen with its snapshot by the Schedule "Re-baseline" keeps it.
        const [proj] = await tx.select({ dataDate: projects.dataDate }).from(projects).where(eq(projects.id, p.id));
        const setOn = projectDataDate(proj ?? {});
        if (!(await baselineSnapshotSize(bl.id, tx))) {
          const n = await snapshotIntoBaseline(projectCode, bl.code, { actorName, makeCurrent: true, setOn }, tx);
          changes.push(`${bl.code} snapshot · ${n} activities`);
        } else {
          await tx.update(baselines).set({ state: 'superseded', updatedAt: at }).where(and(eq(baselines.projectId, p.id), eq(baselines.state, 'current')));
          await tx.update(baselines).set({ state: 'current', setOn, updatedAt: at }).where(eq(baselines.id, bl.id));
        }
        changes.push(`${bl.code} current`);
      }
    }
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: changes.join(' · '), area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: p.id });
    return status;
  });
}
