import 'server-only';
// Installed base DAL (docs/spec/07 §2.8; part record "Installed base" 09 §2.2). Keystone owns the machines and their
// as-maintained configuration; the configuration state against engineering changes (pending / retrofit / pinned) comes
// from the ECO effectivity Vigie reports (Vigie ECO mirror, src/server/dal/eco.ts). Machine zone: the site's city
// (cities → countries → zones), else the delivering project's zone when it has a site, else Europe & North America
// (`machineZone` 4981). Time model: "Warranty ending < 90 days" and "ends in n d" use the prototype's month index
// against PG_NOW (as the interfaces' "in n d").
import { asc, eq, inArray } from 'drizzle-orm';
import { addedWarrantyStatus, warrantyEnding } from '@/domain/aftersales';
import { DEFAULT_WARRANTY_MONTHS, MAX_MACHINES_PER_DELIVERY, asBuiltConfiguration, isDeliveredStage, machineNames, warrantyMonthsOf } from '@/domain/claims';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  installedPartState, machineType, nextBusinessNumber, warrantyStatus, fmtDOfIso,
  type InstalledPartState, type StageCode, type WarrantyStatus, type ZoneCode,
} from '@/server/db/codes';
import {
  cities, clients, contracts, countries, machinePartRevisions, machineTypes, machines, parts, projectAssemblyRoots, projectBomLines, projectSites, projects, warrantyClaims,
} from '@/server/db/schema';
import { listEcos } from './eco';
import { isIsoDate, managesProject, optionalDate, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
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
    const number = nextBusinessNumber(existing.map((e) => e.n), 'MCH-', 3, await demoFloor(tx, 49));
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

// ── Machines registered at the project's delivery (R-144, E-8) ───────────────────────────────────────────

export interface DeliveryCandidate {
  projectCode: string;
  stage: StageCode;
  /** Project manager ("R. Aubert"): a project manager registers the machines of their own projects. */
  pm: string;
  /** "#026 · Harbor Line Terminal Expansion". */
  label: string;
  machineType: string;
  client: string;
  /** "Le Havre" (the project's site city), '' when none. */
  site: string;
  /** Default base name of the machines ("EMP — Harbor Line Terminal Expansion"). */
  defaultName: string;
  /** Machines of the project's assembly roots (Σ quantities), at least 1. */
  defaultCount: number;
  /** Warranty months from the contract's text ("24 months from SAT"), else the default (24). */
  warrantyMonths: number;
  /** Parts with a revision in the project's BOM: the as-built configuration recorded. */
  trackedParts: number;
  /** Machines already registered for the project. */
  registered: number;
}

/**
 * Projects whose machines may be registered at delivery: delivered projects (stage Expédition or later, `isDeliveredStage`)
 * of a machine type (not R&D) with a bill of materials carrying at least one part with a revision (the as-built
 * configuration), with their defaults.
 */
export async function listDeliveryCandidates(): Promise<DeliveryCandidate[]> {
  const db = await getDb();
  const [list, bom, ctr, mch, types, sites] = await Promise.all([
    listProjects(),
    db.select({ projectId: projectBomLines.projectId, code: projects.code, ref: parts.ref, revision: parts.revision }).from(projectBomLines)
      .innerJoin(parts, eq(parts.id, projectBomLines.partId)).innerJoin(projects, eq(projects.id, projectBomLines.projectId)).orderBy(asc(projectBomLines.position)),
    db.select({ code: projects.code, warranty: contracts.warranty }).from(contracts).innerJoin(projects, eq(projects.id, contracts.projectId)),
    db.select({ code: machines.projectCode }).from(machines),
    db.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes),
    db.select({ code: projects.code, city: projectSites.city }).from(projectSites).innerJoin(projects, eq(projects.id, projectSites.projectId)),
  ]);
  const roots = await rootQuantities();
  const typeLabel = new Map(types.map((t) => [t.code, t.label]));
  return list
    .filter((p) => isDeliveredStage(p.stage) && p.machineType !== 'R&D')
    .map((p) => {
      const tracked = asBuiltConfiguration(bom.filter((b) => b.code === p.code)).length;
      const mt = p.machineType && p.machineType !== 'R&D' ? p.machineType : null;
      const label = mt ? typeLabel.get(machineType.labels.includes(mt) ? machineType.code(mt) : mt) ?? mt : 'Machine';
      return {
        projectCode: p.code, stage: p.stage, pm: p.pm, label: `${p.displayId} · ${p.name}`, machineType: mt ?? 'AUTRE', client: p.client, site: sites.find((x) => x.code === p.code)?.city ?? p.city ?? '',
        defaultName: `${label} — ${p.name}`, defaultCount: Math.min(MAX_MACHINES_PER_DELIVERY, Math.max(1, roots.get(p.code) ?? 1)),
        warrantyMonths: warrantyMonthsOf(ctr.find((c) => c.code === p.code)?.warranty) ?? DEFAULT_WARRANTY_MONTHS, trackedParts: tracked,
        registered: mch.filter((m) => m.code === p.code).length,
      };
    })
    .filter((c) => c.trackedParts > 0);
}

/** Σ quantities of each project's assembly roots (machines delivered), by project code. */
async function rootQuantities(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, qty: projectAssemblyRoots.quantity }).from(projectAssemblyRoots).innerJoin(projects, eq(projects.id, projectAssemblyRoots.projectId));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.code, (out.get(r.code) ?? 0) + Math.round(r.qty));
  return out;
}

export interface RegisterMachinesInput {
  count: number;
  /** Base name; numbered "#1", "#2"… when several machines are registered. */
  name: string;
  site: string;
  deliveredOn: string;
  warrantyEndOn: string;
}

/**
 * "Register delivered machines" (R-144, E-8 "a": created at the project's delivery, kept by after-sales): creates the
 * project's machines — numbered after the highest MCH-nnn, machine type and client of the project, its site, delivery
 * date = warranty start, warranty end — each with the as-built configuration of the project's bill of materials (every
 * part carrying a revision, at its catalogue revision). The project's manager (for their projects), quality, procurement
 * and the director. Returns the machine numbers.
 */
export async function registerDeliveredMachines(projectCode: string, input: RegisterMachinesInput, actor: Actor): Promise<string[]> {
  requireWorkspace('fleet', actor, 'Installed base');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_MACHINES_PER_DELIVERY) throw new Error('Invalid number of machines');
  const base = requiredText(input.name, 'Machine', 160);
  const site = (input.site ?? '').trim();
  if (site.length > 200) throw new Error('Site is too long');
  if (!isIsoDate(input.deliveredOn) || !isIsoDate(input.warrantyEndOn)) throw new Error('Invalid date');
  if (input.warrantyEndOn <= input.deliveredOn) throw new Error('Warranty end is before delivery');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, code: projects.code, pmPersonId: projects.pmPersonId, clientId: projects.clientId, mt: projects.machineTypeCode, name: projects.name })
      .from(projects).where(eq(projects.code, projectCode));
    if (!p) throw new Error(`Unknown project ${projectCode}`);
    if (actor.role === 'pm' && !(await managesProject(tx, actor, p))) throw new Error('Only the project manager of this project registers its machines');
    const [stageRow] = await tx.select({ stage: projects.stage }).from(projects).where(eq(projects.id, p.id));
    if (!stageRow || !isDeliveredStage(stageRow.stage)) throw new Error(`${projectCode} is not delivered yet`);
    const [client] = p.clientId ? await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, p.clientId)) : [];
    const [mt] = p.mt ? await tx.select({ code: machineTypes.code }).from(machineTypes).where(eq(machineTypes.code, p.mt)) : [];
    const typeCode = mt && mt.code !== 'rnd' ? mt.code : 'AUTRE';
    const bom = await tx.select({ ref: parts.ref, revision: parts.revision }).from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId))
      .where(eq(projectBomLines.projectId, p.id)).orderBy(asc(projectBomLines.position));
    const config = asBuiltConfiguration(bom);
    if (!config.length) throw new Error(`${projectCode} has no part with a revision in its bill of materials`);
    const existing = await tx.select({ n: machines.number, pos: machines.position }).from(machines);
    let next = existing.reduce((m, e) => Math.max(m, e.pos + 1), 0);
    const taken = existing.map((e) => e.n);
    const who = await whoIs(tx, actor);
    const numbers: string[] = [];
    for (const name of machineNames(base, input.count)) {
      const number = nextBusinessNumber(taken, 'MCH-', 3, 49);
      taken.push(number);
      const [row] = await tx.insert(machines).values({
        number, machineTypeCode: typeCode, name, clientName: client?.name ?? '—', clientId: p.clientId, siteText: site, projectCode: p.code, projectId: p.id,
        deliveredOn: input.deliveredOn, warrantyEndOn: input.warrantyEndOn, warrantyStatus: addedWarrantyStatus(input.warrantyEndOn), position: next++,
      }).returning({ id: machines.id });
      await tx.insert(machinePartRevisions).values(config.map((c, position) => ({ machineId: row.id, partRef: c.ref, revision: c.revision, position })));
      await trace(tx, who, {
        objectRef: number, change: `machine delivered · ${p.code} · ${name} · ${config.length} parts as built · warranty to ${fmtDOfIso(input.warrantyEndOn)}`, area: 'Installed base',
        entityType: 'machine', entityId: row.id, projectId: p.id,
      });
      numbers.push(number);
    }
    await trace(tx, who, {
      objectRef: p.code, change: `machines registered at delivery · ${numbers.join(', ')}`, area: 'Installed base', projectId: p.id,
      activity: { text: `Registered ${numbers.length} delivered ${numbers.length === 1 ? 'machine' : 'machines'} of ${p.code} in the installed base (${numbers.join(', ')})`, kind: 'change' },
    });
    return numbers;
  });
}

/** The as-maintained configuration of some machines (part ref → revision), by machine number. */
export async function machineConfigurations(numbers: string[]): Promise<Map<string, { ref: string; revision: string }[]>> {
  const out = new Map<string, { ref: string; revision: string }[]>();
  if (!numbers.length) return out;
  const db = await getDb();
  const rows = await db.select({ number: machines.number, ref: machinePartRevisions.partRef, revision: machinePartRevisions.revision }).from(machinePartRevisions)
    .innerJoin(machines, eq(machines.id, machinePartRevisions.machineId)).where(inArray(machines.number, numbers)).orderBy(asc(machinePartRevisions.position));
  for (const r of rows) out.set(r.number, [...(out.get(r.number) ?? []), { ref: r.ref, revision: r.revision }]);
  return out;
}
