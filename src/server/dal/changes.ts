import 'server-only';
// Change control & baselines DAL (docs/spec/07 §2.2, 11 §3.5 ChangeRequest, §7 #2): the change-request register
// (HLT_CRS_X + CR-005 from the Budget dataset, A-4 resolution of 11 §7) with its 4-step approval chain and WBS
// impact, the baselines, and the writers (new CR, submit, step decisions with the status derived from the chain —
// not the prototype's stuck "In review", 07 OQ1 — and the BL2 → current switch when its CR is approved).
// Delivery 8 (R-069, P-6b / P-6c): the steps a request needs are fixed when it is submitted (`requiredSteps`: client 'n/a' for an
// internal change, board 'n/a' up to the Settings threshold) and the chain is decided in order (`currentStep`): a step that is
// not the current one is refused (ChangeStepError 'not_current').
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { projectDataDate } from '@/domain/ch4-defaults';
import { businessToday } from '@/server/clock';
import { currentStep, requiredSteps } from '@/domain/change-control';
import { getDb, type Tx } from '@/server/db/client';
import {
  CHANGE_STEPS, changeStatus, contractImpact as contractImpactCodec, shortDateOfIso, stepDecision,
  type ChangeStatus, type ChangeStep, type ChangeType, type ContractImpact, type StepDecision,
} from '@/server/db/codes';
import { findPerson, nameOf, nextNumber, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  baselines, changeRequestSteps, changeRequestWbs, changeRequests, persons, projectControls, projects, users, wbsNodes,
} from '@/server/db/schema';
import { baselineNumber } from '@/domain/baseline-policy';
import { baselineSnapshotSize, createProposedBaseline, snapshotIntoBaseline } from './baselines';
import { markBl1Deliverable } from './lifecycle';
import { postApprovedChange } from './change-posting';
import { readCcbThreshold } from './change-settings';
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
  /** Delivery 8 (R-069): contractual impact (null on a request raised before it was asked and not backfilled). */
  contractImpact: ContractImpact | null;
  /** Delivery 8 (R-081): project cost category the approved request moves — internal, never shown to the client. */
  costCategoryCode: string | null;
  /** Person who raised the request (R-015: told of the final decision). */
  requestedByPersonId: string | null;
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
    .select({ roles: users.roles, clientId: users.clientId, full: persons.fullName, short: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(eq(users.active, true))
    .orderBy(asc(users.sortOrder));
  const director = people.find((u) => u.roles.includes('director'));
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
      contractImpact: cr.contractImpact ?? null, costCategoryCode: cr.costCategoryCode ?? null, requestedByPersonId: cr.requestedByPersonId ?? null,
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

/** CRs in review waiting for `step` — their current step (R-069, P-6b: the chain is decided in order). */
export async function listChangeRequestsAwaiting(projectCode: string, step: ChangeStep): Promise<ChangeRequestDetail[]> {
  return (await listChangeRequestDetails(projectCode)).filter((c) => c.status === 'in_review' && currentStep(c.chain) === step);
}

/**
 * A step decision the chain refuses: the request is not in review, the step is not pending, or (R-069) an earlier step still
 * waits (`not_current`). The Server Functions answer "Not yours to decide yet" for `not_current`.
 */
export class ChangeStepError extends Error {
  readonly code: 'not_in_review' | 'not_pending' | 'not_current';
  constructor(code: ChangeStepError['code'], message: string) {
    super(message);
    this.name = 'ChangeStepError';
    this.code = code;
  }
}

/** Approval steps of a request from the rule in force (R-069): the board threshold is read in the writer's transaction. */
async function stepRows(tx: Tx, changeRequestId: string, input: { contractImpact: ContractImpact | null; amountKeur: number }) {
  const req = requiredSteps({ contractImpact: input.contractImpact, amountKeur: input.amountKeur, ccbThresholdKeur: await readCcbThreshold(tx) });
  return CHANGE_STEPS.map((step, position) => ({ changeRequestId, step, decision: req[step], position }));
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
  /** Business date (default the business date, R-013). */
  requestedOn?: string;
  /**
   * S-3: the request proposes the project's next baseline (Plan "Set baseline" after BL1). An empty proposed BLn is linked to
   * it and becomes the request's baseline; the snapshot is taken at approval.
   */
  proposeBaseline?: boolean;
  /** Delivery 8 (R-069, P-6c): required on the form; absent (older callers) = not recorded, the client step stays required. */
  contractImpact?: ContractImpact | null;
  /** Delivery 8 (R-081): a cost category code of the project ("C03"); the caller checks it belongs to the project. */
  costCategoryCode?: string | null;
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
    const on = input.requestedOn ?? (await businessToday(tx));
    const status: ChangeStatus = input.submit === false ? 'draft' : 'in_review';
    const impact = input.contractImpact != null && contractImpactCodec.isCode(input.contractImpact) ? input.contractImpact : null;
    const amountKeur = Math.round(input.amountKeur) || 0;
    const [cr] = await tx
      .insert(changeRequests)
      .values({
        projectId: p.id, number, title: input.title.trim(), types: input.types, amountKeur,
        scheduleDays: Math.round(input.scheduleDays) || 0, status, requestedBy: actor?.shortName ?? actorName, requestedByPersonId: actor?.id ?? null,
        requestedOnText: shortDateOfIso(on), requestedOn: on, baselineCode: input.baselineCode ?? 'BL1', justification: input.justification?.trim() || null,
        position: minPos - 1, contractImpact: impact, costCategoryCode: input.costCategoryCode?.trim() || null,
      })
      .returning({ id: changeRequests.id });
    // R-069 (P-6c): the steps the request needs, with the board threshold in force now (a draft's are fixed again when submitted).
    await tx.insert(changeRequestSteps).values(await stepRows(tx, cr.id, { contractImpact: impact, amountKeur }));
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
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number,
      change: `created · status: ${changeStatus.label(status)}${impact ? ` · contractual impact: ${contractImpactCodec.label(impact)}` : ''}`,
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

/**
 * "Submit for review": Draft → In review (audit + activity "Submitted CR-008 for review · +85 k€ · −12 d"). R-069: the steps are
 * fixed again from the rule in force (the seeded draft CR-009, 0 k€, no longer needs the board).
 */
export async function submitChangeRequest(projectCode: string, number: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, cr } = await loadCr(tx, projectCode, number);
    if (cr.status !== 'draft') throw new Error(`${number} is not a draft`);
    const [moved] = await tx.update(changeRequests).set({ status: 'in_review', updatedAt: new Date() })
      .where(and(eq(changeRequests.id, cr.id), eq(changeRequests.status, 'draft'))).returning({ id: changeRequests.id });
    if (!moved) throw new Error(`${number} is not a draft`);
    await tx.delete(changeRequestSteps).where(eq(changeRequestSteps.changeRequestId, cr.id));
    await tx.insert(changeRequestSteps).values(await stepRows(tx, cr.id, { contractImpact: cr.contractImpact ?? null, amountKeur: cr.amountKeur }));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: 'status: Draft → In review', area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: p.id });
    const amt = cr.amountKeur ? ` · ${cr.amountKeur > 0 ? '+' : '−'}${Math.abs(cr.amountKeur)} k€` : '';
    const days = cr.scheduleDays ? ` · ${cr.scheduleDays > 0 ? '+' : '−'}${Math.abs(cr.scheduleDays)} d` : '';
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Submitted ${number} for review${amt}${days}`, kind: 'change', projectId: p.id });
  });
}

/**
 * Records one approval-chain decision (crOv.chain): only on a CR in review and its current step (R-069, P-6b: every earlier
 * step approved or not required; ChangeStepError otherwise). The status is
 * re-derived from the chain; when the CR becomes approved, the proposed baseline it carries (BL2 ↔ CR-009)
 * becomes current and the previous current one superseded, and (delivery 7, R-068) the change is posted to the budget
 * and the contract (src/server/dal/change-posting.ts). Returns the new status. Permission (which persona
 * decides which step; the CCB has none, 07 OQ2) is the caller's check.
 */
export async function decideChangeStep(
  projectCode: string, number: string, step: ChangeStep, decision: 'ok' | 'rejected', actorName: string, comment?: string,
): Promise<ChangeStatus> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, cr } = await loadCr(tx, projectCode, number);
    if (cr.status !== 'in_review') throw new ChangeStepError('not_in_review', `${number} is not in review`);
    const steps = await tx.select().from(changeRequestSteps).where(eq(changeRequestSteps.changeRequestId, cr.id));
    const s = steps.find((x) => x.step === step);
    if (!s || s.decision !== 'pending') throw new ChangeStepError('not_pending', `${number}: step ${step} is not pending`);
    // R-069 (P-6b): the chain is sequential — a later step waits for the earlier ones.
    if (currentStep(steps) !== step) throw new ChangeStepError('not_current', `${number}: step ${step} waits for an earlier step`);
    const actor = await findPerson(tx, actorName);
    const at = new Date();
    // Guarded update: a concurrent decision of the same step records nothing (R-010).
    const [recorded] = await tx
      .update(changeRequestSteps)
      .set({ decision, decidedByPersonId: actor?.id ?? null, decidedAt: at, comment: comment?.trim() || null })
      .where(and(eq(changeRequestSteps.changeRequestId, cr.id), eq(changeRequestSteps.step, step), eq(changeRequestSteps.decision, 'pending')))
      .returning({ step: changeRequestSteps.step });
    if (!recorded) throw new ChangeStepError('not_pending', `${number}: step ${step} is not pending`);
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
        const setOn = projectDataDate(proj ?? {}, await businessToday(tx));
        if (!(await baselineSnapshotSize(bl.id, tx))) {
          const n = await snapshotIntoBaseline(projectCode, bl.code, { actorName, makeCurrent: true, setOn }, tx);
          changes.push(`${bl.code} snapshot · ${n} activities`);
        } else {
          await tx.update(baselines).set({ state: 'superseded', updatedAt: at }).where(and(eq(baselines.projectId, p.id), eq(baselines.state, 'current')));
          await tx.update(baselines).set({ state: 'current', setOn, updatedAt: at }).where(eq(baselines.id, bl.id));
          // R-054 (L-2 "a"): a BLn ≥ 1 made current ticks « Planning BL1 posé » (snapshotIntoBaseline does it in the other branch).
          if (baselineNumber(bl.code) >= 1) await markBl1Deliverable(tx, p.id, actorName);
        }
        changes.push(`${bl.code} current`);
      }
      // Delivery 7 (R-068, A-4): the approved change flows into the budget (BAC) and the contract (draft amendment), once.
      const posted = await postApprovedChange(tx, cr.id, actorName);
      if (posted?.amount) changes.push(`posted · BAC ${posted.bacBefore} → ${posted.bacAfter} k€${posted.amendmentLabel ? ' · amendment prepared' : ''}`);
    }
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: changes.join(' · '), area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: p.id });
    return status;
  });
}
