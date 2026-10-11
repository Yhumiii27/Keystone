import 'server-only';
// Projects register DAL (docs/spec/03 §5): everything the lifecycle register reads in a few queries, the New
// project wizard setup (templates, numbering inputs, client codes, project managers) and the register's writes (stage
// moves, deliverable ticks with auto-advance, wizard creation).
// Chapter 4 (A-2 / L-3, rules in src/domain/project-template.ts): the wizard reads the machine types as edited on the
// Machine types screen and creation instantiates the template — WBS phases as work packages with their activities and
// finish-to-start links, the cost categories, the ITP plan — with the chosen PM, planned window, calendar and currency.
// Permission checks, input validation and revalidation belong to src/features/projects/actions.ts.
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from '@/domain/calendar';
import { projectDataDate } from '@/domain/ch4-defaults';
import {
  allocateProjectIdentity, deliverableToggle, NEW_PROJECT_DEFAULTS, nextProjectId, wizardTotal, type ProjectIdentity,
} from '@/domain/lifecycle';
import {
  DEFAULT_PLANNED_FINISH, DEFAULT_PLANNED_START, instantiateTemplate, monthOfIso, templateActivitiesText, templateWbsText,
} from '@/domain/project-template';
import { activityDateText } from '@/domain/schedule-rollup';
import { getDb } from '@/server/db/client';
import {
  calendar, clientCode3, costType, machineType, type CalendarCode, type CostType, type MachineTypeCode, type StageCode, type TransitionMode,
} from '@/server/db/codes';
import { recordActivity, writeAudit } from '@/server/db/helpers';
import { databaseSeedMode } from '@/server/db/seed/mode';
import {
  activities, activityLinks, cities, clients, costCategories, countries, itpPlans, machineTypeCostCategories, machineTypeItpSystems, machineTypePhases, machineTypes,
  persons, projectSites, projectTemplates, projects, stageDeliverableChecks, stageDeliverableDefs, wbsNodes,
} from '@/server/db/schema';
import { loadWorkCalendars } from './calendars';
import { healthThresholds, type HealthThresholds } from './health-thresholds';
import { listStageHistory, listStages, recordStageChange, setStageDeliverable, type StageHistoryRow, type StageInfo } from './lifecycle';
import { getClientCodes } from './people';
import { listScheduleSummaries, type MilestoneRow, type ScheduleControl } from './planning';
import { listProjects, type ProjectRow } from './projects';
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
  /** Data date of each project (ISO; the status date until S-4 writes one): "today" of the stage-change date (L-4c). */
  dataDates?: Record<string, string>;
}

/** Everything the Projects register renders. */
export async function getRegisterData(): Promise<RegisterData> {
  const db = await getDb();
  const [list, stages, checklists, history, schedules, inactiveStages, planned, thresholds, dates] = await Promise.all([
    listProjects(), listStages(), listStageChecklists(), listStageHistory(), listScheduleSummaries(), inactiveStageCodes(), listPlannedProjectCodes(),
    healthThresholds(), db.select({ code: projects.code, dataDate: projects.dataDate }).from(projects),
  ]);
  const dataDates = Object.fromEntries(dates.map((d) => [d.code, projectDataDate(d)]));
  return { projects: list, stages, checklists, history, schedules, inactiveStages, planned, thresholds, dataDates };
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
  const [blankTpl, tpls, mts, phases, cats, itp, numbers, clientCodes, managers, settingsCats, countryRows, cityRows] = await Promise.all([
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
  ]);
  const blank = blankTpl[0];
  const templates: WizardTemplate[] = [
    {
      id: 'blank', mt: null, name: blank?.name ?? 'Projet blank', desc: blank?.description ?? '', wbs: blank?.wbsSummary ?? 'Vide',
      acts: blank?.activitiesSummary ?? 'Aucune', cal: calendar.label(blank?.calendar ?? 'standard_5x8'), calCode: blank?.calendar ?? 'standard_5x8',
      phases: [], cats: [], itpSystems: [],
    },
    ...mts.map((m) => {
      const own = phases.filter((p) => p.machineTypeCode === m.code).map((p) => p.name);
      const tpl = tpls.find((t) => t.machineTypeCode === m.code);
      const cal = m.calendar ?? tpl?.calendar ?? 'standard_5x8';
      return {
        id: m.label, mt: m.label, name: tpl?.name ?? `Planning ${m.label}`, desc: m.description || tpl?.description || '',
        wbs: templateWbsText(own.length), acts: templateActivitiesText(own.length), cal: calendar.isCode(cal) ? calendar.label(cal) : cal, calCode: cal,
        phases: own,
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
  };
}

export interface WizardCreateInput {
  /** '' → "Untitled project" (the Server Function requires a name, L-3). */
  name: string;
  /** Client / sponsor ('' → none, shown "—"; the Server Function requires one, L-3). */
  client: string;
  das: string;
  machineType: MachineTypeCode;
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
}

/**
 * npCreate (3969), in one transaction: allocates the identity (next number "#045", code "<XXX>-<digits>", analytic
 * code — domain `allocateProjectIdentity`), registers an unknown client (without a 3-letter code, as the prototype
 * leaves CLIENT_CODES untouched), inserts the project at Initiative (progress 0, SPI 1), flagged new and first in the
 * register, with the chosen PM, planned window, calendar, currency and contingency, stores the wizard's cost categories
 * ("C01"…; actual and committed 0, forecast = budget) and instantiates the machine-type template (A-2): WBS root + one
 * work package per phase, the template activities chained finish-to-start on the project calendar, and the ITP plan of
 * the machine type, and the site (L-3b; zone from the country). Validation and permission checks belong to the calling
 * Server Function.
 */
export async function createWizardProject(input: WizardCreateInput): Promise<CreatedProject> {
  const db = await getDb();
  const name = input.name.trim() || 'Untitled project';
  const client = input.client.trim();
  const cats = input.categories.map((c) => ({ ...c, name: c.name.trim() || 'New category', budget: Number.isFinite(c.budget) ? c.budget : 0 }));
  const budget = wizardTotal(cats, input.contingencyPct);
  const plannedStart = input.plannedStart ?? DEFAULT_PLANNED_START;
  const askedFinish = input.plannedFinish === undefined ? DEFAULT_PLANNED_FINISH : input.plannedFinish;
  const startM = monthOfIso(plannedStart);
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
        : tx.select({ name: machineTypePhases.name }).from(machineTypePhases).where(eq(machineTypePhases.machineTypeCode, input.templateCode)).orderBy(asc(machineTypePhases.position)),
      input.templateCode === 'blank'
        ? Promise.resolve([])
        : tx.select({ name: machineTypeItpSystems.name }).from(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, input.templateCode)),
      loadWorkCalendars(null, tx),
    ]);
    // A-2: plan the machine-type template first — without a planned finish, the plan gives it (L-3b).
    const cal = calendars[input.calendar] ?? new WorkCalendar(BUILTIN_CALENDAR_BY_CODE[input.calendar] ?? BUILTIN_CALENDAR_BY_CODE.standard_5x8);
    const plan = instantiateTemplate({
      phases: phaseRows.map((p) => p.name), start: plannedStart, finish: askedFinish, calendar: cal, budgetKeur: cats.reduce((a, c) => a + c.budget, 0),
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
          projectId, code: '1', name, level: 0, position: 0, startText: plan.startDate ? activityDateText(plan.startDate) : null,
          finishText: plan.finishDate ? activityDateText(plan.finishDate) : null, startDate: plan.startDate, finishDate: plan.finishDate, ownerPersonId: pmId,
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
            startDate: own[0]?.startDate ?? null, finishDate: own.at(-1)?.finishDate ?? null,
          })
          .returning({ id: wbsNodes.id });
        for (const a of own) {
          const [row] = await tx
            .insert(activities)
            .values({
              projectId, wbsNodeId: node.id, code: a.code, name: a.name, durationDays: a.durationDays,
              startText: activityDateText(a.startDate), startActual: false, finishText: activityDateText(a.finishDate), finishActual: false,
              startDate: a.startDate, finishDate: a.finishDate, baselineFinishText: activityDateText(a.finishDate), baselineFinishDate: a.finishDate,
              varianceDays: 0, constraintViolated: false, totalFloatDays: 0, percentComplete: 0, ownerPersonId: pmId,
              budgetKeur: a.budgetKeur, actualKeur: 0, eacKeur: a.budgetKeur, packageName: pkg.name, position: position++,
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
    if (itpPlan) await tx.insert(itpPlans).values({ projectId, machineTypeCode: input.templateCode as MachineTypeCode });

    const actorName = input.actorName ?? 'System';
    const [actor] = input.actorName
      ? await tx.select({ id: persons.id, full: persons.fullName }).from(persons).where(or(eq(persons.fullName, input.actorName), eq(persons.shortName, input.actorName)))
      : [];
    const who = { actorName: actor?.full ?? actorName, actorPersonId: actor?.id ?? null };
    const tplText = input.templateCode === 'blank' ? 'blank' : `${templateId(input.templateCode)} · ${plan.packages.length} work packages · ${plan.activities.length} activities`;
    await writeAudit(tx, { ...who, objectRef: id.code, change: `project created · ${name} · template ${tplText} · ${cats.length} cost categories${site ? ` · site ${site.city}, ${site.countryName}` : ''}`, area: 'Projects', entityType: 'project', entityId: projectId, projectId });
    await recordActivity(tx, { ...who, text: `${id.code} · ${name} created at Initiative`, kind: 'change', projectId });
    return { ...id, name, budget, workPackages: plan.packages.length, activities: plan.activities.length, links: plan.links.length, itpPlan };
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
