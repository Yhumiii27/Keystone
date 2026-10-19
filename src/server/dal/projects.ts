import 'server-only';
// Projects DAL — contract used by the shell and every screen (Drizzle queries over src/server/db).
import { asc, eq, like, sql } from 'drizzle-orm';
import { cache } from 'react';
import { healthOf, type Health, type HealthThresholds } from '@/domain/health';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { clientCode3, machineType, stage, type CalendarCode, type CostType, type MachineTypeCode, type StageCode } from '@/server/db/codes';
import { clients, countries, persons, projectControls, projectSites, projects } from '@/server/db/schema';
import type { ZoneKey } from '@/server/session';
import { getCostControl, type CostControl } from './cost';
import { listProjectEvms, type ProjectEvm } from './evm';
import { healthThresholds } from './health-thresholds';
import { getActivities, getMilestones, getScheduleBars, getScheduleControl, getWbs, toProtoActs, type ProtoAct, type ScheduleControl } from './planning';

export interface ProjectRow {
  code: string;            // 'HLT-026'
  name: string;            // English name, e.g. 'Harbor Line Terminal Expansion'
  displayId: string;       // '#026' (PROJ_ID) or the code when none
  analytic: string | null; // 'HAV004'
  das: string | null;      // business area '1'..'4'
  machineType: string | null; // 'EMP' | 'MEMU' | 'SPUR' | 'AUTRE' | 'R&D'
  status: string;          // lifecycle stage, French domain value (prototype label), e.g. 'Fabrication & Assemblage'
  pm: string;              // 'R. Aubert'
  /** persons.id of the project manager (R-039: ownership by person for signed-in users). */
  pmPersonId: string | null;
  client: string;          // 'Port authority'
  start: string;           // 'Jan 2026'
  finish: string;          // 'Dec 2026'
  budget: number;          // k€
  actual: number;          // k€
  progress: number;        // 0..1
  spi: number | null;
  city: string | null;
  country: string | null;
  zone: ZoneKey;
  /** Has planning/cost data (the 6 DEFS projects). Others show empty states on project screens. */
  hasData: boolean;
  health: Health | null;
  /** Stable lifecycle stage code ('fabrication_assemblage'); `status` is its prototype label. */
  stage: StageCode;
  /** 3-letter key used by tasks, requests, BOM usage… ('HLT'). */
  shortCode: string;
  /** Created by the New project wizard and not moved since ("New" tag). */
  isNew: boolean;
  lat: number | null;
  lng: number | null;
}

/** "#026 · Harbor Line Terminal Expansion" (pname). */
export const projectLabel = (p: Pick<ProjectRow, 'displayId' | 'name'>) => `${p.displayId} · ${p.name}`;

const projectSelect = {
  p: projects,
  client: clients.name,
  pm: persons.shortName,
  city: projectSites.city,
  country: projectSites.countryName,
  lat: projectSites.lat,
  lng: projectSites.lng,
  zoneOverride: projectSites.zoneOverride,
  countryZone: countries.zoneCode,
  controls: projectControls.projectId,
};

type Joined = { p: typeof projects.$inferSelect; client: string | null; pm: string | null; city: string | null; country: string | null;
  lat: number | null; lng: number | null; zoneOverride: ZoneKey | null; countryZone: ZoneKey | null; controls: string | null };

/**
 * `th` = Settings › Project health rules (A-13: one health rule everywhere). `evm` = the project's earned value computed from
 * its activities (delivery 7, R-073): progress, actual cost and SPI at the data date replace the stored (seeded) figures,
 * which stay for a project without activity budgets.
 */
function toRow(r: Joined, th: HealthThresholds, evm: ProjectEvm | undefined): ProjectRow {
  const p = r.p;
  const row = {
    code: p.code, name: p.name, displayId: p.number ?? p.code, analytic: p.analyticCode, das: p.das,
    machineType: p.machineTypeCode ? (machineType.isCode(p.machineTypeCode) ? machineType.label(p.machineTypeCode) : p.machineTypeCode) : null,
    status: stage.label(p.stage), pm: r.pm ?? '—', pmPersonId: p.pmPersonId, client: r.client ?? '—', start: p.startText, finish: p.finishText,
    budget: p.budgetKeur, actual: evm ? evm.ac : p.actualKeur, progress: evm ? evm.progress : p.progress, spi: evm ? evm.spi : p.spi,
    city: r.city, country: r.country, zone: r.zoneOverride ?? r.countryZone ?? 'euna', hasData: r.controls != null,
    stage: p.stage, shortCode: p.shortCode, isNew: p.isNew, lat: r.lat, lng: r.lng,
  };
  return { ...row, health: healthOf(row, th) };
}

/** All projects in register order (new projects first). Memoised per request. */
export const listProjects = cache(async (): Promise<ProjectRow[]> => {
  const [db, th, evms] = await Promise.all([getDb(), healthThresholds(), listProjectEvms()]);
  const rows = await db
    .select(projectSelect)
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(persons, eq(persons.id, projects.pmPersonId))
    .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
    .leftJoin(countries, eq(countries.name, projectSites.countryName))
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .orderBy(asc(projects.sortOrder));
  return rows.map((r) => toRow(r, th, evms.get(r.p.code)));
});

export async function getProject(code: string): Promise<ProjectRow | null> {
  return (await listProjects()).find((p) => p.code === code) ?? null;
}

// ── projectData() ──────────────────────────────────────────────────────────────────────────────────────

/** The prototype's `projectData(code)` object (HLT_PD 3308 / generated 3310–3339), rebuilt from the DB. */
export interface ProjectData {
  PV: number[];
  EV: number[];
  AC: number[];
  BAC: number;
  OFFER: { sys: string; sup: string; amt: number; terms: string; order: number; deliv: number; acc: number | null; lead: number }[];
  /** [name, basis] */
  STREAMS: [string, string][];
  /** [name, owner short name, baselineStart, baselineEnd, forecastStart, forecastEnd, pct, critical] — months from project start. */
  TASKS: [string, string, number, number, number, number, number, boolean][];
  /** [name, baselineMonth, forecastMonth, status label 'Done' | 'Late' | 'At risk' | 'On track'] */
  MILES: [string, number, number, string][];
  ACTS: ProtoAct[];
  /** [name, budget, actual, committed, forecast] */
  CATS: [string, number, number, number, number][];
  /** [wbs, name, original, changes, actual, eac] */
  WPS: [string, string, number, number, number, number][];
  /** [id, title, amount, days, status label 'Approved' | 'Pending' | 'Rejected', meta] */
  CRS: [string, string, number, number, string, string][];
  /** [code, name, type label 'Labor'…, actuals source, budget] */
  CAT_ROWS: [string, string, string, string, number][];
  start: number;
  tNow: number;
  pct: number;
  p3: string;
  floatDays: number;
  chartMonths: string[];
  ganttMonths: string[];
  finishText: string;
  baselineText: string;
  floatText: string;
  floatShort: string;
  critText: string;
  milesText: string;
  milesSub: string;
  baselineSet: string;
  recon: CostControl['recon'];
  note: string;
  team: string[];
}

/**
 * Everything the prototype's `projectData(code)` returned, for the 6 projects with planning data; null for the
 * others (show an empty state — the prototype's fallback to Harbor Line data is a defect, 00 §7.16).
 * Prefer the typed accessors (planning.ts, cost.ts) in new code; this shape eases porting prototype logic.
 */
export async function getProjectData(code: string): Promise<ProjectData | null> {
  const [header, cost, wbs, acts, miles, bars] = await Promise.all([
    getScheduleControl(code), getCostControl(code), getWbs(code), getActivities(code), getMilestones(code), getScheduleBars(code),
  ]);
  if (!header || !cost) return null;
  const h: ScheduleControl = header;
  return {
    PV: cost.pv, EV: cost.ev, AC: cost.ac, BAC: cost.bac,
    OFFER: cost.offer.map((q) => ({ sys: q.system, sup: q.supplier, amt: q.amount, terms: q.terms, order: q.orderMonth, deliv: q.deliveryMonth, acc: q.acceptanceMonth, lead: q.leadWeeks })),
    STREAMS: cost.streams.map((s) => [s.name, s.basis]),
    TASKS: bars.map((b) => [b.name, b.owner, b.baselineStart, b.baselineEnd, b.forecastStart, b.forecastEnd, b.pct, b.critical]),
    MILES: miles.map((m) => [m.name, m.baselineMonth, m.forecastMonth, m.statusLabel]),
    ACTS: toProtoActs(wbs, acts),
    CATS: cost.categories.map((c) => [c.name, c.budget, c.actual, c.committed, c.forecast]),
    WPS: cost.workPackages.map((w) => [w.wbs, w.name, w.original, w.changes, w.actual, w.eac]),
    CRS: cost.changes.map((c) => [c.id, c.title, c.amount, c.days, c.statusLabel, c.meta]),
    CAT_ROWS: cost.categories.map((c) => [c.code, c.name, c.costTypeLabel, c.source, c.budget]),
    start: h.start, tNow: h.tNow, pct: h.pct, p3: h.p3, floatDays: h.floatDays, chartMonths: h.chartMonths, ganttMonths: h.ganttMonths,
    finishText: h.finishText, baselineText: h.baselineText, floatText: h.floatText, floatShort: h.floatShort, critText: h.critText,
    milesText: h.milesText, milesSub: h.milesSub, baselineSet: h.baselineSet, recon: cost.recon, note: cost.note, team: h.team,
  };
}

// ── Numbering and creation (New project wizard, docs/spec/03 §5.8) ─────────────────────────────────────

/**
 * Next project number: "#" + (max number + 1) on 3 digits — "#045" with the seed (nextProjectId 3177). Read through `q`: the
 * wizard previews it on the database, createProject computes it inside its write transaction (plan § 4.5 in Matrix).
 */
export async function nextProjectNumber(q?: DB | Tx): Promise<string> {
  const db = q ?? (await getDb());
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(cast(substring(${projects.number} from 2) as integer))` })
    .from(projects);
  return '#' + String((max ?? 0) + 1).padStart(3, '0');
}

/** Registered 3-letter code of a client, else the proposed one (clientCode3 3176). */
export async function clientCodeOf(clientName: string, q?: DB | Tx): Promise<{ code3: string; registered: boolean }> {
  const db = q ?? (await getDb());
  const [c] = clientName ? await db.select({ code3: clients.code3 }).from(clients).where(eq(clients.name, clientName)) : [];
  return { code3: clientCode3(clientName, c?.code3), registered: !!c?.code3 };
}

/** Next analytic code for a client: code3 + (projects with that prefix + 1) on 3 digits (nextAnalytic 3178). Read through `q`. */
export async function nextAnalyticCode(clientName: string, q?: DB | Tx): Promise<string> {
  const db = q ?? (await getDb());
  const { code3 } = await clientCodeOf(clientName, db);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects).where(like(projects.analyticCode, `${code3}%`));
  return code3 + String(n + 1).padStart(3, '0');
}

export interface NewProjectInput {
  name: string;
  client: string;
  das: string;
  machineType: MachineTypeCode;
  currency: 'EUR' | 'USD';
  templateCode: string;
  categories: { name: string; type: CostType; budget: number }[];
  contingencyPct: number;
  calendar: CalendarCode;
}

/**
 * Creates a project as the wizard's npCreate does (3969): number/analytic from the counters, code
 * "<code3>-<digits>", stage Initiative, PM S. Perrin, Jan 2027 → Sep 2027, budget Σ categories × (1 + contingency),
 * flagged new and placed first in the register. Unknown clients are registered (without a code3). Returns the code.
 * Permission checks belong to the calling Server Function.
 */
export async function createProject(input: NewProjectInput): Promise<string> {
  const db = await getDb();
  const budget = input.categories.reduce((a, c) => a + (c.budget || 0), 0) * (1 + input.contingencyPct / 100);
  // Number, analytic code and project code are computed inside the write transaction (SERIALIZABLE, R-010): two creations at
  // the same time never get the same "#NNN" — the second one is run again on the first one's result.
  return db.transaction(async (tx) => {
    const number = await nextProjectNumber(tx);
    const analytic = await nextAnalyticCode(input.client, tx);
    const { code3 } = await clientCodeOf(input.client, tx);
    const code = `${code3}-${number.slice(1)}`;
    let clientId: string | null = null;
    if (input.client) {
      const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.name, input.client));
      if (c) clientId = c.id;
      else {
        const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${clients.sortOrder}), 0)::int` }).from(clients);
        [{ id: clientId }] = await tx.insert(clients).values({ name: input.client, sortOrder: max + 1 }).returning({ id: clients.id });
      }
    }
    const [pm] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, 'S. Perrin'));
    const [{ min }] = await tx.select({ min: sql<number>`coalesce(min(${projects.sortOrder}), 1)::int` }).from(projects);
    await tx.insert(projects).values({
      code, number, shortCode: code.slice(0, 3), name: input.name || 'Untitled project', clientId, pmPersonId: pm?.id ?? null,
      stage: 'initiative', das: input.das, machineTypeCode: input.machineType, analyticCode: analytic,
      startText: 'Jan 2027', finishText: 'Sep 2027', startMonth: 12, finishMonth: 20, budgetKeur: budget, actualKeur: 0, progress: 0, spi: 1,
      isNew: true, currency: input.currency, calendar: input.calendar, contingencyPct: input.contingencyPct,
      templateCode: input.templateCode, sortOrder: min - 1,
    });
    return code;
  });
}
