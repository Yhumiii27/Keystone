import 'server-only';
// Installed base DAL (docs/spec/07 §2.8; part record "Installed base" 09 §2.2). Keystone owns the machines and their
// as-maintained configuration; the configuration state against engineering changes (pending / retrofit / pinned) comes
// from the ECO effectivity Vigie reports (Vigie ECO mirror, src/server/dal/eco.ts). Machine zone: the site's city
// (cities → countries → zones), else the delivering project's zone when it has a site, else Europe & North America
// (`machineZone` 4981). Time model: "Warranty ending < 90 days" and "ends in n d" use the prototype's month index
// against PG_NOW (as the interfaces' "in n d").
import { asc, eq } from 'drizzle-orm';
import { addedWarrantyStatus, warrantyEnding } from '@/domain/aftersales';
import { getDb } from '@/server/db/client';
import {
  installedPartState, machineType, nextBusinessNumber, warrantyStatus, fmtDOfIso,
  type InstalledPartState, type WarrantyStatus, type ZoneCode,
} from '@/server/db/codes';
import { cities, clients, countries, machinePartRevisions, machineTypes, machines, warrantyClaims } from '@/server/db/schema';
import { listEcos } from './eco';
import { isIsoDate, optionalDate, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { listProjects } from './projects';

export type { Actor };

export interface MachineConfiguration {
  /** Non-rejected ECOs of Vigie targeting the machine, by state (`machineCfg` 4197). */
  pending: number;
  retrofit: number;
  pinned: number;
  /** First ECO of the list (the configuration tags open it). */
  firstEco: string | null;
  ecos: string[];
}

export interface MachineRow {
  /** "MCH-041". */
  number: string;
  machineType: string;
  /** Display code ("EMP", "R&D"). */
  machineTypeLabel: string;
  name: string;
  client: string;
  site: string;
  zone: ZoneCode;
  /** Delivering project; null = "—". */
  projectCode: string | null;
  deliveredOn: string | null;
  warrantyEndOn: string | null;
  warrantyStatus: WarrantyStatus;
  /** The status column text: "In warranty", "Out of warranty", "Extended → 4 Jun 2027". */
  warrantyText: string;
  extendedUntil: string | null;
  /** Warranty end in the future and at most 3 months away (`wendSub`), with the prototype's day count. */
  warrantyEndingSoon: boolean;
  warrantyEndsInDays: number | null;
  generation: string | null;
  parts: { ref: string; revision: string }[];
  openClaims: number;
  /** Σ claim costs not chargeable, k€. */
  warrantyCostKeur: number;
  configuration: MachineConfiguration;
  position: number;
}

/** "Extended → 4 Jun 2027" (EN; dates "4 Jun 2027"). */
export function warrantyTextOf(status: WarrantyStatus, extendedUntil: string | null): string {
  if (status === 'extended' && extendedUntil) {
    const [y, m, d] = extendedUntil.split('-').map(Number);
    return `Extended → ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
  }
  return warrantyStatus.label(status);
}

async function zoneResolver(): Promise<(site: string, projectCode: string | null) => ZoneCode> {
  const db = await getDb();
  const [cityRows, projects] = await Promise.all([
    db.select({ city: cities.name, zone: countries.zoneCode }).from(cities).innerJoin(countries, eq(countries.name, cities.countryName)),
    listProjects(),
  ]);
  const byCity = new Map(cityRows.map((c) => [c.city, c.zone]));
  const byProject = new Map(projects.filter((p) => p.city).map((p) => [p.code, p.zone as ZoneCode]));
  return (site, projectCode) => byCity.get(site.split(' · ')[0].trim()) ?? (projectCode ? byProject.get(projectCode) : undefined) ?? 'euna';
}

/** Configuration of every machine against Vigie's non-rejected ECOs. */
async function configurations(): Promise<Map<string, MachineConfiguration>> {
  const out = new Map<string, MachineConfiguration>();
  for (const e of (await listEcos()).filter((x) => x.status !== 'rejected')) {
    for (const t of e.effectivity.filter((x) => x.targetType === 'machine')) {
      const c = out.get(t.targetRef) ?? { pending: 0, retrofit: 0, pinned: 0, firstEco: null, ecos: [] };
      if (t.disposition === 'pinned') c.pinned++;
      else if (t.disposition === 'retrofit') c.retrofit++;
      else if (!t.disposition && e.status !== 'released') c.pending++;
      else continue;
      c.ecos.push(e.number);
      c.firstEco ??= e.number;
      out.set(t.targetRef, c);
    }
  }
  return out;
}

/** Machines in service (FLEET order, machines added in Keystone after), optionally in one zone. */
export async function listMachines(opts: { zone?: ZoneCode | null } = {}): Promise<MachineRow[]> {
  const db = await getDb();
  const [rows, revs, claims, types, zoneOf, cfg] = await Promise.all([
    db.select().from(machines).orderBy(asc(machines.position)),
    db.select().from(machinePartRevisions).orderBy(asc(machinePartRevisions.position)),
    db.select({ machineId: warrantyClaims.machineId, status: warrantyClaims.status, coverage: warrantyClaims.coverage, cost: warrantyClaims.costKeur }).from(warrantyClaims),
    db.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes),
    zoneResolver(),
    configurations(),
  ]);
  const typeLabel = new Map(types.map((t) => [t.code, t.label]));
  const empty: MachineConfiguration = { pending: 0, retrofit: 0, pinned: 0, firstEco: null, ecos: [] };
  return rows
    .map((m) => {
      const ending = warrantyEnding(m.warrantyEndOn);
      const mine = claims.filter((c) => c.machineId === m.id);
      return {
        number: m.number, machineType: m.machineTypeCode, machineTypeLabel: typeLabel.get(m.machineTypeCode) ?? m.machineTypeCode, name: m.name, client: m.clientName,
        site: m.siteText, zone: zoneOf(m.siteText, m.projectCode), projectCode: m.projectCode, deliveredOn: m.deliveredOn, warrantyEndOn: m.warrantyEndOn,
        warrantyStatus: m.warrantyStatus, warrantyText: warrantyTextOf(m.warrantyStatus, m.extendedUntil), extendedUntil: m.extendedUntil, warrantyEndingSoon: ending.soon,
        warrantyEndsInDays: ending.days, generation: m.generation,
        parts: revs.filter((r) => r.machineId === m.id).map((r) => ({ ref: r.partRef, revision: r.revision })),
        openClaims: mine.filter((c) => c.status !== 'closed').length, warrantyCostKeur: mine.filter((c) => c.coverage !== 'chargeable').reduce((s, c) => s + c.cost, 0),
        configuration: cfg.get(m.number) ?? empty, position: m.position,
      };
    })
    .filter((m) => !opts.zone || m.zone === opts.zone);
}

/** One machine ("MCH-041"), case-insensitive. */
export async function getMachine(number: string): Promise<MachineRow | null> {
  return (await listMachines()).find((m) => m.number.toLowerCase() === number.trim().toLowerCase()) ?? null;
}

/** Machines per zone (the zone bar of Installed base and Warranty claims). */
export async function machinesByZone(): Promise<{ total: number; byZone: Record<ZoneCode, number> }> {
  const all = await listMachines();
  const byZone: Record<ZoneCode, number> = { euna: 0, afr: 0, apac: 0 };
  for (const m of all) byZone[m.zone]++;
  return { total: all.length, byZone };
}

export interface FittedMachine {
  number: string;
  name: string;
  generation: string | null;
  /** Revision of the part fitted ("C"). */
  revision: string;
  state: InstalledPartState;
  stateLabel: string;
  /** ECO that drives the state; null when Latest without a pending change. */
  ecoNumber: string | null;
}

/**
 * Machines carrying a part (`fleetUse` 4302) with the state of that part: Pinned / Retrofit pending / Decision pending /
 * Update planned / Latest, from the non-rejected Vigie ECOs that list the part (first Pinned wins). Database version of
 * `machinesCarryingPart` (src/server/dal/machines.ts, prototype data).
 */
export async function machinesFittedWith(ref: string): Promise<FittedMachine[]> {
  const db = await getDb();
  const rows = await db
    .select({ number: machines.number, name: machines.name, gen: machines.generation, rev: machinePartRevisions.revision })
    .from(machinePartRevisions)
    .innerJoin(machines, eq(machines.id, machinePartRevisions.machineId))
    .where(eq(machinePartRevisions.partRef, ref))
    .orderBy(asc(machines.position));
  const ecos = (await listEcos({ partRefs: [ref] })).filter((e) => e.status !== 'rejected');
  return rows.map((m) => {
    let state: InstalledPartState = 'latest';
    let eco: string | null = null;
    for (const e of ecos) {
      const t = e.effectivity.find((x) => x.targetType === 'machine' && x.targetRef === m.number);
      if (!t || state === 'pinned') continue;
      if (t.disposition === 'pinned') { state = 'pinned'; eco = e.number; }
      else if (t.disposition === 'retrofit') { state = 'retrofit_pending'; eco = e.number; }
      else if (!t.disposition && e.status !== 'released') { state = 'decision_pending'; eco = e.number; }
      else if (t.disposition === 'update' && e.status !== 'released' && state === 'latest') { state = 'update_planned'; eco = e.number; }
    }
    return { number: m.number, name: m.name, generation: m.gen, revision: m.rev, state, stateLabel: installedPartState.label(state), ecoNumber: eco };
  });
}

export interface NewMachineInput {
  name: string;
  /** Machine type code ("EMP"). */
  machineType: string;
  client: string;
  site?: string | null;
  deliveredOn?: string | null;
  warrantyEndOn?: string | null;
}

/**
 * "Add machine" (AF.fleet): numbered MCH-050, MCH-051…, no delivering project; In warranty, or Out of warranty when the
 * warranty end is already past (`addedWarrantyStatus`).
 */
export async function addMachine(input: NewMachineInput, actor: Actor): Promise<string> {
  requireWorkspace('fleet', actor, 'Installed base');
  const name = requiredText(input.name, 'Machine', 200);
  const client = requiredText(input.client, 'Client', 200);
  const site = (input.site ?? '').trim();
  const deliveredOn = optionalDate(input.deliveredOn, 'delivery date');
  const warrantyEndOn = optionalDate(input.warrantyEndOn, 'warranty end');
  if (deliveredOn && warrantyEndOn && isIsoDate(deliveredOn) && warrantyEndOn < deliveredOn) throw new Error('Warranty end is before delivery');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const typeCode = input.machineType.trim();
    const [mt] = await tx.select({ code: machineTypes.code }).from(machineTypes)
      .where(eq(machineTypes.code, machineType.labels.includes(typeCode) ? machineType.code(typeCode) : typeCode));
    if (!mt) throw new Error(`Unknown machine type ${input.machineType}`);
    const existing = await tx.select({ n: machines.number, pos: machines.position }).from(machines);
    const number = nextBusinessNumber(existing.map((e) => e.n), 'MCH-', 3, 49);
    const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.name, client));
    const [row] = await tx.insert(machines).values({
      number, machineTypeCode: mt.code, name, clientName: client, clientId: c?.id ?? null, siteText: site, projectCode: null, projectId: null, deliveredOn, warrantyEndOn,
      warrantyStatus: addedWarrantyStatus(warrantyEndOn), position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: machines.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `machine added · ${name} · ${client}${warrantyEndOn ? ` · warranty to ${fmtDOfIso(warrantyEndOn)}` : ''}`, area: 'Installed base', entityType: 'machine',
      entityId: row.id, activity: { text: `Added ${number} ${name} to the installed base`, kind: 'change' },
    });
    return number;
  });
}

/** Options of the claim form's machine select (`FLEET`: "MCH-041 · Gantry crane 45 t — quay 2"), every machine. */
export async function listMachineOptions(): Promise<{ number: string; label: string }[]> {
  const db = await getDb();
  return (await db.select({ number: machines.number, name: machines.name }).from(machines).orderBy(asc(machines.position))).map((m) => ({ number: m.number, label: `${m.number} · ${m.name}` }));
}
