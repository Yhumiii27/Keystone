import 'server-only';
// Risk register DAL (docs/spec/07 §2.1, 11 §3.7): risks with derived score / level / EMV, linked activity (float for the
// "On critical path" KPI), the category chips in Settings order, the contingency the exposure is compared with, and the
// writers of the register (add risk, drawer edits, close / reopen).
// Delivery 7 (R-072, owner decision Q-1): the cost if the risk occurs is stored; EMV = cost × P / 5 is derived on every read,
// so the register, the exposure KPI, the Contingency register and the exports follow a change of probability.
import { and, asc, eq, sql } from 'drizzle-orm';
import { costIfOccurs, costOfLegacyEmv, emvOf } from '@/domain/risk';
import { getDb } from '@/server/db/client';
import {
  riskCategory, riskLevel, riskLevelOf, riskResponse, riskScore, riskStatus,
  type RiskCategory, type RiskLevel, type RiskResponse, type RiskStatus, type RiskTrend,
} from '@/server/db/codes';
import { findPerson, nameOf, nextNumber, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, persons, projectControls, projects, risks, wbsNodes } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { assertRecordFresh, tokenOf, type VersionedTable } from './record-version';
import { settingsEntries } from './settings-lists';

/** R-010: risks under optimistic locking (audit entity "risk"). */
const RISK_VERSION: VersionedTable = { table: risks, id: risks.id, version: risks.version, entityType: 'risk' };

export interface LinkedActivity {
  /** "A1250". */
  code: string;
  name: string;
  /** WBS code of its work package ("1.4"). */
  wbs: string;
  /** Total float (days); null when complete. */
  totalFloat: number | null;
  pct: number;
}

export interface RiskRow {
  /** "R-03". */
  id: string;
  title: string;
  category: RiskCategory;
  /** EN source string ("Supplier / delivery"). */
  categoryLabel: string;
  probability: number;
  impact: number;
  /** probability × impact. */
  score: number;
  level: RiskLevel;
  /** 'Critical' | 'High' | 'Medium' | 'Low'. */
  levelLabel: string;
  /** Owner full name ("Fabien Bertrand"; short name when only that is known, e.g. "S. Perrin"). */
  owner: string | null;
  ownerShort: string | null;
  response: RiskResponse;
  /** 'Avoid' | 'Mitigate' | 'Transfer' | 'Accept'. */
  responseLabel: string;
  plan: string;
  activity: LinkedActivity | null;
  /** Expected monetary value, k€ = cost × P / 5 (Q-1; 0 → the screens show "—"). */
  emv: number;
  /** Cost if it occurs = the contingency draw if it occurs, k€ (entered, Q-1); null when none. */
  costIfOccurs: number | null;
  trigger: string;
  status: RiskStatus;
  /** 'Open' | 'Closed'. */
  statusLabel: string;
  trend: RiskTrend;
  /** R-010: the version token the drawer's edits send back (src/domain/record-version.ts). */
  version: string;
}

export interface RiskCategoryChip {
  code: RiskCategory;
  label: string;
  /** Risks of the register in this category (open and closed). */
  count: number;
}

export interface RiskRegister {
  projectCode: string;
  /** Source order (added risks first, then the seed order); the screen sorts by score. */
  risks: RiskRow[];
  /** Every category in Settings order with its count — chips show those with count > 0 (logic 4583). */
  categories: RiskCategoryChip[];
  /** Σ EMV of open risks, k€. */
  openEmv: number;
  /** Contingency the exposure is compared with (projectData().recon.cont); null for projects without data. */
  contingency: number | null;
  /** Budget at completion, k€. */
  bac: number;
}

/** Cost if it occurs of a stored risk; a row not backfilled yet falls back to its legacy EMV (Q-1). */
const costOf = (r: { costKeur: number | null; emvKeur: number | null; probability: number }) => r.costKeur ?? costOfLegacyEmv(r.emvKeur, r.probability);

/** Risks of a project (empty for projects without a register). */
export async function listRisks(projectCode: string): Promise<RiskRow[]> {
  const db = await getDb();
  const readAt = new Date();
  const rows = await db
    .select({
      r: risks, ownerFull: persons.fullName, ownerShort: persons.shortName,
      actCode: activities.code, actName: activities.name, actFloat: activities.totalFloatDays, actPct: activities.percentComplete, actWbs: wbsNodes.code,
    })
    .from(risks)
    .innerJoin(projects, eq(projects.id, risks.projectId))
    .leftJoin(persons, eq(persons.id, risks.ownerPersonId))
    .leftJoin(activities, eq(activities.id, risks.activityId))
    .leftJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(risks.sortOrder));
  // A-14: categories added in Settings › Risk categories are labelled from Settings (active or not).
  const custom = rows.some(({ r }) => !riskCategory.isCode(r.category)) ? await settingsEntries('riskCats', db) : [];
  const categoryLabelOf = (c: RiskCategory) => (riskCategory.isCode(c) ? riskCategory.label(c) : (custom.find((e) => e.code === c)?.label ?? c));
  return rows.map(({ r, ownerFull, ownerShort, actCode, actName, actFloat, actPct, actWbs }) => {
    const score = riskScore(r.probability, r.impact);
    const level = riskLevelOf(score);
    return {
      id: r.number, title: r.title, category: r.category, categoryLabel: categoryLabelOf(r.category), probability: r.probability, impact: r.impact,
      score, level, levelLabel: riskLevel.label(level), owner: ownerFull ?? ownerShort, ownerShort,
      response: r.response, responseLabel: riskResponse.label(r.response), plan: r.responsePlan,
      activity: actCode ? { code: actCode, name: actName!, wbs: actWbs!, totalFloat: actFloat, pct: actPct! } : null,
      emv: emvOf(costOf(r), r.probability), costIfOccurs: costIfOccurs(costOf(r)), trigger: r.trigger,
      status: r.status, statusLabel: riskStatus.label(r.status), trend: r.trend, version: tokenOf(r.version, readAt),
    };
  });
}

/** Σ EMV of the open risks of a project (Risk KPI "Exposure", Contingency "Exposure", Trends risk series), k€. */
export async function getOpenRiskExposure(projectCode: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ costKeur: risks.costKeur, emvKeur: risks.emvKeur, probability: risks.probability })
    .from(risks)
    .innerJoin(projects, eq(projects.id, risks.projectId))
    .where(and(eq(projects.code, projectCode), eq(risks.status, 'open')));
  return Math.round(rows.reduce((a, r) => a + emvOf(costOf(r), r.probability), 0) * 100) / 100;
}

/** Everything the Risk register screen reads; null for an unknown project. */
export async function getRiskRegister(projectCode: string): Promise<RiskRegister | null> {
  const db = await getDb();
  const [p] = await db
    .select({ bac: projects.budgetKeur, cont: projectControls.contingencyKeur })
    .from(projects)
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) return null;
  const list = await listRisks(projectCode);
  return {
    projectCode, risks: list,
    // Settings order (A-14), then any other category still used by a risk.
    categories: [...(await settingsEntries('riskCats', db)).map((e) => ({ code: e.code as RiskCategory, label: e.label })),
      ...riskCategory.codes.map((code) => ({ code, label: riskCategory.label(code) })),
      ...list.map((r) => ({ code: r.category, label: r.categoryLabel }))]
      .filter((c, i, all) => all.findIndex((x) => x.code === c.code) === i)
      .map((c) => ({ ...c, count: list.filter((r) => r.category === c.code).length })),
    openEmv: Math.round(list.filter((r) => r.status === 'open').reduce((a, r) => a + r.emv, 0) * 100) / 100,
    contingency: p.cont ?? null, bac: p.bac,
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface NewRiskInput {
  title: string;
  category: RiskCategory;
  /** 1–5; clamped, default 3 (afSubmit). */
  probability?: number;
  impact?: number;
  /** Full or short name. */
  owner?: string | null;
  response: RiskResponse;
  plan?: string;
  /** Cost if it occurs, k€ (Q-1); the EMV is derived. */
  costKeur?: number;
  trigger?: string;
  activityCode?: string | null;
}

const clamp15 = (v: number | undefined) => Math.max(1, Math.min(5, Math.round(v ?? 3) || 3));
/** A cost of 0 or more, two decimals (k€). */
const cost2 = (v: number | undefined) => (v != null && Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : 0);

/**
 * Adds a risk to a project's register (AF.risks): number R-21… (global sequence, OPEN QUESTION Q-7), status
 * Open, trend flat, prepended to the register. Returns the new number.
 */
export async function createRisk(projectCode: string, input: NewRiskInput, actorName: string, inTx?: Tx): Promise<string> {
  const run = async (tx: Tx) => {
    const p = await requireProject(tx, projectCode);
    const number = await nextNumber(tx, risks, risks.number, 'R-', 2, 20);
    const [{ minOrder }] = await tx
      .select({ minOrder: sql<number>`coalesce(min(${risks.sortOrder}), 1)::int` })
      .from(risks)
      .where(eq(risks.projectId, p.id));
    const owner = await findPerson(tx, input.owner);
    let activityId: string | null = null;
    if (input.activityCode) {
      const [a] = await tx.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, input.activityCode)));
      activityId = a?.id ?? null;
    }
    const actor = await findPerson(tx, actorName);
    const [row] = await tx
      .insert(risks)
      .values({
        projectId: p.id, number, title: input.title.trim(), category: input.category, probability: clamp15(input.probability), impact: clamp15(input.impact),
        ownerPersonId: owner?.id ?? null, response: input.response, responsePlan: input.plan?.trim() || '—', activityId,
        costKeur: cost2(input.costKeur), emvKeur: null, trigger: input.trigger?.trim() || '—', status: 'open', trend: 'flat', sortOrder: minOrder - 1,
      })
      .returning({ id: risks.id });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: 'created · ' + input.title.trim(),
      area: 'Risks', entityType: 'risk', entityId: row.id, projectId: p.id,
    });
    return number;
  };
  // `inTx`: part of a caller's transaction (a risk registered from a meeting transcript proposal, marked applied with it).
  return inTx ? run(inTx) : (await getDb()).transaction(run);
}

export interface RiskPatch {
  probability?: number;
  impact?: number;
  response?: RiskResponse;
  status?: RiskStatus;
  trend?: RiskTrend;
  title?: string;
  plan?: string;
  owner?: string | null;
  /** Cost if it occurs, k€ (Q-1). */
  costKeur?: number;
  trigger?: string;
}

/**
 * Drawer edits (riskOv): P / I segments, response strategy, close / reopen, plus the other editable fields. `version` (R-010):
 * the token the drawer read — a risk changed meanwhile by someone else throws StaleRecordError.
 */
export async function updateRisk(projectCode: string, riskNumber: string, patch: RiskPatch, actorName: string, opts: { version?: string | null } = {}): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [found] = await tx.select({ id: risks.id }).from(risks).where(and(eq(risks.projectId, p.id), eq(risks.number, riskNumber)));
    if (!found) throw new Error(`Unknown risk ${riskNumber} on ${projectCode}`);
    const saver = await findPerson(tx, actorName);
    await assertRecordFresh(tx, RISK_VERSION, found.id, opts.version, { name: actorName, personId: saver?.id ?? null });
    const [r] = await tx.select().from(risks).where(eq(risks.id, found.id));
    const set: Partial<typeof risks.$inferInsert> = { updatedAt: new Date() };
    const changes: string[] = [];
    if (patch.probability != null && clamp15(patch.probability) !== r.probability) {
      set.probability = clamp15(patch.probability);
      changes.push(`P: ${r.probability} → ${set.probability}`);
    }
    if (patch.impact != null && clamp15(patch.impact) !== r.impact) {
      set.impact = clamp15(patch.impact);
      changes.push(`I: ${r.impact} → ${set.impact}`);
    }
    if (patch.response && patch.response !== r.response) {
      set.response = patch.response;
      changes.push(`response: ${riskResponse.label(r.response)} → ${riskResponse.label(patch.response)}`);
    }
    if (patch.status && patch.status !== r.status) {
      set.status = patch.status;
      changes.push(`status: ${riskStatus.label(r.status)} → ${riskStatus.label(patch.status)}`);
    }
    if (patch.trend && patch.trend !== r.trend) set.trend = patch.trend;
    if (patch.title?.trim() && patch.title.trim() !== r.title) set.title = patch.title.trim();
    if (patch.plan != null && patch.plan.trim() !== r.responsePlan) set.responsePlan = patch.plan.trim() || '—';
    if (patch.trigger != null && patch.trigger.trim() !== r.trigger) set.trigger = patch.trigger.trim() || '—';
    const oldCost = costOf(r);
    if (patch.costKeur != null && cost2(patch.costKeur) !== oldCost) {
      set.costKeur = cost2(patch.costKeur);
      changes.push(`cost if it occurs: ${oldCost} → ${set.costKeur} k€`);
    } else if (r.costKeur == null) set.costKeur = oldCost;
    // Q-1: the EMV follows the cost and the probability.
    const newEmv = emvOf(set.costKeur ?? oldCost, set.probability ?? r.probability);
    const oldEmv = emvOf(oldCost, r.probability);
    if (newEmv !== oldEmv) changes.push(`EMV: ${oldEmv} → ${newEmv} k€`);
    if (patch.owner !== undefined) set.ownerPersonId = (await findPerson(tx, patch.owner))?.id ?? null;
    await tx.update(risks).set(set).where(eq(risks.id, r.id));
    if (changes.length) {
      const actor = saver;
      await writeAudit(tx, {
        actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: riskNumber, change: changes.join(' · '), area: 'Risks',
        entityType: 'risk', entityId: r.id, projectId: p.id,
      });
    }
  });
}
