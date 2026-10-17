import 'server-only';
// Contingency register DAL (docs/spec/04 §5, 11 §3.5 ContingencyRegister / ContingencyDraw): initial provision, draw-downs,
// drawn / remaining, the open-risk exposure it must still cover, project progress — and the draw-down writers.
// Delivery 7 (R-070 / R-071, owner decisions A-8 and C-4):
//  - the provision of a project without a register is the contingency line of its budget (A-8: one figure for the Budget,
//    the Risk register and this register), else round(BAC × 3 %);
//  - a draw-down is linked to a change request, a risk or an NCR of the project (chosen from a list), cannot exceed the
//    provision left, and is `submitted` until the portfolio director validates it in My approvals — only validated
//    draw-downs are drawn (the Budget's "drawn" and the actual cost of the reserve line, src/server/dal/evm.ts);
//  - every step is audited, traced in the activity feed and notified (director on submission, requester on decision);
//  - who: a draw-down is submitted by the project's team with the Contingency register in their workspace (as the Server
//    Function's `canEdit('contingency')`, R-041) and decided by the director — both re-checked here with the actor.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  DRAW_STATUS_LABEL, drawTotals, isDrawDecider, provisionOf, submitBalanceError, validateBalanceError, type DrawStatus,
} from '@/domain/cost-control';
import { linkOptionLabel, type DrawLinkOption, type DrawLinkType } from '@/domain/contingency';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { businessToday } from '@/server/clock';
import { shortDateOfIso, type ContingencyLinkType } from '@/server/db/codes';
import { findPerson, nameOf, personOfRole, recordActivity, writeAudit } from '@/server/db/helpers';
import { changeRequests, contingencyDraws, contingencyRegisters, persons, projectControls, projects, risks, vigieNcrs } from '@/server/db/schema';
import { getProjectEvm } from './evm';
import type { Actor } from './ops-common';
import { getOpenRiskExposure } from './risks';
import { editsProjectScreen } from './team-guard';

type Q = DB | Tx;

export interface ContingencyDrawRow {
  /** Draw-down id (My approvals decides it by id). */
  id: string;
  /** ISO date and the "12 Sep" display. */
  date: string;
  dateText: string;
  /** k€. */
  amount: number;
  reason: string;
  /** "CR-004" / "R-03" / "NCR-026"; null → "—". */
  linkRef: string | null;
  linkType: ContingencyLinkType | null;
  /** The reference resolves to the project's change request, risk or Vigie NCR (false for the prototype's NCR-026). */
  linkResolved: boolean;
  /** Validator short name ("R. Aubert"); null while awaiting validation or when rejected. */
  approvedBy: string | null;
  status: DrawStatus;
  /** 'Awaiting validation' | 'Validated' | 'Rejected'. */
  statusLabel: string;
  /** Who recorded it and who decided (short names); null when unknown (the prototype's draw-downs). */
  requestedBy: string | null;
  decidedBy: string | null;
  decisionComment: string | null;
}

export interface Contingency {
  projectCode: string;
  /** k€. */
  initial: number;
  /** True when the project has no register yet and `initial` comes from its budget (or round(BAC × 3 %)). */
  isDefault: boolean;
  /** Stored order, oldest first (the screen lists them most recent first). Every status. */
  draws: ContingencyDrawRow[];
  /** Σ validated draw-downs (A-8). */
  drawn: number;
  remaining: number;
  /** Σ draw-downs awaiting the director's validation (C-4) — not drawn yet. */
  pending: number;
  /** Σ EMV of the open risks (Risk register). */
  exposure: number;
  bac: number;
  /** Project progress 0–1 (computed from the activities when the project has them, R-073). */
  progress: number;
}

export interface ContingencyTotals {
  /** Register id; null before the first draw-down. */
  registerId: string | null;
  initial: number;
  source: 'register' | 'budget' | 'default';
  drawn: number;
  pending: number;
  pendingCount: number;
}

async function totalsOf(q: Q, projectCode: string, lock = false): Promise<(ContingencyTotals & { projectId: string; bac: number; progress: number }) | null> {
  const [p] = await q
    .select({ id: projects.id, bac: projects.budgetKeur, progress: projects.progress, budgetCont: projectControls.contingencyKeur })
    .from(projects)
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) return null;
  // `lock`: writers serialise on the register row so two draw-downs cannot both pass the balance check (R-071).
  const regQuery = q.select({ id: contingencyRegisters.id, initial: contingencyRegisters.initialKeur }).from(contingencyRegisters).where(eq(contingencyRegisters.projectId, p.id));
  const [reg] = lock ? await regQuery.for('update') : await regQuery;
  const draws = reg ? await q.select({ amount: contingencyDraws.amountKeur, status: contingencyDraws.status }).from(contingencyDraws).where(eq(contingencyDraws.registerId, reg.id)) : [];
  const prov = provisionOf({ registerInitial: reg?.initial ?? null, budgetContingency: p.budgetCont ?? null, bac: p.bac });
  const t = drawTotals(draws);
  return { projectId: p.id, bac: p.bac, progress: p.progress, registerId: reg?.id ?? null, initial: prov.initial, source: prov.source, ...t };
}

/** Provision, drawn (validated) and pending draw-downs of a project; null for an unknown project. */
export async function getContingencyTotals(projectCode: string): Promise<ContingencyTotals | null> {
  const t = await totalsOf(await getDb(), projectCode);
  return t && { registerId: t.registerId, initial: t.initial, source: t.source, drawn: t.drawn, pending: t.pending, pendingCount: t.pendingCount };
}

/** Contingency of a project; null for an unknown project. */
export async function getContingency(projectCode: string): Promise<Contingency | null> {
  const db = await getDb();
  const t = await totalsOf(db, projectCode);
  if (!t) return null;
  const validator = alias(persons, 'validator');
  const requester = alias(persons, 'requester');
  const decider = alias(persons, 'decider');
  const draws = t.registerId
    ? await db
        .select({ d: contingencyDraws, validator: validator.shortName, requester: requester.shortName, decider: decider.shortName })
        .from(contingencyDraws)
        .leftJoin(validator, eq(validator.id, contingencyDraws.approvedByPersonId))
        .leftJoin(requester, eq(requester.id, contingencyDraws.requestedByPersonId))
        .leftJoin(decider, eq(decider.id, contingencyDraws.decidedByPersonId))
        .where(eq(contingencyDraws.registerId, t.registerId))
        .orderBy(asc(contingencyDraws.position))
    : [];
  const [exposure, evm] = await Promise.all([getOpenRiskExposure(projectCode), getProjectEvm(projectCode)]);
  return {
    projectCode, initial: t.initial, isDefault: t.registerId == null,
    draws: draws.map(({ d, validator: v, requester: r, decider: dc }) => ({
      id: d.id, date: d.drawnOn, dateText: shortDateOfIso(d.drawnOn), amount: d.amountKeur, reason: d.reason, linkRef: d.linkRef, linkType: d.linkedEntityType,
      linkResolved: d.linkedEntityId != null,
      approvedBy: d.status === 'validated' ? v : null, status: d.status, statusLabel: DRAW_STATUS_LABEL[d.status],
      requestedBy: r ?? d.requestedByName, decidedBy: dc, decisionComment: d.decisionComment,
    })),
    drawn: t.drawn, remaining: t.initial - t.drawn, pending: t.pending, exposure, bac: t.bac, progress: evm?.progress ?? t.progress,
  };
}

/**
 * What a draw-down can be linked to (C-4), in this order: the project's change requests raised (not drafts), its risks (open
 * first) and its NCRs as Vigie reports them.
 */
export async function drawLinkOptions(projectCode: string, q?: Q): Promise<DrawLinkOption[]> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return [];
  const [crs, rs, ncrs] = await Promise.all([
    db.select({ n: changeRequests.number, t: changeRequests.title, s: changeRequests.status }).from(changeRequests).where(eq(changeRequests.projectId, p.id)).orderBy(asc(changeRequests.position)),
    db.select({ n: risks.number, t: risks.title, s: risks.status }).from(risks).where(eq(risks.projectId, p.id)).orderBy(asc(risks.sortOrder)),
    db.select({ n: vigieNcrs.number, t: vigieNcrs.title }).from(vigieNcrs).where(eq(vigieNcrs.projectCode, projectCode)).orderBy(asc(vigieNcrs.position)),
  ]);
  const opt = (type: DrawLinkType) => (r: { n: string; t: string }): DrawLinkOption => ({ value: r.n, label: linkOptionLabel(r.n, r.t), type });
  return [
    ...crs.filter((c) => c.s !== 'draft').map(opt('change_request')),
    ...[...rs.filter((r) => r.s === 'open'), ...rs.filter((r) => r.s !== 'open')].map(opt('risk')),
    ...ncrs.map(opt('ncr')),
  ];
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

/** A refused draw-down write: `message` is an English source string shown to the user. */
export class ContingencyError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'balance' | 'stale' | 'forbidden' = 'invalid') {
    super(message);
  }
}

export interface DrawInput {
  amountKeur: number;
  reason: string;
  /** Linked item ("CR-004", "R-03", "NCR-026") and its kind — required (C-4). */
  linkRef: string;
  linkType: DrawLinkType;
  /** Business date (default the business date, R-013). */
  drawnOn?: string;
}

/** Resolves a link of the project: the change request, risk or Vigie NCR row; null when it is not the project's. */
async function resolveLink(q: Q, projectId: string, projectCode: string, ref: string, type: DrawLinkType): Promise<string | null> {
  if (type === 'change_request')
    return (await q.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.number, ref))))[0]?.id ?? null;
  if (type === 'risk') return (await q.select({ id: risks.id }).from(risks).where(and(eq(risks.projectId, projectId), eq(risks.number, ref))))[0]?.id ?? null;
  return (await q.select({ id: vigieNcrs.id }).from(vigieNcrs).where(and(eq(vigieNcrs.projectCode, projectCode), eq(vigieNcrs.number, ref))))[0]?.id ?? null;
}

export interface DrawReceipt {
  drawId: string;
  projectCode: string;
  amount: number;
  linkRef: string;
  /** Requester (who recorded it) and the director the validation goes to. */
  requestedBy: string;
  director: string | null;
}

/** Refusal of a draw-down by someone who may not edit the project's register (EN source; FR in risks.json). */
export const CONTINGENCY_READ_ONLY = 'This contingency register is read-only for you';

/**
 * "Record draw-down" (AF.contingency, C-4): a `submitted` draw-down linked to one of the project's change requests, risks or
 * NCRs, refused when it would exceed the provision left once the draw-downs already awaiting validation are counted. Creates
 * the register (with the project's provision) on the first draw-down. Audited and traced; the caller notifies the director.
 * `actor` = the viewer: refused (`forbidden`) unless the register is in their workspace and they are on the project's team
 * (or are the director) — the Server Function's `canEdit('contingency')`, re-checked here.
 */
export async function submitContingencyDraw(projectCode: string, input: DrawInput, actor: Actor): Promise<DrawReceipt> {
  const actorName = actor.name;
  const amount = Math.round((Number(input.amountKeur) || 0) * 100) / 100;
  if (!(amount > 0)) throw new ContingencyError('Enter an amount greater than 0');
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new ContingencyError('Reason is required');
  const db = await getDb();
  return db.transaction(async (tx) => {
    let t = await totalsOf(tx, projectCode, true);
    if (!t) throw new ContingencyError('Unknown project');
    if (!(await editsProjectScreen(tx, actor, t.projectId, 'contingency'))) throw new ContingencyError(CONTINGENCY_READ_ONLY, 'forbidden');
    const linkedId = await resolveLink(tx, t.projectId, projectCode, input.linkRef, input.linkType);
    if (!linkedId) throw new ContingencyError('Unknown change request, risk or NCR');
    if (!t.registerId) {
      await tx.insert(contingencyRegisters).values({ projectId: t.projectId, initialKeur: t.initial }).onConflictDoNothing();
      t = (await totalsOf(tx, projectCode, true))!;
    }
    const err = submitBalanceError(amount, t);
    if (err) throw new ContingencyError(err, 'balance');
    const [{ pos }] = await tx
      .select({ pos: sql<number>`coalesce(max(${contingencyDraws.position}), -1)::int` })
      .from(contingencyDraws)
      .where(eq(contingencyDraws.registerId, t.registerId!));
    const person = await findPerson(tx, actorName);
    const who = person ? nameOf(person) : actorName;
    const [d] = await tx
      .insert(contingencyDraws)
      .values({
        registerId: t.registerId!, drawnOn: input.drawnOn ?? (await businessToday(tx)), amountKeur: amount, reason, linkRef: input.linkRef, linkedEntityType: input.linkType,
        linkedEntityId: linkedId, approvedByPersonId: null, position: pos + 1, status: 'submitted', requestedByPersonId: person?.id ?? null, requestedByName: who,
      })
      .returning({ id: contingencyDraws.id });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: 'Contingency', change: `draw-down submitted · ${amount} k€ · ${input.linkRef} · awaiting validation`,
      area: 'Contingency', entityType: 'contingency_draw', entityId: d.id, projectId: t.projectId,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text: `Submitted a ${amount} k€ contingency draw-down · ${input.linkRef}`, kind: 'change', projectId: t.projectId });
    const director = await personOfRole(tx, 'director');
    return { drawId: d.id, projectCode, amount, linkRef: input.linkRef, requestedBy: who, director: director ? (director.fullName ?? director.shortName) : null };
  });
}

export interface DrawDecision extends DrawReceipt {
  decision: 'validated' | 'rejected';
  decidedBy: string;
}

/**
 * The portfolio director's decision on a submitted draw-down (C-4): validated → drawn (refused when it would take the drawn
 * total above the provision), or rejected (with an optional comment). Refused for any other role and on a draw-down already
 * decided (`stale`). Audited and traced; the caller notifies the requester.
 */
export async function decideContingencyDraw(
  projectCode: string, drawId: string, decision: 'validated' | 'rejected', actor: { name: string; role: string }, comment?: string | null,
): Promise<DrawDecision> {
  if (!isDrawDecider(actor.role)) throw new ContingencyError('Only the portfolio director validates contingency draw-downs', 'forbidden');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const t = await totalsOf(tx, projectCode, true);
    if (!t || !t.registerId) throw new ContingencyError('This draw-down is not waiting for a decision any more', 'stale');
    const [d] = await tx.select().from(contingencyDraws).where(and(eq(contingencyDraws.id, drawId), eq(contingencyDraws.registerId, t.registerId)));
    if (!d || d.status !== 'submitted') throw new ContingencyError('This draw-down is not waiting for a decision any more', 'stale');
    if (decision === 'validated') {
      const err = validateBalanceError(d.amountKeur, t);
      if (err) throw new ContingencyError(err, 'balance');
    }
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const note = comment?.trim() ? comment.trim().slice(0, 1000) : null;
    const done = await tx
      .update(contingencyDraws)
      .set({
        status: decision, decidedByPersonId: person?.id ?? null, decidedAt: new Date(), decisionComment: note,
        approvedByPersonId: decision === 'validated' ? (person?.id ?? null) : null,
      })
      .where(and(eq(contingencyDraws.id, d.id), eq(contingencyDraws.status, 'submitted')))
      .returning({ id: contingencyDraws.id });
    if (!done.length) throw new ContingencyError('This draw-down is not waiting for a decision any more', 'stale');
    const verb = decision === 'validated' ? 'validated' : 'rejected';
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: 'Contingency', change: `draw-down ${verb} · ${d.amountKeur} k€ · ${d.linkRef ?? '—'}${note ? ' · ' + note : ''}`,
      area: 'Contingency', entityType: 'contingency_draw', entityId: d.id, projectId: t.projectId,
    });
    await recordActivity(tx, {
      actorName: who, actorPersonId: person?.id, text: `${decision === 'validated' ? 'Validated' : 'Rejected'} a ${d.amountKeur} k€ contingency draw-down · ${d.linkRef ?? '—'}`,
      kind: 'change', projectId: t.projectId,
    });
    const [requester] = d.requestedByPersonId ? await tx.select({ full: persons.fullName, short: persons.shortName }).from(persons).where(eq(persons.id, d.requestedByPersonId)) : [];
    return {
      drawId: d.id, projectCode, amount: d.amountKeur, linkRef: d.linkRef ?? '—', requestedBy: requester ? (requester.full ?? requester.short) : (d.requestedByName ?? ''),
      director: who, decision, decidedBy: who,
    };
  });
}

// ── My approvals ───────────────────────────────────────────────────────────────────────────────────────

export interface DrawAwaiting {
  id: string;
  projectCode: string;
  projectName: string;
  /** ISO date and "30 Sep". */
  date: string;
  dateText: string;
  amount: number;
  reason: string;
  linkRef: string | null;
  requestedBy: string | null;
}

/** Draw-downs awaiting the director's validation, every project, oldest first. */
export async function listDrawsAwaitingValidation(projectCodes?: string[]): Promise<DrawAwaiting[]> {
  const db = await getDb();
  const rows = await db
    .select({ d: contingencyDraws, code: projects.code, name: projects.name, short: persons.shortName })
    .from(contingencyDraws)
    .innerJoin(contingencyRegisters, eq(contingencyRegisters.id, contingencyDraws.registerId))
    .innerJoin(projects, eq(projects.id, contingencyRegisters.projectId))
    .leftJoin(persons, eq(persons.id, contingencyDraws.requestedByPersonId))
    .where(and(eq(contingencyDraws.status, 'submitted'), projectCodes ? inArray(projects.code, projectCodes) : undefined))
    .orderBy(asc(contingencyDraws.drawnOn), asc(contingencyDraws.createdAt));
  return rows.map(({ d, code, name, short }) => ({
    id: d.id, projectCode: code, projectName: name, date: d.drawnOn, dateText: shortDateOfIso(d.drawnOn), amount: d.amountKeur, reason: d.reason,
    linkRef: d.linkRef, requestedBy: short ?? d.requestedByName,
  }));
}

/** Draw-downs the viewer validated or rejected in Keystone ("Decided this week" of My approvals). */
export async function countDrawDecisions(actorName: string): Promise<number> {
  const db = await getDb();
  const person = await findPerson(db, actorName);
  if (!person) return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contingencyDraws)
    .where(and(eq(contingencyDraws.decidedByPersonId, person.id), isNotNull(contingencyDraws.decidedAt)));
  return r?.n ?? 0;
}
