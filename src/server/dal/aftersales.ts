import 'server-only';
// Screen loaders of the Warranty & after-sales section (docs/spec/07 §2.8–2.9): Installed base and Warranty claims &
// interventions, for the zone selected in the zone bar. Composes the data layer's installed-base and claims DAL
// (fleet.ts, claims.ts — Keystone owns machines, claims and interventions) with the Vigie ECO mirror (eco.ts — the ECO
// pins of the as-maintained configuration and the design ECOs claims refer to), and lists the add-form options.
import { asc } from 'drizzle-orm';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import type { ZoneCode } from '@/server/db/codes';
import { machineTypes } from '@/server/db/schema';
import { CLAIM_OWNERS, listClaims, listInterventions, type ClaimRow, type InterventionRow } from './claims';
import { listEcos } from './eco';
import { listMachineOptions, listMachines, type MachineRow } from './fleet';

export type { ClaimRow, InterventionRow, MachineRow };

/** An ECO of the Vigie mirror, as the after-sales screens link it. */
export interface MirrorEcoRef {
  number: string;
  title: string;
  /** The ECO in Vigie. */
  vigieUrl: string;
}

export interface FleetScreenData {
  /** Machines of the zone (every machine when none is selected), FLEET order, with their configuration against Vigie's ECOs. */
  machines: MachineRow[];
  /** Business date (ISO, R-013): the warranty in force and the KPI tiles are read on it. */
  today: string;
}

export interface SavScreenData {
  machines: MachineRow[];
  /** Business date (ISO, R-013): the warranty cost of its calendar year, the warranty in force. */
  today: string;
  /** Claims of the zone's machines, open first. */
  claims: ClaimRow[];
  interventions: InterventionRow[];
  /** ECOs of the mirror by number: a claim's design ECO opens Keystone's ECO screen when Vigie reports it, else Vigie. */
  ecos: Record<string, MirrorEcoRef>;
}

async function mirrorEcos(): Promise<Record<string, MirrorEcoRef>> {
  return Object.fromEntries((await listEcos()).map((e) => [e.number, { number: e.number, title: e.title, vigieUrl: e.vigieUrl }]));
}

export async function getFleetScreen(zone: ZoneCode | null): Promise<FleetScreenData> {
  const [machines, today] = await Promise.all([listMachines({ zone }), businessToday()]);
  return { machines, today };
}

export async function getSavScreen(zone: ZoneCode | null): Promise<SavScreenData> {
  const [machines, claims, interventions, ecos, today] = await Promise.all([listMachines({ zone }), listClaims({ zone }), listInterventions({ zone }), mirrorEcos(), businessToday()]);
  return { machines, claims, interventions, ecos, today };
}

/**
 * Type options of "Add machine" (AF `fleet`: EMP, MEMU, SPUR, AUTRE): the active machine types in their order, without
 * R&D (a project type, not a delivered machine) — machine types created on the Machine types screen are offered too.
 */
export async function machineTypeOptions(): Promise<{ code: string; label: string }[]> {
  const db = await getDb();
  const rows = await db.select({ code: machineTypes.code, label: machineTypes.label, active: machineTypes.active }).from(machineTypes).orderBy(asc(machineTypes.sortOrder));
  return rows.filter((r) => r.active && r.code !== 'rnd').map((r) => ({ code: r.code, label: r.label }));
}

/** Options of "New warranty claim": every machine ("MCH-041 · Gantry crane 45 t — quay 2") and the after-sales owners. */
export async function claimFormOptions(): Promise<{ machines: { number: string; label: string }[]; owners: readonly string[] }> {
  return { machines: await listMachineOptions(), owners: CLAIM_OWNERS };
}
