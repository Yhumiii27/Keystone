import 'server-only';
// R-158 lot A — Incoterms DAL (owner's decisions 2 and 9, docs/delivery-9/notes-r158-shipments.md § 3–4): the reference table
// edited in Settings (the Settings editors: the portfolio director, A-14) and the contract's Incoterm and named place (the contract
// editors, P-4). Every writer re-checks the rights server-side, validates its input, writes in one transaction and records the
// audit row and the activity event. Rules in src/domain/incoterms.ts.
import { asc, eq, sql } from 'drizzle-orm';
import {
  INCOTERM_PLACE_MAX, incotermRemoval, readSplit, splitText, type IncotermInput, type IncotermModes, type IncotermSplit,
} from '@/domain/incoterms';
import { SETTINGS_DIRECTOR_ONLY, canEditSettings } from '@/domain/settings-rules';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { contracts, incoterms, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { requireWorkspace, trace, whoIs, type Actor } from './ops-common';
import { editsContract } from './team-guard';

type Q = DB | Tx;

export interface IncotermRow {
  code: string;
  nameEn: string;
  nameFr: string;
  descriptionEn: string;
  descriptionFr: string;
  modes: IncotermModes;
  split: IncotermSplit;
  standard: boolean;
  active: boolean;
  /** Contracts that use it (a used Incoterm is deactivated, never deleted). */
  usedBy: number;
}

const rowOf = (r: typeof incoterms.$inferSelect, usedBy = 0): IncotermRow => ({
  code: r.code, nameEn: r.nameEn, nameFr: r.nameFr, descriptionEn: r.descriptionEn, descriptionFr: r.descriptionFr, modes: r.modes,
  split: readSplit(r.split), standard: r.standard, active: r.active, usedBy,
});

/** Every Incoterm in Settings order (inactive ones included), with the contracts using it. */
export async function listIncoterms(q?: Q): Promise<IncotermRow[]> {
  const db = q ?? (await getDb());
  const [rows, uses] = await Promise.all([
    db.select().from(incoterms).orderBy(asc(incoterms.position)),
    db.select({ id: contracts.incotermId, n: sql<number>`count(*)::int` }).from(contracts).groupBy(contracts.incotermId),
  ]);
  const used = new Map(uses.map((u) => [u.id, u.n]));
  return rows.map((r) => rowOf(r, used.get(r.id) ?? 0));
}

/** Writers of the table: the Settings workspace and the roles that edit Settings (the portfolio director, A-14). */
function settingsWriter(actor: Actor): void {
  requireWorkspace('settings', actor, 'Settings');
  if (!canEditSettings(actor.role)) throw new Error(SETTINGS_DIRECTOR_ONLY);
}

const snapshot = (i: Pick<IncotermInput, 'nameEn' | 'nameFr' | 'descriptionEn' | 'descriptionFr' | 'modes' | 'split'>) => ({
  nameEn: i.nameEn, nameFr: i.nameFr, descriptionEn: i.descriptionEn, descriptionFr: i.descriptionFr, modes: i.modes, split: splitText(i.split),
});

/** "Add Incoterm" (a code not in the table) or "Edit" (an existing code: names, descriptions, modes, split). */
export async function saveIncoterm(input: IncotermInput, mode: 'create' | 'update', actor: Actor): Promise<void> {
  settingsWriter(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(incoterms).where(eq(incoterms.code, input.code));
    const who = await whoIs(tx, actor);
    const values = { nameEn: input.nameEn, nameFr: input.nameFr, descriptionEn: input.descriptionEn, descriptionFr: input.descriptionFr, modes: input.modes, split: input.split };
    if (mode === 'create') {
      if (cur) throw new Error('This Incoterm already exists');
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${incoterms.position}), -1)::int` }).from(incoterms);
      const [row] = await tx.insert(incoterms).values({ code: input.code, ...values, standard: false, active: true, position: max + 1 }).returning({ id: incoterms.id });
      const message = systemMessage('incoterm.added', { code: input.code, split: splitText(input.split) });
      await trace(tx, who, {
        objectRef: `Incoterm ${input.code}`, area: 'Settings', entityType: 'incoterm', entityId: row.id, message, after: snapshot(input), activity: { kind: 'change', message },
      });
      return;
    }
    if (!cur) throw new Error('Unknown Incoterm');
    await tx.update(incoterms).set({ ...values, updatedAt: new Date() }).where(eq(incoterms.id, cur.id));
    const message = systemMessage('incoterm.edited', { code: input.code, split: splitText(input.split) });
    await trace(tx, who, {
      objectRef: `Incoterm ${input.code}`, area: 'Settings', entityType: 'incoterm', entityId: cur.id, message,
      before: snapshot({ ...cur, split: readSplit(cur.split) }), after: snapshot(input), activity: { kind: 'change', message },
    });
  });
}

/** "Remove": an unused Incoterm the administrator added is deleted; a standard or used one is deactivated (no new contract). */
export async function removeIncoterm(code: string, actor: Actor): Promise<'deleted' | 'deactivated'> {
  settingsWriter(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(incoterms).where(eq(incoterms.code, code));
    if (!cur) throw new Error('Unknown Incoterm');
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(contracts).where(eq(contracts.incotermId, cur.id));
    const mode = incotermRemoval({ standard: cur.standard, usedBy: n });
    if (mode === 'deleted') await tx.delete(incoterms).where(eq(incoterms.id, cur.id));
    else await tx.update(incoterms).set({ active: false, updatedAt: new Date() }).where(eq(incoterms.id, cur.id));
    const message = mode === 'deleted' ? systemMessage('incoterm.deleted', { code }) : systemMessage('incoterm.deactivated', { code, contracts: n });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Incoterm ${code}`, area: 'Settings', entityType: 'incoterm', entityId: cur.id, message,
      before: { active: cur.active }, after: mode === 'deleted' ? null : { active: false }, activity: { kind: 'change', message },
    });
    return mode;
  });
}

/** "Reactivate" a deactivated Incoterm. */
export async function reactivateIncoterm(code: string, actor: Actor): Promise<void> {
  settingsWriter(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(incoterms).where(eq(incoterms.code, code));
    if (!cur) throw new Error('Unknown Incoterm');
    if (cur.active) return;
    await tx.update(incoterms).set({ active: true, updatedAt: new Date() }).where(eq(incoterms.id, cur.id));
    const message = systemMessage('incoterm.reactivated', { code });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Incoterm ${code}`, area: 'Settings', entityType: 'incoterm', entityId: cur.id, message,
      before: { active: false }, after: { active: true }, activity: { kind: 'change', message },
    });
  });
}

// ── The contract's Incoterm (decision 2) ────────────────────────────────────────────────────────────────────────────

export interface ContractIncoterm {
  /** The project has a contract (the Incoterm lives on it). */
  hasContract: boolean;
  incoterm: IncotermRow | null;
  /** Named place ("Le Havre — terminal site"), as typed. */
  place: string | null;
}

/** The project's contract Incoterm and named place; `hasContract` false when the project has no contract. */
export async function getContractIncoterm(projectCode: string, q?: Q): Promise<ContractIncoterm> {
  const db = q ?? (await getDb());
  const [c] = await db
    .select({ id: contracts.id, incotermId: contracts.incotermId, place: contracts.incotermPlace })
    .from(contracts).innerJoin(projects, eq(projects.id, contracts.projectId)).where(eq(projects.code, projectCode));
  if (!c) return { hasContract: false, incoterm: null, place: null };
  if (!c.incotermId) return { hasContract: true, incoterm: null, place: c.place };
  const [r] = await db.select().from(incoterms).where(eq(incoterms.id, c.incotermId));
  return { hasContract: true, incoterm: r ? rowOf(r) : null, place: c.place };
}

/**
 * The contract's Incoterm (an active code, or the current one kept) and named place — the contract editors (P-4, re-checked
 * here: `editsContract`). `code` null clears both.
 */
export async function setContractIncoterm(projectCode: string, code: string | null, place: string | null, actor: Actor): Promise<void> {
  const text = place?.trim() || null;
  if (text && text.length > INCOTERM_PLACE_MAX) throw new Error('Text too long');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: contracts.id, ref: contracts.reference, projectId: contracts.projectId, incotermId: contracts.incotermId, place: contracts.incotermPlace })
      .from(contracts).innerJoin(projects, eq(projects.id, contracts.projectId)).where(eq(projects.code, projectCode));
    if (!c) throw new Error('No contract registered for this project');
    if (!(await editsContract(tx, actor, c.projectId))) throw new Error('The contract is read-only for you');
    let incotermId: string | null = null;
    if (code) {
      const [r] = await tx.select({ id: incoterms.id, active: incoterms.active }).from(incoterms).where(eq(incoterms.code, code));
      if (!r || (!r.active && r.id !== c.incotermId)) throw new Error('Unknown Incoterm');
      incotermId = r.id;
    }
    const placeAfter = incotermId ? text : null;
    if (incotermId === c.incotermId && placeAfter === c.place) return;
    const before = c.incotermId ? (await tx.select({ code: incoterms.code }).from(incoterms).where(eq(incoterms.id, c.incotermId)))[0]?.code ?? null : null;
    await tx.update(contracts).set({ incotermId, incotermPlace: placeAfter, updatedAt: new Date() }).where(eq(contracts.id, c.id));
    const message = systemMessage('contract.incoterm', { project: projectCode, incoterm: code ?? '', place: placeAfter ?? '' });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: c.ref, area: 'Contract', entityType: 'contract', entityId: c.id, projectId: c.projectId, message,
      before: { incoterm: before, place: c.place }, after: { incoterm: code, place: placeAfter }, activity: { kind: 'change', message },
    });
  });
}
