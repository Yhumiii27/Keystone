import 'server-only';
// Contingency register DAL (docs/spec/04 §5, 11 §3.5 ContingencyRegister / ContingencyDraw): initial provision
// (default round(BAC × 3 %) when the project has no register), draw-downs, drawn / remaining, the open-risk
// exposure it must still cover, project progress — and the "Record draw-down" writer.
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { STATUS_ISO, contingencyLinkTypeOf, shortDateOfIso, type ContingencyLinkType } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { changeRequests, contingencyDraws, contingencyRegisters, persons, projects, risks } from '@/server/db/schema';
import { getOpenRiskExposure } from './risks';

export interface ContingencyDrawRow {
  /** ISO date and the "12 Sep" display. */
  date: string;
  dateText: string;
  /** k€. */
  amount: number;
  reason: string;
  /** "CR-004" / "R-03" / "NCR-026"; null → "—". */
  linkRef: string | null;
  linkType: ContingencyLinkType | null;
  /** Approver short name ("R. Aubert"). */
  approvedBy: string | null;
}

export interface Contingency {
  projectCode: string;
  /** k€. */
  initial: number;
  /** True when the project has no register yet and `initial` is the default round(BAC × 3 %). */
  isDefault: boolean;
  /** Stored order, oldest first (the screen lists them most recent first). */
  draws: ContingencyDrawRow[];
  drawn: number;
  remaining: number;
  /** Σ EMV of the open risks (Risk register). */
  exposure: number;
  bac: number;
  /** Project progress 0–1. */
  progress: number;
}

/** Contingency of a project; null for an unknown project. */
export async function getContingency(projectCode: string): Promise<Contingency | null> {
  const db = await getDb();
  const [p] = await db
    .select({ id: projects.id, bac: projects.budgetKeur, progress: projects.progress, regId: contingencyRegisters.id, initial: contingencyRegisters.initialKeur })
    .from(projects)
    .leftJoin(contingencyRegisters, eq(contingencyRegisters.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) return null;
  const draws = p.regId
    ? await db
        .select({ d: contingencyDraws, short: persons.shortName })
        .from(contingencyDraws)
        .leftJoin(persons, eq(persons.id, contingencyDraws.approvedByPersonId))
        .where(eq(contingencyDraws.registerId, p.regId))
        .orderBy(asc(contingencyDraws.position))
    : [];
  const initial = p.initial ?? Math.round(p.bac * 0.03);
  const drawn = draws.reduce((a, { d }) => a + d.amountKeur, 0);
  return {
    projectCode, initial, isDefault: p.initial == null,
    draws: draws.map(({ d, short }) => ({
      date: d.drawnOn, dateText: shortDateOfIso(d.drawnOn), amount: d.amountKeur, reason: d.reason, linkRef: d.linkRef, linkType: d.linkedEntityType, approvedBy: short,
    })),
    drawn, remaining: initial - drawn, exposure: await getOpenRiskExposure(projectCode), bac: p.bac, progress: p.progress,
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface DrawInput {
  amountKeur: number;
  reason: string;
  /** Free-text reference ("CR-004", "R-03", "NCR-026"); CRs and risks of the project are linked. */
  linkRef?: string | null;
  /** Approver (full or short name; the form offers R. Aubert · Project manager / M. Lefebvre · Portfolio director). */
  approvedBy?: string | null;
  /** Business date (default the status date). */
  drawnOn?: string;
}

/**
 * "Record draw-down" (AF.contingency): appends a draw, creating the register with the default provision when the
 * project has none. No check against the remaining provision (as in the prototype).
 */
export async function recordContingencyDraw(projectCode: string, input: DrawInput, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    let [reg] = await tx.select({ id: contingencyRegisters.id }).from(contingencyRegisters).where(eq(contingencyRegisters.projectId, p.id));
    if (!reg) [reg] = await tx.insert(contingencyRegisters).values({ projectId: p.id, initialKeur: Math.round(p.budgetKeur * 0.03) }).returning({ id: contingencyRegisters.id });
    const [{ pos }] = await tx
      .select({ pos: sql<number>`coalesce(max(${contingencyDraws.position}), -1)::int` })
      .from(contingencyDraws)
      .where(eq(contingencyDraws.registerId, reg.id));
    const ref = input.linkRef?.trim() || null;
    const type = contingencyLinkTypeOf(ref);
    let linkedId: string | null = null;
    if (ref && type === 'change_request')
      linkedId = (await tx.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, p.id), eq(changeRequests.number, ref))))[0]?.id ?? null;
    if (ref && type === 'risk') linkedId = (await tx.select({ id: risks.id }).from(risks).where(and(eq(risks.projectId, p.id), eq(risks.number, ref))))[0]?.id ?? null;
    const approver = await findPerson(tx, input.approvedBy);
    const amount = Number.isFinite(input.amountKeur) ? input.amountKeur : 0;
    const [d] = await tx
      .insert(contingencyDraws)
      .values({
        registerId: reg.id, drawnOn: input.drawnOn ?? STATUS_ISO, amountKeur: amount, reason: input.reason.trim(), linkRef: ref,
        linkedEntityType: type, linkedEntityId: linkedId, approvedByPersonId: approver?.id ?? null, position: pos + 1,
      })
      .returning({ id: contingencyDraws.id });
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: 'Contingency', change: `draw-down ${amount} k€${ref ? ' · ' + ref : ''}`,
      area: 'Contingency', entityType: 'contingency_draw', entityId: d.id, projectId: p.id,
    });
  });
}
