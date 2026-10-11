import 'server-only';
// Warranty claims & interventions DAL (docs/spec/07 §2.9). Keystone owns them. Claims and interventions follow the
// zone of their machine (fleet.ts). Claims linked to a design ECO carry its number (a Vigie ECO).
import { asc, eq } from 'drizzle-orm';
import { savBadge } from '@/domain/aftersales';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  NOW_ISO, SEVERITY_TAG, claimCoverage, claimStatus, interventionStatus, interventionType, ncrSeverity, nextBusinessNumber,
  type ClaimCoverage, type ClaimStatus, type InterventionStatus, type InterventionType, type NcrSeverity, type ZoneCode,
} from '@/server/db/codes';
import { interventions, machines, persons, warrantyClaims } from '@/server/db/schema';
import { listMachines, type MachineRow } from './fleet';
import { optionalText, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

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
}

export interface InterventionRow {
  number: string;
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
  const [rows, idx] = await Promise.all([
    db.select({ c: warrantyClaims, mch: machines.number }).from(warrantyClaims).innerJoin(machines, eq(machines.id, warrantyClaims.machineId)).orderBy(asc(warrantyClaims.position)),
    machineIndex(opts.zone),
  ]);
  const list = rows
    .filter((r) => idx.has(r.mch))
    .map(({ c, mch }) => {
      const m = idx.get(mch)!;
      return {
        number: c.number, machineNumber: mch, machineName: m.name, client: m.client, issue: c.issue, description: c.description, severity: c.severity,
        severityLabel: ncrSeverity.label(c.severity), severityTag: SEVERITY_TAG[c.severity], reportedOn: c.reportedOn, status: c.status, statusLabel: claimStatus.label(c.status),
        open: c.status !== 'closed', coverage: c.coverage, coverageLabel: claimCoverage.label(c.coverage), costKeur: c.costKeur, ecoNumber: c.ecoNumber, owner: c.ownerName,
        nextStep: c.nextStep,
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
 * "New warranty claim" (AF.sav): Open, reported on the prototype's "today" (30 Sep 2026), cost 0, numbered WC-020,
 * WC-021…; the next step shows the description ("—" when none), as the prototype.
 */
export async function openClaim(input: NewClaimInput, actor: Actor, on: string = NOW_ISO): Promise<string> {
  requireWorkspace('sav', actor, 'Warranty claims & interventions');
  const issue = requiredText(input.issue, 'Issue', 300);
  if (!ncrSeverity.isCode(input.severity)) throw new Error('Invalid severity');
  if (!claimCoverage.isCode(input.coverage)) throw new Error('Invalid coverage');
  const owner = requiredText(input.owner, 'Owner', 120);
  const description = optionalText(input.description, 'Description', 1000);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ id: machines.id, name: machines.name }).from(machines).where(eq(machines.number, input.machineNumber.trim()));
    if (!m) throw new Error(`Unknown machine ${input.machineNumber}`);
    const existing = await tx.select({ n: warrantyClaims.number, pos: warrantyClaims.position }).from(warrantyClaims);
    const number = nextBusinessNumber(existing.map((e) => e.n), 'WC-', 3, await demoFloor(tx, 19));
    const [o] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, owner));
    const [row] = await tx.insert(warrantyClaims).values({
      number, machineId: m.id, issue, description, severity: input.severity, reportedOn: on, status: 'open', coverage: input.coverage, costKeur: 0, ecoNumber: null,
      ownerName: owner, ownerPersonId: o?.id ?? null, nextStep: description ?? '—', position: existing.reduce((x, e) => Math.max(x, e.pos + 1), 0),
    }).returning({ id: warrantyClaims.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `claim opened · ${input.machineNumber.trim()} · ${ncrSeverity.label(input.severity)} · ${claimCoverage.label(input.coverage)}`, area: 'After-sales',
      entityType: 'warranty_claim', entityId: row.id, activity: { text: `Opened warranty claim ${number} on ${input.machineNumber.trim()} ${m.name}`, kind: 'quality' },
    });
    return number;
  });
}
