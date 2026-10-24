import 'server-only';
// Projects register DAL (docs/spec/03 §5): everything the lifecycle register reads in a few queries, the New
// project wizard setup (templates, numbering inputs, client codes, project managers) and the register's writes (stage
// moves, deliverable ticks with auto-advance, wizard creation).
// Chapter 4 (A-2 / L-3, rules in src/domain/project-template.ts): the wizard reads the machine types as edited on the
// Machine types screen and creation instantiates the template — WBS phases as work packages with their activities and
// finish-to-start links, the cost categories, the ITP plan — with the chosen PM, planned window, calendar and currency.
// Permission checks, input validation and revalidation belong to src/features/projects/actions.ts.
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { BL1_DELIVERABLE_MESSAGE, bl1TickRefused, hasBl1 } from '@/domain/baseline-policy';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from '@/domain/calendar';
import { projectDataDate } from '@/domain/ch4-defaults';
import { businessToday } from '@/server/clock';
import {
  allocateProjectIdentity, deliverableToggle, NEW_PROJECT_DEFAULTS, nextProjectId, wizardTotal, type ProjectIdentity,
} from '@/domain/lifecycle';
import {
  defaultPlannedFinish, defaultPlannedStart, instantiateTemplate, monthOfIso, templateActivitiesText, templateWbsText,
} from '@/domain/project-template';
import { yearOfIso } from '@/domain/clock';
import { equipmentLotLabel, equipmentRef, equipmentSummary } from '@/domain/project-equipment';
import { activityDateText } from '@/domain/schedule-rollup';
import { getDb } from '@/server/db/client';
import {
  calendar, clientCode3, costType, machineType, type CalendarCode, type CostType, type MachineTypeCode, type StageCode, type TransitionMode,
} from '@/server/db/codes';
import { recordActivity, writeAudit } from '@/server/db/helpers';
import { databaseSeedMode } from '@/server/db/seed/mode';
import {
  activities, activityLinks, baselines, cities, clients, costCategories, countries, itpPlanSystems, itpPlans, machineTypeCostCategories, machineTypeItpSystems, machineTypePhases, machineTypes,
  persons, projectSites, projectTemplates, projects, stageDeliverableChecks, stageDeliverableDefs, wbsNodes,
} from '@/server/db/schema';
import { loadWorkCalendars } from './calendars';
import { healthThresholds, type HealthThresholds } from './health-thresholds';
import { listStageHistory, listStages, projectHasBl1, recordStageChange, setStageDeliverable, type StageHistoryRow, type StageInfo } from './lifecycle';
import { getClientCodes } from './people';
import { listScheduleSummaries, type MilestoneRow, type ScheduleControl } from './planning';
import { listProjects, type ProjectRow } from './projects';
import { ensureEquipmentPlan } from './itp';
import { checkCatalogueChoice, insertEquipmentLines } from './project-equipment';
import { listCatalogueChoices } from './machine-catalogue';
import { catalogueChoiceValue, catalogueRef } from '@/domain/machine-catalogue';
import { costCategoryOptions, inactiveStageCodes } from './settings-lists';

/** Deliverable ticks per project and stage, aligned with `StageInfo.deliverables` (absent = none ticked). */
export type StageChecklists = Record<string, Partial<Record<StageCode, boolean[]>>>;

/** All recorded deliverable ticks, one query (STAGE_DONE_DEFAULT + later ticks). */
export async function listStageChecklists(): Promise<StageChecklists> {
  const db = await getDb();
  const [stages, rows] = await Promise.all([
    listStages(),
    db
      .select({ code: projects.code, stage: stageDeliverableDefs.stage, position: stageDeliverableDefs.position, done: stageDeliverableChecks.done })
      .from(stageDeliverableChecks)
      .innerJoin(projects, eq(projects.id, stageDeliverableChecks.projectId))
      .innerJoin(stageDeliverableDefs, eq(stageDeliverableDefs.id, stageDeliverableChecks.deliverableId)),
  ]);
  const size = new Map(stages.map((s) => [s.code, s.deliverables.length]));
  const out: StageChecklists = {};
  for (const r of rows) {
    const byStage = (out[r.code] ??= {});
    const arr = (byStage[r.stage] ??= Array.from({ length: size.get(r.stage) ?? 0 }, () => false));
    if (r.position < arr.length) arr[r.position] = r.done;
  }
  return out;
}

/** Ticks of one project's stage (never undefined). */
export function checklistOf(checklists: StageChecklists, code: string, stage: StageInfo): boolean[] {
  const arr = checklists[code]?.[stage.code];
  return stage.deliverables.map((_, i) => !!arr?.[i]);
}

export type ScheduleSummaries = Record<string, ScheduleControl & { milestones: MilestoneRow[] }>;

export interface RegisterData {
  /** Register order (new projects first). */
  projects: ProjectRow[];
  /** The 13 stages (labels, ST_SHORT, LIFE, GATES, deliverables). */
  stages: StageInfo[];
  checklists: StageChecklists;
  /** Stage history per project, chronological. */
  history: Record<string, StageHistoryRow[]>;
  /** Schedule header + milestones of the projects with planning data. */
  schedules: ScheduleSummaries;
  /** Stages deactivated in Settings › Project statuses (A-14): skipped by "Move to" and the auto-advance. */
  inactiveStages?: StageCode[];
  /** Codes of the projects with a WBS (A-2: a wizard project opens on its plan from the register). */
  planned?: string[];
  /** Settings health thresholds (A-13): the register's CPI / SPI colours and attention items. */
  thresholds?: HealthThresholds;
  /** Data date of each project (ISO; the business date until S-4 writes one — R-013): "today" of the stage-change date (L-4c). */
  dataDates?: Record<string, string>;
  /** Business date (ISO, R-013). */
  today: string;
  /**
   * Delivery 8 (R-054, L-2 "a"): BL1 of each project with baselines — set (a BLn ≥ 1 current or superseded) and BL1's ISO date; the
   * APD deliverable « Planning BL1 posé » follows it (read-only in the register).
   */
  bl1?: Record<string, { set: boolean; setOn: string | null }>;
}

/** Everything the Projects register renders. */
export async function getRegisterData(): Promise<RegisterData> {
  const db = await getDb();
  const [list, stages, checklists, history, schedules, inactiveStages, planned, thresholds, dates, bls] = await Promise.all([
    listProjects(), listStages(), listStageChecklists(), listStageHistory(), listScheduleSummaries(), inactiveStageCodes(), listPlannedProjectCodes(),
    healthThresholds(), db.select({ code: projects.code, dataDate: projects.dataDate }).from(projects),
    db.select({ project: projects.code, code: baselines.code, state: baselines.state, setOn: baselines.setOn }).from(baselines).innerJoin(projects, eq(projects.id, baselines.projectId)),
  ]);
  const today = await businessToday();
  const dataDates = Object.fromEntries(dates.map((d) => [d.code, projectDataDate(d, today)]));
  const bl1: NonNullable<RegisterData['bl1']> = {};
  for (const code of new Set(bls.map((b) => b.project))) {
    const own = bls.filter((b) => b.project === code);
    bl1[code] = { set: hasBl1(own), setOn: own.find((b) => b.code === 'BL1' && b.state !== 'proposed')?.setOn ?? null };
  }
  return { projects: list, stages, checklists, history, schedules, inactiveStages, planned, thresholds, dataDates, bl1, today };
}

/** Current stage of a project (null when unknown). */
export async function getProjectStage(code: string): Promise<StageCode | null> {
  const db = await getDb();
  const [p] = await db.select({ stage: projects.stage }).from(projects).where(eq(projects.code, code));
  return p?.stage ?? null;
}

/** Deliverables of `stage` still unticked for a project (missingOf). */
export async function missingDeliverables(code: string, stage: StageCode): Promise<string[]> {
  const [stages, checklists] = await Promise.all([listStages(), listStageChecklists()]);
  const s = stages.find((x) => x.code === stage);
  if (!s) return [];
  const done = checklistOf(checklists, code, s);
  return s.deliverables.filter((_, i) => !done[i]);
}

/**
 * Moves a project (advance 3922). The caller validates the transition (domain `moveError`); the effective date (L-4c) and
 * the stage the caller saw (`from`) are re-checked by the writer, which throws StageChangeError when they do not hold.
 */
export async function moveProjectStage(
  code: string,
  to: StageCode,
  mode: TransitionMode,
  opts: { reason?: string; missing?: string[]; requestedBy?: string; effectiveOn?: string; from?: StageCode } = {},
): Promise<{ effectiveOn: string }> {
  return recordStageChange(code, to, mode, {
    reason: opts.reason, missing: opts.missing, requestedByShortName: opts.requestedBy, effectiveOn: opts.effectiveOn, from: opts.from,
  });
}

/**
 * Sets one deliverable of `stage` (toggleDeliv 3923) and auto-advances the project when this completes its current
 * stage. Returns the stage entered, if any.
 */
export async function setDeliverableAndAdvance(code: string, stage: StageCode, index: number, done: boolean, requestedBy?: string): Promise<StageCode | null> {
  // R-054 (L-2 "a"): « Planning BL1 posé » follows BL1 (re-checked here for every caller; a forced move is unchanged).
  if (bl1TickRefused({ stage, position: index, done }, (await projectHasBl1(code)).bl1)) throw new Error(BL1_DELIVERABLE_MESSAGE);
  await setStageDeliverable(code, stage, index, done);
  const [current, stages, checklists, inactive] = await Promise.all([getProjectStage(code), listStages(), listStageChecklists(), inactiveStageCodes()]);
  const s = stages.find((x) => x.code === stage);
  if (!current || !s) return null;
  // A-14: the auto-advance skips the stages deactivated in Settings › Project statuses.
  const { advanceTo } = deliverableToggle(current, stage, checklistOf(checklists, code, s), index, done, new Set<string>(inactive));
  // The auto-advance is dated today (the project's data date, L-4c default); the time of the tick stays in the audit.
  if (advanceTo) await recordStageChange(code, advanceTo, 'auto', { requestedByShortName: requestedBy, from: current });
  return advanceTo;
}

// ── New project wizard ─────────────────────────────────────────────────────────────────────────────

/** A New-project template as the wizard shows it: 'blank' (NP_TEMPLATES) or a machine type (Machine types screen). */
export interface WizardTemplate {
  /** 'blank' or the machine type label ('EMP' … 'R&D', custom codes), as the prototype's `t.id`. */
  id: string;
  /** Machine type label, null for 'blank'. */
  mt: string | null;
  name: string;
  desc: string;
  /** "6 phases · 6 work packages" / "Vide" (EN source for machine types; French data for blank). */
  wbs: string;
  /** "6 activities · 5 links" / "Aucune". */
  acts: string;
  /** Calendar label ("Standard 5d · 8h + Atelier"). */
  cal: string;
  /** Calendar code of the machine type (the wizard's default calendar when the type is chosen). */
  calCode: CalendarCode;
  phases: string[];
  /** R-185: the phases specific to an equipment (generated once per equipment line), among `phases`. */
  perEquipmentPhases: string[];
  /** [name, type label 'Labor'…, budget k as a string] as in the prototype draft. */
  cats: { name: string; type: string; budget: string }[];
  /** ITP systems the project's inspection plan starts with. */
  itpSystems: string[];
}

/** A person the wizard offers as project manager. */
export interface WizardManager {
  id: string;
  /** "R. Aubert". */
  short: string;
  /** "Romain Aubert". */
  name: string;
  initials: string;
}

export interface NewProjectSetup {
  templates: WizardTemplate[];
  /** Machine type labels offered by the wizard, in order (EMP, MEMU, SPUR, AUTRE, R&D, then custom active types). */
  machineTypes: string[];
  /** Next project number ("#045") before any code collision (see `allocateProjectIdentity`). */
  nextId: string;
  /** Registered client codes (CLIENT_CODES). */
  clientCodes: Record<string, string>;
  /** Existing numbers, codes and analytic codes: the wizard previews the identity with `allocateProjectIdentity`. */
  numbers: string[];
  codes: string[];
  analytics: string[];
  /** Project managers offered (L-3): the managers of existing projects and the people titled project manager. */
  managers: WizardManager[];
  /** Default PM: the viewer when they are a project manager, else the prototype's S. Perrin. */
  defaultManagerId: string | null;
  /** Settings › Cost categories offered by step 3's "Add category" (A-14), with their type label. */
  settingsCategories: { name: string; type: string }[];
  /** L-3b site: the countries of the countries table (EN names, in order) and the known cities with their country. */
  countries: string[];
  cities: { name: string; country: string }[];
  /** R-186: the published catalogue versions an equipment line may reference ("EMP-40T@1"), with the type label they belong to. */
  catalogue: { value: string; label: string; mt: string }[];
}

const templateId = (code: string) => (code === 'blank' ? 'blank' : machineType.isCode(code) ? machineType.label(code) : code);

/** People who may manage a project: current PMs and people whose title says project manager. */
async function managerOptions(q: Pick<Awaited<ReturnType<typeof getDb>>, 'select'>): Promise<WizardManager[]> {
  const pmIds = q.select({ id: projects.pmPersonId }).from(projects).where(isNotNull(projects.pmPersonId));
  const rows = await q
    .select({ id: persons.id, short: persons.shortName, full: persons.fullName, initials: persons.initials })
    .from(persons)
    .where(or(inArray(persons.id, pmIds), sql`lower(coalesce(${persons.jobTitle}, '')) like '%project manager%'`))
    .orderBy(asc(persons.shortName));
  return rows.map((r) => ({ id: r.id, short: r.short, name: r.full ?? r.short, initials: r.initials }));
}

/** Wizard reference data and numbering inputs. `viewerName` = the viewer (default PM when they are one). */
export async function getNewProjectSetup(viewer?: { name: string; role: string }): Promise<NewProjectSetup> {
  const db = await getDb();
  const [blankTpl, tpls, mts, phases, cats, itp, numbers, clientCodes, managers, settingsCats, countryRows, cityRows, catalogue] = await Promise.all([
    db.select().from(projectTemplates).where(eq(projectTemplates.code, 'blank')),
    db.select().from(projectTemplates).orderBy(asc(projectTemplates.sortOrder)),
    db.select().from(machineTypes).where(eq(machineTypes.active, true)).orderBy(asc(machineTypes.sortOrder)),
    db.select().from(machineTypePhases).orderBy(asc(machineTypePhases.position)),
    db.select().from(machineTypeCostCategories).orderBy(asc(machineTypeCostCategories.position)),
    db.select().from(machineTypeItpSystems).orderBy(asc(machineTypeItpSystems.position)),
    db.select({ code: projects.code, number: projects.number, analytic: projects.analyticCode }).from(projects),
    getClientCodes(),
    managerOptions(db),
    costCategoryOptions(db),
    db.select({ name: countries.name }).from(countries).orderBy(asc(countries.sortOrder)),
    db.select({ name: cities.name, country: cities.countryName }).from(cities).orderBy(asc(cities.name)),
    listCatalogueChoices(db),
  ]);
  const blank = blankTpl[0];
  const templates: WizardTemplate[] = [
    {
      id: 'blank', mt: null, name: blank?.name ?? 'Projet blank', desc: blank?.description ?? '', wbs: blank?.wbsSummary ?? 'Vide',
      acts: blank?.activitiesSummary ?? 'Aucune', cal: calendar.label(blank?.calendar ?? 'standard_5x8'), calCode: blank?.calendar ?? 'standard_5x8',
      phases: [], perEquipmentPhases: [], cats: [], itpSystems: [],
    },
    ...mts.map((m) => {
      const ownRows = phases.filter((p) => p.machineTypeCode === m.code);
      const own = ownRows.map((p) => p.name);
      const tpl = tpls.find((t) => t.machineTypeCode === m.code);
      const cal = m.calendar ?? tpl?.calendar ?? 'standard_5x8';
      return {
        id: m.label, mt: m.label, name: tpl?.name ?? `Planning ${m.label}`, desc: m.description || tpl?.description || '',
        wbs: templateWbsText(own.length), acts: templateActivitiesText(own.length), cal: calendar.isCode(cal) ? calendar.label(cal) : cal, calCode: cal,
        phases: own, perEquipmentPhases: ownRows.filter((p) => p.perEquipment).map((p) => p.name),
        cats: cats.filter((c) => c.machineTypeCode === m.code).map((c) => ({ name: c.name, type: costType.label(c.costType), budget: String(c.budgetKeur) })),
        itpSystems: itp.filter((x) => x.machineTypeCode === m.code).map((x) => x.name),
      };
    }),
  ];
  const me = viewer?.role === 'pm' ? managers.find((p) => p.name === viewer.name || p.short === viewer.name) : undefined;
  // The prototype's default PM (S. Perrin) only on a demo database (R-011): elsewhere the first manager.
  const fallback = (await databaseSeedMode(db)) === 'demo' ? managers.find((p) => p.short === NEW_PROJECT_DEFAULTS.pm) : undefined;
  return {
    templates,
    machineTypes: mts.map((m) => m.label),
    nextId: nextProjectId(numbers.map((n) => n.number)),
    clientCodes,
    numbers: numbers.map((n) => n.number).filter((n): n is string => !!n),
    codes: numbers.map((n) => n.code),
    analytics: numbers.map((n) => n.analytic).filter((a): a is string => !!a),
    managers,
    defaultManagerId: me?.id ?? fallback?.id ?? managers[0]?.id ?? null,
    settingsCategories: settingsCats.filter((c) => c.type !== 'reserve').map((c) => ({ name: c.label, type: costType.label(c.type) })),
    countries: countryRows.map((c) => c.name),
    cities: cityRows,
    catalogue: catalogue
      .filter((c) => mts.some((m) => m.code === c.machineTypeCode))
      .map((c) => ({ value: catalogueChoiceValue(c.code, c.version), label: `${catalogueRef(c.code, c.version)} · ${c.label}`, mt: templateId(c.machineTypeCode) })),
  };
}

export interface WizardCreateInput {
  /** '' → "Untitled project" (the Server Function requires a name, L-3). */
  name: string;
  /** Client / sponsor ('' → none, shown "—"; the Server Function requires one, L-3). */
  client: string;
  das: string;
  /** The main type: the first equipment line's (R-185). */
  machineType: MachineTypeCode;
  /**
   * R-185: the equipment lines (type × quantity), the first one of `machineType`; absent → one line of `machineType`, quantity 1.
   * With a machine-type template, the lots specific to an equipment are generated per line from its type's phases.
   */
  equipments?: { machineType: MachineTypeCode; quantity: number; catalogueCode?: string | null; catalogueVersion?: number | null }[];
  currency: 'EUR' | 'USD';
  /** 'blank' or the machine type code ('rnd' for R&D, custom codes): the template instantiated. */
  templateCode: string;
  categories: { name: string; type: CostType; budget: number }[];
  contingencyPct: number;
  calendar: CalendarCode;
  /** Project manager (person id); default the prototype's S. Perrin. */
  pmPersonId?: string | null;
  /**
   * Planned window (ISO). Start: default 11 Jan 2027. Finish: undefined → the prototype's 30 Sep 2027; null → taken from the
   * instantiated plan (L-3b: the wizard's planned finish is optional — each template activity then lasts
   * TEMPLATE_ACTIVITY_DAYS; a blank template has no plan, so no planned finish: "—").
   */
  plannedStart?: string;
  plannedFinish?: string | null;
  /**
   * Site (L-3b): city and a country of the countries table; the zone comes from the country (countries.zoneCode).
   * Coordinates are copied from an existing site of the same city and country (the only coordinate source Keystone has,
   * no geocoding service); else they stay null and the world map counts the project "without location".
   */
  site?: { city: string; country: string } | null;
  /** Author of the audit row and activity event. */
  actorName?: string;
}

export interface CreatedProject extends ProjectIdentity {
  name: string;
  /** BAC in k (Σ categories × (1 + contingency)). */
  budget: number;
  /** Template instantiated: work packages, activities and links created; ITP plan created. */
  workPackages: number;
  activities: number;
  links: number;
  itpPlan: boolean;
  /** R-185: the equipment lines created (EQ-01…). */
  equipments: number;
}

/**
 * npCreate (3969), in one transaction: allocates the identity (next number "#045", code "<XXX>-<digits>", analytic
 * code — domain `allocateProjectIdentity`), registers an unknown client (without a 3-letter code, as the prototype
 * leaves CLIENT_CODES untouched), inserts the project at Initiative (progress 0, SPI 1), flagged new and first in the
 * register, with the chosen PM, planned window, calendar, currency and contingency, stores the wizard's cost categories
 * ("C01"…; actual and committed 0, forecast = budget) and instantiates the machine-type template (A-2): WBS root + one
 * work package per phase, the template activities chained finish-to-start on the project calendar, and the ITP plan of
 * the machine type with its systems frozen (R-057, E-9 'a'), and the site (L-3b; zone from the country). Validation and
 * permission checks belong to the calling Server Function.
 */
export async function createWizardProject(input: WizardCreateInput): Promise<CreatedProject> {
  const db = await getDb();
  const name = input.name.trim() || 'Untitled project';
  const client = input.client.trim();
  const cats = input.categories.map((c) => ({ ...c, name: c.name.trim() || 'New category', budget: Number.isFinite(c.budget) ? c.budget : 0 }));
  const budget = wizardTotal(cats, input.contingencyPct);
  // R-013: the wizard's default window follows the business date (11 Jan → 30 Sep 2027 on 25 Sep 2026).
  const today = await businessToday();
  const plannedStart = input.plannedStart ?? defaultPlannedStart(today);
  const askedFinish = input.plannedFinish === undefined ? defaultPlannedFinish(today) : input.plannedFinish;
  const startM = monthOfIso(plannedStart);
  // R-185: the first line is the main type's; without lines, one line of the main type.
  const lines = input.equipments?.length ? input.equipments : [{ machineType: input.machineType, quantity: 1 }];
  if (lines[0].machineType !== input.machineType) throw new Error('The first equipment line is of the main type');
  return db.transaction(async (tx) => {
    // Without a chosen PM, the prototype's default (S. Perrin) on a demo database only (R-011); none on a production one.
    const demo = (await databaseSeedMode(tx)) === 'demo';
    const [existing, [registered], [defaultPm], [{ min }], tplRows, phaseRows, itpRows, calendars] = await Promise.all([
      tx.select({ code: projects.code, number: projects.number, analytic: projects.analyticCode }).from(projects),
      client ? tx.select({ id: clients.id, code3: clients.code3 }).from(clients).where(eq(clients.name, client)) : Promise.resolve([]),
      demo ? tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, NEW_PROJECT_DEFAULTS.pm)) : Promise.resolve([]),
      tx.select({ min: sql<number>`coalesce(min(${projects.sortOrder}), 1)::int` }).from(projects),
      tx.select({ code: projectTemplates.code }).from(projectTemplates).where(eq(projectTemplates.code, input.templateCode)),
      input.templateCode === 'blank'
        ? Promise.resolve([])
        : tx.select({ code: machineTypePhases.machineTypeCode, name: machineTypePhases.name, perEquipment: machineTypePhases.perEquipment }).from(machineTypePhases)
          .where(inArray(machineTypePhases.machineTypeCode, [...new Set([input.templateCode, ...lines.map((l) => l.machineType)])])).orderBy(asc(machineTypePhases.position)),
      input.templateCode === 'blank'
        ? Promise.resolve([])
        : tx.select({ name: machineTypeItpSystems.name }).from(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, input.templateCode))
          .orderBy(asc(machineTypeItpSystems.position)),
      loadWorkCalendars(null, tx),
    ]);
    // A-2: plan the machine-type template first — without a planned finish, the plan gives it (L-3b).
    const cal = calendars[input.calendar] ?? new WorkCalendar(BUILTIN_CALENDAR_BY_CODE[input.calendar] ?? BUILTIN_CALENDAR_BY_CODE.standard_5x8);
    // R-185 (choice 2): phases common to the project from the template, lots specific to an equipment per line (its type's).
    const mainPhases = phaseRows.filter((p) => p.code === input.templateCode);
    const refs = lines.map((_, i) => equipmentRef(i + 1));
    const plan = instantiateTemplate({
      phases: mainPhases.map((p) => ({ name: p.name, perEquipment: p.perEquipment })),
      equipments: input.templateCode === 'blank' ? undefined : lines.map((l, i) => ({
        ref: refs[i], label: equipmentLotLabel({ ref: refs[i], typeLabel: templateId(l.machineType), quantity: l.quantity }),
        phases: phaseRows.filter((p) => p.code === l.machineType && p.perEquipment).map((p) => p.name),
      })),
      start: plannedStart, finish: askedFinish, calendar: cal, budgetKeur: cats.reduce((a, c) => a + c.budget, 0),
    });
    const plannedFinish = askedFinish ?? plan.finishDate;
    const finishM = plannedFinish ? monthOfIso(plannedFinish) : null;
    let site: { city: string; countryName: string; lat: number | null; lng: number | null } | null = null;
    if (input.site) {
      const city = input.site.city.trim();
      const [country] = await tx.select({ name: countries.name }).from(countries).where(eq(countries.name, input.site.country));
      if (!city || !country) throw new Error('Unknown site country');
      const [known] = await tx
        .select({ lat: projectSites.lat, lng: projectSites.lng })
        .from(projectSites)
        .where(and(sql`lower(${projectSites.city}) = lower(${city})`, eq(projectSites.countryName, country.name), isNotNull(projectSites.lat), isNotNull(projectSites.lng)))
        .limit(1);
      site = { city, countryName: country.name, lat: known?.lat ?? null, lng: known?.lng ?? null };
    }
    let pmId = defaultPm?.id ?? null;
    if (input.pmPersonId) {
      const [p] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, input.pmPersonId));
      if (!p) throw new Error('Unknown project manager');
      pmId = p.id;
    }
    const id = allocateProjectIdentity({
      code3: clientCode3(client, registered?.code3),
      numbers: existing.map((p) => p.number),
      codes: existing.map((p) => p.code),
      analytics: existing.map((p) => p.analytic),
    });
    let clientId = registered?.id ?? null;
    if (client && !clientId) {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${clients.sortOrder}), 0)::int` }).from(clients);
      [{ id: clientId }] = await tx.insert(clients).values({ name: client, sortOrder: max + 1 }).returning({ id: clients.id });
    }
    const [{ id: projectId }] = await tx
      .insert(projects)
      .values({
        code: id.code, number: id.number, shortCode: id.code.slice(0, 3), name, clientId, pmPersonId: pmId,
        stage: 'initiative', das: input.das, machineTypeCode: input.machineType, analyticCode: id.analytic,
        startText: startM.text, finishText: finishM?.text ?? '—', startMonth: startM.month, finishMonth: finishM?.month ?? null,
        plannedStartDate: plannedStart, plannedFinishDate: plannedFinish,
        budgetKeur: budget, actualKeur: 0, progress: 0, spi: 1, isNew: true,
        currency: input.currency, calendar: input.calendar, contingencyPct: input.contingencyPct,
        // project_templates holds the prototype's templates only; a custom machine type keeps its code on the project.
        templateCode: tplRows.length ? input.templateCode : null, sortOrder: min - 1,
      })
      .returning({ id: projects.id });
    // L-3b: the site (zone from the country — no zone override).
    if (site) await tx.insert(projectSites).values({ projectId, ...site, zoneOverride: null });
    // R-185: the equipment lines (EQ-01 = the main type).
    // R-186: a line may reference a published catalogue version of its type.
    const lineInputs = lines.map((l) => ({
      machineTypeCode: l.machineType, quantity: l.quantity,
      catalogueCode: 'catalogueCode' in l ? l.catalogueCode ?? null : null, catalogueVersion: 'catalogueVersion' in l ? l.catalogueVersion ?? null : null,
    }));
    for (const l of lineInputs) await checkCatalogueChoice(tx, l);
    const equipmentRows = await insertEquipmentLines(tx, projectId, lineInputs);
    const equipmentId = (ref: string | undefined) => (ref ? equipmentRows.find((e) => e.ref === ref)?.id ?? null : null);
    if (cats.length)
      await tx.insert(costCategories).values(
        cats.map((c, i) => ({
          projectId, code: 'C' + String(i + 1).padStart(2, '0'), name: c.name, costType: c.type,
          budgetKeur: c.budget, actualKeur: 0, committedKeur: 0, forecastKeur: c.budget, position: i + 1,
        })),
      );

    // A-2: write the instantiated template (blank → no WBS: the project shows the planning empty states).
    if (plan.packages.length) {
      const [root] = await tx
        .insert(wbsNodes)
        .values({
          projectId, code: '1', name, level: 0, position: 0, startText: plan.startDate ? activityDateText(plan.startDate, yearOfIso(today)) : null,
          finishText: plan.finishDate ? activityDateText(plan.finishDate, yearOfIso(today)) : null, startDate: plan.startDate, finishDate: plan.finishDate, ownerPersonId: pmId,
        })
        .returning({ id: wbsNodes.id });
      let position = 1;
      const actIds = new Map<string, string>();
      for (const pkg of plan.packages) {
        const own = plan.activities.filter((a) => a.wbs === pkg.code);
        const [node] = await tx
          .insert(wbsNodes)
          .values({
            projectId, code: pkg.code, name: pkg.name, level: 1, parentId: root.id, position: position++, ownerPersonId: pmId,
            startDate: own[0]?.startDate ?? null, finishDate: own.at(-1)?.finishDate ?? null, equipmentId: equipmentId(pkg.equipment),
          })
          .returning({ id: wbsNodes.id });
        for (const a of own) {
          const [row] = await tx
            .insert(activities)
            .values({
              projectId, wbsNodeId: node.id, code: a.code, name: a.name, durationDays: a.durationDays,
              startText: activityDateText(a.startDate, yearOfIso(today)), startActual: false, finishText: activityDateText(a.finishDate, yearOfIso(today)), finishActual: false,
              startDate: a.startDate, finishDate: a.finishDate, baselineFinishText: activityDateText(a.finishDate, yearOfIso(today)), baselineFinishDate: a.finishDate,
              varianceDays: 0, constraintViolated: false, totalFloatDays: 0, percentComplete: 0, ownerPersonId: pmId,
              budgetKeur: a.budgetKeur, actualKeur: 0, eacKeur: a.budgetKeur, packageName: pkg.name, position: position++, equipmentId: equipmentId(a.equipment),
            })
            .returning({ id: activities.id });
          actIds.set(a.code, row.id);
        }
      }
      if (plan.links.length)
        await tx.insert(activityLinks).values(
          plan.links.map((l) => ({ projectId, predecessorId: actIds.get(l.predecessor)!, successorId: actIds.get(l.successor)!, type: l.type, lagDays: l.lagDays, position: 0 })),
        );
    }
    const itpPlan = itpRows.length > 0 && input.templateCode !== 'blank';
    if (itpPlan) {
      // R-185 (choice 4): one plan per equipment line — the main line's from the template (as before R-185), then each other
      // line's from its own type (fallback AUTRE).
      const [{ id: planId }] = await tx.insert(itpPlans).values({ projectId, equipmentId: equipmentRows[0]?.id ?? null, machineTypeCode: input.templateCode as MachineTypeCode })
        .returning({ id: itpPlans.id });
      // R-057 (E-9 'a'): the plan keeps the type's ITP systems of today — later edits of the machine type apply to projects created afterwards.
      await tx.insert(itpPlanSystems).values([...new Set(itpRows.map((r) => r.name))].map((name, position) => ({ planId, position, name })));
      for (const row of equipmentRows.slice(1)) await ensureEquipmentPlan(tx, projectId, row.id);
    }

    const actorName = input.actorName ?? 'System';
    const [actor] = input.actorName
      ? await tx.select({ id: persons.id, full: persons.fullName }).from(persons).where(or(eq(persons.fullName, input.actorName), eq(persons.shortName, input.actorName)))
      : [];
    const who = { actorName: actor?.full ?? actorName, actorPersonId: actor?.id ?? null };
    const tplText = input.templateCode === 'blank' ? 'blank' : `${templateId(input.templateCode)} · ${plan.packages.length} work packages · ${plan.activities.length} activities`;
    const eqText = lines.length > 1 || lines[0].quantity > 1
      ? ` · equipment ${equipmentSummary(lines.map((l) => ({ typeLabel: templateId(l.machineType), quantity: l.quantity })))}` : '';
    await writeAudit(tx, { ...who, objectRef: id.code, change: `project created · ${name} · template ${tplText}${eqText} · ${cats.length} cost categories${site ? ` · site ${site.city}, ${site.countryName}` : ''}`, area: 'Projects', entityType: 'project', entityId: projectId, projectId });
    await recordActivity(tx, { ...who, text: `${id.code} · ${name} created at Initiative`, kind: 'change', projectId });
    return { ...id, name, budget, workPackages: plan.packages.length, activities: plan.activities.length, links: plan.links.length, itpPlan, equipments: equipmentRows.length };
  });
}

/** Codes of the projects that have a WBS (template instantiated, imported or seeded): the register can open their plan. */
export async function listPlannedProjectCodes(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code })
    .from(wbsNodes)
    .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
    .where(and(eq(wbsNodes.level, 0)));
  return [...new Set(rows.map((r) => r.code))];
}

/** Number of projects (tests and sanity checks). */
export async function countProjects(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  return n;
}
