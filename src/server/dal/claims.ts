import 'server-only';
// Warranty claims & interventions DAL (docs/spec/07 §2.9). Keystone owns them. Claims and interventions follow the
// zone of their machine (fleet.ts). Claims linked to a design ECO carry its number (a Vigie ECO).
// R-143 (Q-8): claims are followed end to end — diagnosis, coverage, owner, cost, next step, design ECO, the steps Open →
// Diagnosed → Intervention planned → Closed — and interventions are planned and closed (Planned → Done) here; a done
// intervention that replaced or upgraded a part updates the machine's as-maintained configuration (R-144, E-8).
import { and, asc, eq, sql } from 'drizzle-orm';
import { savBadge } from '@/domain/aftersales';
import { claimSteps, statusAfterPlanning, type ClaimStep } from '@/domain/claims';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  SEVERITY_TAG, claimCoverage, claimStatus, interventionStatus, interventionType, ncrSeverity, nextBusinessNumber,
  type ClaimCoverage, type ClaimStatus, type InterventionStatus, type InterventionType, type NcrSeverity, type ZoneCode,
} from '@/server/db/codes';
import { interventions, machinePartRevisions, machines, parts, persons, warrantyClaims } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { listMachines, type MachineRow } from './fleet';
import { isIsoDate, optionalText, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

export type { Actor };

/** Owners offered by "New warranty claim" (AF.sav). */
export const CLAIM_OWNERS: readonly string[] = ['T. Kerbrat', 'C. Morvan', 'S. Haddad', 'J. Wagner'];

export interface ClaimRow {
  number: string;
  machineNumber: string;
  machineName: string;
  client: string;
  issue: string;
  description: string | null;
  severity: NcrSeverity;
  severityLabel: string;
  severityTag: string;
  reportedOn: string;
  status: ClaimStatus;
  statusLabel: string;
  open: boolean;
  coverage: ClaimCoverage;
  coverageLabel: string;
  costKeur: number;
  /** Design ECO (Vigie) the claim is linked to. */
  ecoNumber: string | null;
  owner: string;
  nextStep: string;
  /** R-143: diagnosis, closure date, the delivering project of the machine, interventions still planned, the steps offered. */
  diagnosis: string | null;
  closedOn: string | null;
  projectCode: string | null;
  plannedInterventions: number;
  steps: ClaimStep[];
}

export interface InterventionRow {
  number: string;
  /** R-143 / R-144: done date, report and the part fitted (configuration update); null while planned and for the seed. */
  doneOn: string | null;
  report: string | null;
  partRef: string | null;
  partRevision: string | null;
  machineNumber: string;
  machineName: string;
  site: string;
  scheduledOn: string;
  technicians: string;
  type: InterventionType;
  typeLabel: string;
  claimNumber: string | null;
  typeDetail: string | null;
  /** "Corrective · WC-014", "Corrective · WC-012 (chargeable)", "Preventive · annual check". */
  typeText: string;
  durationDays: number;
  /** "2 days", "0.5 day", "1 day". */
  durationText: string;
  status: InterventionStatus;
  statusLabel: string;
}

export interface MachineClaimCost {
  machine: MachineRow;
  claims: number;
  warrantyKeur: number;
  chargeableKeur: number;
}

export const interventionTypeText = (type: InterventionType, claim: string | null, detail: string | null) =>
  `${interventionType.label(type)}${claim ? ` · ${claim}` : ''}${detail ? `${claim ? ' ' : ' · '}${detail}` : ''}`;
export const durationTextOf = (d: number) => `${d} ${d > 1 ? 'days' : 'day'}`;

async function machineIndex(zone?: ZoneCode | null): Promise<Map<string, MachineRow>> {
  return new Map((await listMachines({ zone })).map((m) => [m.number, m]));
}

/** Warranty claims (open first, then closed, CLAIMS order within each), optionally for the machines of one zone. */
export async function listClaims(opts: { zone?: ZoneCode | null } = {}): Promise<ClaimRow[]> {
  const db = await getDb();
  const [rows, idx, planned] = await Promise.all([
    db.select({ c: warrantyClaims, mch: machines.number }).from(warrantyClaims).innerJoin(machines, eq(machines.id, warrantyClaims.machineId)).orderBy(asc(warrantyClaims.position)),
    machineIndex(opts.zone),
    db.select({ claimId: interventions.claimId, n: sql<number>`count(*)::int` }).from(interventions).where(eq(interventions.status, 'planned')).groupBy(interventions.claimId),
  ]);
  const plannedOf = new Map(planned.map((p) => [p.claimId, p.n]));
  const list = rows
    .filter((r) => idx.has(r.mch))
    .map(({ c, mch }) => {
      const m = idx.get(mch)!;
      const plannedInterventions = plannedOf.get(c.id) ?? 0;
      return {
        number: c.number, machineNumber: mch, machineName: m.name, client: m.client, issue: c.issue, description: c.description, severity: c.severity,
        severityLabel: ncrSeverity.label(c.severity), severityTag: SEVERITY_TAG[c.severity], reportedOn: c.reportedOn, status: c.status, statusLabel: claimStatus.label(c.status),
        open: c.status !== 'closed', coverage: c.coverage, coverageLabel: claimCoverage.label(c.coverage), costKeur: c.costKeur, ecoNumber: c.ecoNumber, owner: c.ownerName,
        nextStep: c.nextStep, diagnosis: c.diagnosis, closedOn: c.closedOn, projectCode: m.projectCode, plannedInterventions,
        steps: claimSteps({ status: c.status, diagnosis: c.diagnosis, plannedInterventions }),
      };
    });
  return [...list.filter((c) => c.open), ...list.filter((c) => !c.open)];
}

/** Field interventions (INTERVENTIONS order), optionally for the machines of one zone. */
export async function listInterventions(opts: { zone?: ZoneCode | null } = {}): Promise<InterventionRow[]> {
  const db = await getDb();
  const [rows, idx] = await Promise.all([
    db.select({ i: interventions, mch: machines.number, claim: warrantyClaims.number }).from(interventions).innerJoin(machines, eq(machines.id, interventions.machineId))
      .leftJoin(warrantyClaims, eq(warrantyClaims.id, interventions.claimId)).orderBy(asc(interventions.position)),
    machineIndex(opts.zone),
  ]);
  return rows.filter((r) => idx.has(r.mch)).map(({ i, mch, claim }) => {
    const m = idx.get(mch)!;
    return {
      doneOn: i.doneOn, report: i.report, partRef: i.partRef, partRevision: i.partRevision,
      number: i.number, machineNumber: mch, machineName: m.name, site: m.site, scheduledOn: i.scheduledOn, technicians: i.technicians, type: i.type,
      typeLabel: interventionType.label(i.type), claimNumber: claim ?? null, typeDetail: i.typeDetail, typeText: interventionTypeText(i.type, claim ?? null, i.typeDetail),
      durationDays: i.durationDays, durationText: durationTextOf(i.durationDays), status: i.status, statusLabel: interventionStatus.label(i.status),
    };
  });
}

/** Warranty vs chargeable cost of the machines with at least one claim (Costs per machine), in machine order. */
export async function claimCostsByMachine(opts: { zone?: ZoneCode | null } = {}): Promise<MachineClaimCost[]> {
  const [machinesList, claims] = await Promise.all([listMachines({ zone: opts.zone }), listClaims({ zone: opts.zone })]);
  return machinesList
    .map((machine) => {
      const mine = claims.filter((c) => c.machineNumber === machine.number);
      return {
        machine, claims: mine.length, warrantyKeur: mine.filter((c) => c.coverage !== 'chargeable').reduce((s, c) => s + c.costKeur, 0),
        chargeableKeur: mine.filter((c) => c.coverage === 'chargeable').reduce((s, c) => s + c.costKeur, 0),
      };
    })
    .filter((x) => x.claims > 0);
}

/**
 * Open Major / Critical claims, every zone (Warranty claims nav badge, domain rule `savBadge`). Read straight from the
 * claims: the shell computes it on every page, without the zones and ECO configuration of the machines.
 */
export async function savNavBadge(): Promise<string> {
  const db = await getDb();
  return savBadge(await db.select({ status: warrantyClaims.status, severity: warrantyClaims.severity }).from(warrantyClaims));
}

export interface NewClaimInput {
  machineNumber: string;
  issue: string;
  severity: NcrSeverity;
  coverage: ClaimCoverage;
  owner: string;
  description?: string | null;
}

/**
 * "New warranty claim" (AF.sav): Open, reported on the business date (R-013; the prototype's "today" was 30 Sep 2026) unless
 * `on` is given, cost 0, numbered WC-020, WC-021…; the next step shows the description ("—" when none), as the prototype.
 */
export async function openClaim(input: NewClaimInput, actor: Actor, on?: string): Promise<string> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  const issue = requiredText(input.issue, 'Issue', 300);
  if (!ncrSeverity.isCode(input.severity)) throw new Error('Invalid severity');
  if (!claimCoverage.isCode(input.coverage)) throw new Error('Invalid coverage');
  const owner = requiredText(input.owner, 'Owner', 120);
  const description = optionalText(input.description, 'Description', 1000);
  const reportedOn = on ?? (await businessToday());
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ id: machines.id, name: machines.name }).from(machines).where(eq(machines.number, input.machineNumber.trim()));
    if (!m) throw new Error(`Unknown machine ${input.machineNumber}`);
    const existing = await tx.select({ n: warrantyClaims.number, pos: warrantyClaims.position }).from(warrantyClaims);
    const number = nextBusinessNumber(existing.map((e) => e.n), 'WC-', 3, await demoFloor(tx, 19));
    const [o] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, owner));
    const [row] = await tx.insert(warrantyClaims).values({
      number, machineId: m.id, issue, description, severity: input.severity, reportedOn, status: 'open', coverage: input.coverage, costKeur: 0, ecoNumber: null,
      ownerName: owner, ownerPersonId: o?.id ?? null, nextStep: description ?? '—', position: existing.reduce((x, e) => Math.max(x, e.pos + 1), 0),
    }).returning({ id: warrantyClaims.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `claim opened · ${input.machineNumber.trim()} · ${ncrSeverity.label(input.severity)} · ${claimCoverage.label(input.coverage)}`, area: 'After-sales',
      entityType: 'warranty_claim', entityId: row.id, activity: { text: `Opened warranty claim ${number} on ${input.machineNumber.trim()} ${m.name}`, kind: 'quality' },
    });
    return number;
  });
}

// ── Follow-up of a claim (R-143, Q-8) ──────────────────────────────────────────────────────────────────

/** One claim ("WC-014", case-insensitive) with its interventions; null when unknown. Every zone. */
export async function getClaim(number: string): Promise<(ClaimRow & { interventions: InterventionRow[] }) | null> {
  const key = number.trim().toUpperCase();
  const c = (await listClaims()).find((x) => x.number === key);
  if (!c) return null;
  return { ...c, interventions: (await listInterventions()).filter((i) => i.claimNumber === c.number) };
}

async function claimOf(tx: Tx, number: string) {
  const [c] = await tx.select().from(warrantyClaims).where(eq(warrantyClaims.number, number));
  if (!c) throw new Error(`Unknown claim ${number}`);
  return c;
}

async function plannedOn(tx: Tx, claimId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(interventions).where(and(eq(interventions.claimId, claimId), eq(interventions.status, 'planned')));
  return r?.n ?? 0;
}

export interface ClaimUpdateInput {
  coverage: ClaimCoverage;
  owner: string;
  costKeur: number;
  nextStep: string;
  diagnosis: string | null;
  ecoNumber: string | null;
}

/**
 * "Edit claim": coverage (warranty, extended warranty, chargeable — after-sales decides, Q-8), owner, cost (k€), next step,
 * diagnosis and the design ECO (a Vigie ECO number). A closed claim is read-only. The change is audited field by field.
 */
export async function updateClaim(number: string, input: ClaimUpdateInput, actor: Actor): Promise<void> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  if (!claimCoverage.isCode(input.coverage)) throw new Error('Invalid coverage');
  if (!Number.isFinite(input.costKeur) || input.costKeur < 0) throw new Error('Invalid cost');
  const owner = requiredText(input.owner, 'Owner', 120);
  const nextStep = requiredText(input.nextStep, 'Next step', 300);
  const diagnosis = optionalText(input.diagnosis, 'Diagnosis', 2000);
  const eco = optionalText(input.ecoNumber, 'ECO', 40);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await claimOf(tx, number);
    if (c.status === 'closed') throw new Error(`${number} is closed`);
    if (c.status !== 'open' && !diagnosis) throw new Error('A diagnosed claim keeps its diagnosis');
    const [o] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, owner));
    await tx.update(warrantyClaims).set({
      coverage: input.coverage, ownerName: owner, ownerPersonId: o?.id ?? null, costKeur: input.costKeur, nextStep, diagnosis, ecoNumber: eco, updatedAt: new Date(),
    }).where(eq(warrantyClaims.id, c.id));
    const changes = [
      c.coverage !== input.coverage ? `coverage: ${claimCoverage.label(c.coverage)} → ${claimCoverage.label(input.coverage)}` : '',
      c.ownerName !== owner ? `owner: ${c.ownerName} → ${owner}` : '',
      c.costKeur !== input.costKeur ? `cost: ${c.costKeur} → ${input.costKeur} k€` : '',
      c.nextStep !== nextStep ? `next step: ${nextStep}` : '',
      (c.diagnosis ?? null) !== diagnosis ? `diagnosis: ${diagnosis ?? '—'}` : '',
      (c.ecoNumber ?? null) !== eco ? `ECO: ${c.ecoNumber ?? '—'} → ${eco ?? '—'}` : '',
    ].filter(Boolean);
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: changes.join(' · ') || 'no change', area: 'After-sales', entityType: 'warranty_claim', entityId: c.id,
      activity: eco && eco !== c.ecoNumber ? { text: `Linked warranty claim ${number} to design change ${eco}`, kind: 'eco' } : undefined,
    });
  });
}

/**
 * A step of the claim (R-143): "Mark diagnosed" (Open → Diagnosed, with the diagnosis) or "Close claim" (once diagnosed
 * and no intervention still planned; dated on the business date). With `expected` (the status the viewer saw), a claim
 * that moved on meanwhile is refused ("… has moved on"). Returns the new status.
 */
export async function advanceClaim(number: string, step: ClaimStep, actor: Actor, opts: { diagnosis?: string | null; expected?: ClaimStatus; on?: string } = {}): Promise<ClaimStatus> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  const on = opts.on ?? (await businessToday());
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await claimOf(tx, number);
    if (opts.expected && c.status !== opts.expected) throw new Error(`${number} has moved on`);
    const diagnosis = step === 'diagnose' ? requiredText(opts.diagnosis, 'Diagnosis', 2000) : c.diagnosis;
    const allowed = claimSteps({ status: c.status, diagnosis: step === 'diagnose' ? diagnosis : c.diagnosis, plannedInterventions: await plannedOn(tx, c.id) });
    if (!allowed.includes(step)) throw new Error(`${number} cannot take this step from ${claimStatus.label(c.status)}`);
    const to: ClaimStatus = step === 'diagnose' ? 'diagnosed' : 'closed';
    await tx.update(warrantyClaims).set({ status: to, diagnosis, closedOn: to === 'closed' ? on : null, updatedAt: new Date() }).where(eq(warrantyClaims.id, c.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `status: ${claimStatus.label(c.status)} → ${claimStatus.label(to)}${step === 'diagnose' ? ` · ${diagnosis}` : ''}`, area: 'After-sales',
      entityType: 'warranty_claim', entityId: c.id,
      activity: { text: step === 'diagnose' ? `Diagnosed warranty claim ${number}` : `Closed warranty claim ${number} · ${c.issue}`, kind: 'quality' },
    });
    return to;
  });
}

export interface PlanInterventionInput {
  machineNumber: string;
  /** The claim it answers; null for a preventive visit. */
  claimNumber: string | null;
  type: InterventionType;
  scheduledOn: string;
  technicians: string;
  durationDays: number;
  detail?: string | null;
}

/**
 * "Plan intervention" (R-143): a Planned intervention numbered after the highest IV-nnn, on the claim's machine (or a
 * machine for a preventive visit). A Diagnosed claim moves to Intervention planned. A closed claim is refused.
 */
export async function planIntervention(input: PlanInterventionInput, actor: Actor): Promise<string> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  if (!interventionType.isCode(input.type)) throw new Error('Invalid intervention type');
  if (!isIsoDate(input.scheduledOn)) throw new Error('Invalid date');
  if (!(input.durationDays > 0 && input.durationDays <= 30)) throw new Error('Invalid duration');
  const technicians = requiredText(input.technicians, 'Technicians', 200);
  const detail = optionalText(input.detail, 'Detail', 200);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.number, input.machineNumber));
    if (!m) throw new Error(`Unknown machine ${input.machineNumber}`);
    let claim: typeof warrantyClaims.$inferSelect | null = null;
    if (input.claimNumber) {
      claim = await claimOf(tx, input.claimNumber);
      if (claim.machineId !== m.id) throw new Error(`${input.claimNumber} is not on ${input.machineNumber}`);
      if (claim.status === 'closed') throw new Error(`${input.claimNumber} is closed`);
    }
    const existing = await tx.select({ n: interventions.number, pos: interventions.position }).from(interventions);
    const number = nextBusinessNumber(existing.map((e) => e.n), 'IV-', 3);
    await tx.insert(interventions).values({
      number, machineId: m.id, claimId: claim?.id ?? null, type: input.type, typeDetail: detail, scheduledOn: input.scheduledOn, technicians, durationDays: input.durationDays,
      status: 'planned', position: existing.reduce((x, e) => Math.max(x, e.pos + 1), 0),
    });
    const who = await whoIs(tx, actor);
    if (claim) {
      const to = statusAfterPlanning(claim.status);
      if (to !== claim.status) {
        await tx.update(warrantyClaims).set({ status: to, updatedAt: new Date() }).where(eq(warrantyClaims.id, claim.id));
        await trace(tx, who, { objectRef: claim.number, change: `status: ${claimStatus.label(claim.status)} → ${claimStatus.label(to)} · ${number}`, area: 'After-sales', entityType: 'warranty_claim', entityId: claim.id });
      }
    }
    await trace(tx, who, {
      objectRef: number, change: `intervention planned · ${input.machineNumber}${claim ? ` · ${claim.number}` : ''} · ${interventionType.label(input.type)} · ${input.scheduledOn} · ${technicians}`,
      area: 'After-sales', entityType: 'intervention',
      activity: { text: `Planned intervention ${number} on ${input.machineNumber}${claim ? ` for ${claim.number}` : ''}`, kind: 'quality' },
    });
    return number;
  });
}

export interface InterventionDoneInput {
  doneOn: string;
  report?: string | null;
  /** Part replaced or upgraded, and the revision now fitted (updates the machine's configuration). */
  partRef?: string | null;
  revision?: string | null;
}

/**
 * "Mark done" (R-143): Planned → Done, dated, with the report. When a part was replaced or upgraded, the machine's
 * as-maintained configuration records the revision now fitted (R-144, E-8: "each after-sales intervention updates it");
 * the part must be in the machine's configuration or the catalogue. An intervention already done is refused ("… has moved on").
 */
export async function completeIntervention(number: string, input: InterventionDoneInput, actor: Actor): Promise<void> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  if (!isIsoDate(input.doneOn)) throw new Error('Invalid date');
  const report = optionalText(input.report, 'Report', 2000);
  const partRef = optionalText(input.partRef, 'Part', 60);
  const revision = optionalText(input.revision, 'Revision', 10);
  if (partRef && !revision) throw new Error('The revision fitted is required');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [i] = await tx.select().from(interventions).where(eq(interventions.number, number));
    if (!i) throw new Error(`Unknown intervention ${number}`);
    if (i.status !== 'planned') throw new Error(`${number} has moved on`);
    const [m] = await tx.select({ number: machines.number }).from(machines).where(eq(machines.id, i.machineId));
    const who = await whoIs(tx, actor);
    let configChange = '';
    if (partRef) {
      const [old] = await tx.select().from(machinePartRevisions).where(and(eq(machinePartRevisions.machineId, i.machineId), eq(machinePartRevisions.partRef, partRef)));
      // A part of the machine's configuration, or of the catalogue (a new part fitted).
      const [p] = old ? [old] : await tx.select({ ref: parts.ref }).from(parts).where(eq(parts.ref, partRef));
      if (!p) throw new Error(`Unknown part ${partRef}`);
      if (old) await tx.update(machinePartRevisions).set({ revision: revision! }).where(and(eq(machinePartRevisions.machineId, i.machineId), eq(machinePartRevisions.partRef, partRef)));
      else {
        const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${machinePartRevisions.position}), -1)::int` }).from(machinePartRevisions).where(eq(machinePartRevisions.machineId, i.machineId));
        await tx.insert(machinePartRevisions).values({ machineId: i.machineId, partRef, revision: revision!, position: pos + 1 });
      }
      // The configuration is part of the machine record: its last change moves pub_parc_machines.maj_le (Arche K-07, R-193).
      await tx.update(machines).set({ updatedAt: new Date() }).where(eq(machines.id, i.machineId));
      configChange = ` · ${partRef} ${old?.revision ?? '—'} → ${revision}`;
      await trace(tx, who, { objectRef: m.number, change: `configuration: ${partRef} ${old?.revision ?? '—'} → ${revision} · ${number}`, area: 'Installed base', entityType: 'machine', entityId: i.machineId });
    }
    await tx.update(interventions).set({ status: 'done', doneOn: input.doneOn, report, partRef, partRevision: partRef ? revision : null }).where(eq(interventions.id, i.id));
    await trace(tx, who, {
      objectRef: number, change: `status: Planned → Done · ${input.doneOn}${report ? ` · ${report}` : ''}${configChange}`, area: 'After-sales', entityType: 'intervention', entityId: i.id,
      activity: { text: `Completed intervention ${number} on ${m.number}`, kind: 'quality' },
    });
  });
}

/** Parts offered by "Mark done" for a machine: its configuration first, then the catalogue's parts with a revision. */
export async function interventionPartOptions(machineNumber: string): Promise<string[]> {
  const db = await getDb();
  const [cfg, cat] = await Promise.all([
    db.select({ ref: machinePartRevisions.partRef }).from(machinePartRevisions).innerJoin(machines, eq(machines.id, machinePartRevisions.machineId))
      .where(eq(machines.number, machineNumber)).orderBy(asc(machinePartRevisions.position)),
    db.select({ ref: parts.ref, revision: parts.revision }).from(parts).orderBy(asc(parts.position)),
  ]);
  const own = cfg.map((c) => c.ref);
  return [...own, ...cat.filter((p) => p.revision && !own.includes(p.ref)).map((p) => p.ref)];
}
