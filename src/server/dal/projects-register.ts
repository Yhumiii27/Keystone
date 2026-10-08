import 'server-only';
// Projects register DAL (docs/spec/03 §5): everything the lifecycle register reads in a few queries, the New
// project wizard setup (templates, numbering inputs, client codes) and the register's writes (stage moves,
// deliverable ticks with auto-advance, wizard creation with its cost categories).
// Permission checks, input validation and revalidation belong to src/features/projects/actions.ts.
import { asc, eq, sql } from 'drizzle-orm';
import {
  allocateProjectIdentity, deliverableToggle, NEW_PROJECT_DEFAULTS, nextProjectId, wizardTotal, type ProjectIdentity,
} from '@/domain/lifecycle';
import { getDb } from '@/server/db/client';
import {
  calendar, clientCode3, costType, machineType, type CalendarCode, type CostType, type MachineTypeCode, type StageCode, type TransitionMode,
} from '@/server/db/codes';
import {
  clients, costCategories, machineTypes, persons, projectTemplateCostCategories, projectTemplatePhases, projectTemplates, projects,
  stageDeliverableChecks, stageDeliverableDefs,
} from '@/server/db/schema';
import { listStageHistory, listStages, recordStageChange, setStageDeliverable, type StageHistoryRow, type StageInfo } from './lifecycle';
import { getClientCodes } from './people';
import { listScheduleSummaries, type MilestoneRow, type ScheduleControl } from './planning';
import { listProjects, type ProjectRow } from './projects';

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
}

/** Everything the Projects register renders. */
export async function getRegisterData(): Promise<RegisterData> {
  const [list, stages, checklists, history, schedules] = await Promise.all([
    listProjects(), listStages(), listStageChecklists(), listStageHistory(), listScheduleSummaries(),
  ]);
  return { projects: list, stages, checklists, history, schedules };
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

/** Moves a project (advance 3922). The caller validates the transition (domain `moveError`). */
export async function moveProjectStage(
  code: string,
  to: StageCode,
  mode: TransitionMode,
  opts: { reason?: string; missing?: string[]; requestedBy?: string } = {},
): Promise<void> {
  await recordStageChange(code, to, mode, { reason: opts.reason, missing: opts.missing, requestedByShortName: opts.requestedBy });
}

/**
 * Sets one deliverable of `stage` (toggleDeliv 3923) and auto-advances the project when this completes its current
 * stage. Returns the stage entered, if any.
 */
export async function setDeliverableAndAdvance(code: string, stage: StageCode, index: number, done: boolean): Promise<StageCode | null> {
  await setStageDeliverable(code, stage, index, done);
  const [current, stages, checklists] = await Promise.all([getProjectStage(code), listStages(), listStageChecklists()]);
  const s = stages.find((x) => x.code === stage);
  if (!current || !s) return null;
  const { advanceTo } = deliverableToggle(current, stage, checklistOf(checklists, code, s), index, done);
  if (advanceTo) await recordStageChange(code, advanceTo, 'auto');
  return advanceTo;
}

// ── New project wizard ─────────────────────────────────────────────────────────────────────────────

/** A New-project template as the wizard shows it (NP_TEMPLATES 3179; French data). */
export interface WizardTemplate {
  /** 'blank' or the machine type label ('EMP' … 'R&D'), as the prototype's `t.id`. */
  id: string;
  /** Machine type label, null for 'blank'. */
  mt: string | null;
  name: string;
  desc: string;
  /** "6 phases · 14 lots" / "Vide". */
  wbs: string;
  /** "38 activités · 52 liens" / "Aucune". */
  acts: string;
  /** Calendar label ("Standard 5d · 8h + Atelier"). */
  cal: string;
  phases: string[];
  /** [name, type label 'Labor'…, budget k as a string] as in the prototype draft. */
  cats: { name: string; type: string; budget: string }[];
}

export interface NewProjectSetup {
  templates: WizardTemplate[];
  /** Machine type labels offered by the wizard, in order (EMP, MEMU, SPUR, AUTRE, R&D). */
  machineTypes: string[];
  /** Next project number ("#045") before any code collision (see `allocateProjectIdentity`). */
  nextId: string;
  /** Registered client codes (CLIENT_CODES). */
  clientCodes: Record<string, string>;
  /** Existing numbers, codes and analytic codes: the wizard previews the identity with `allocateProjectIdentity`. */
  numbers: string[];
  codes: string[];
  analytics: string[];
}

const templateId = (code: string) => (code === 'blank' ? 'blank' : machineType.isCode(code) ? machineType.label(code) : code);

/** Wizard reference data and numbering inputs. */
export async function getNewProjectSetup(): Promise<NewProjectSetup> {
  const db = await getDb();
  const [tpls, phases, cats, mts, numbers, clientCodes] = await Promise.all([
    db.select().from(projectTemplates).orderBy(asc(projectTemplates.sortOrder)),
    db.select().from(projectTemplatePhases).orderBy(asc(projectTemplatePhases.position)),
    db.select().from(projectTemplateCostCategories).orderBy(asc(projectTemplateCostCategories.position)),
    db.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes).orderBy(asc(machineTypes.sortOrder)),
    db.select({ code: projects.code, number: projects.number, analytic: projects.analyticCode }).from(projects),
    getClientCodes(),
  ]);
  const templates: WizardTemplate[] = tpls.map((t) => ({
    id: templateId(t.code),
    mt: t.machineTypeCode ? (machineType.isCode(t.machineTypeCode) ? machineType.label(t.machineTypeCode) : t.machineTypeCode) : null,
    name: t.name,
    desc: t.description,
    wbs: t.wbsSummary,
    acts: t.activitiesSummary,
    cal: calendar.label(t.calendar),
    phases: phases.filter((p) => p.templateCode === t.code).map((p) => p.name),
    cats: cats.filter((c) => c.templateCode === t.code).map((c) => ({ name: c.name, type: costType.label(c.costType), budget: String(c.budgetKeur) })),
  }));
  const withTemplate = new Set(templates.map((t) => t.mt).filter(Boolean));
  return {
    templates,
    machineTypes: mts.map((m) => m.label).filter((l) => withTemplate.has(l)),
    nextId: nextProjectId(numbers.map((n) => n.number)),
    clientCodes,
    numbers: numbers.map((n) => n.number).filter((n): n is string => !!n),
    codes: numbers.map((n) => n.code),
    analytics: numbers.map((n) => n.analytic).filter((a): a is string => !!a),
  };
}

export interface WizardCreateInput {
  /** '' → "Untitled project". */
  name: string;
  /** Client / sponsor ('' → none, shown "—"). */
  client: string;
  das: string;
  machineType: MachineTypeCode;
  currency: 'EUR' | 'USD';
  /** 'blank' or the template's code (machine type code, 'rnd' for R&D). */
  templateCode: string;
  categories: { name: string; type: CostType; budget: number }[];
  contingencyPct: number;
  calendar: CalendarCode;
}

export interface CreatedProject extends ProjectIdentity {
  name: string;
  /** BAC in k (Σ categories × (1 + contingency)). */
  budget: number;
}

/**
 * npCreate (3969), in one transaction: allocates the identity (next number "#045", code "<XXX>-<digits>", analytic
 * code — domain `allocateProjectIdentity`), registers an unknown client (without a 3-letter code, as the prototype
 * leaves CLIENT_CODES untouched), inserts the project at Initiative with the prototype's fixed defaults (PM
 * S. Perrin, Jan 2027 → Sep 2027, progress 0, SPI 1), flagged new and first in the register, and stores the
 * wizard's cost categories ("C01"…; actual and committed 0, forecast = budget) plus template, calendar, currency
 * and contingency. Validation and permission checks belong to the calling Server Function.
 */
export async function createWizardProject(input: WizardCreateInput): Promise<CreatedProject> {
  const db = await getDb();
  const name = input.name.trim() || 'Untitled project';
  const client = input.client.trim();
  const cats = input.categories.map((c) => ({ ...c, name: c.name.trim() || 'New category', budget: Number.isFinite(c.budget) ? c.budget : 0 }));
  const budget = wizardTotal(cats, input.contingencyPct);
  return db.transaction(async (tx) => {
    const [existing, [registered], [pm], [{ min }]] = await Promise.all([
      tx.select({ code: projects.code, number: projects.number, analytic: projects.analyticCode }).from(projects),
      client ? tx.select({ id: clients.id, code3: clients.code3 }).from(clients).where(eq(clients.name, client)) : Promise.resolve([]),
      tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, NEW_PROJECT_DEFAULTS.pm)),
      tx.select({ min: sql<number>`coalesce(min(${projects.sortOrder}), 1)::int` }).from(projects),
    ]);
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
        code: id.code, number: id.number, shortCode: id.code.slice(0, 3), name, clientId, pmPersonId: pm?.id ?? null,
        stage: 'initiative', das: input.das, machineTypeCode: input.machineType, analyticCode: id.analytic,
        startText: NEW_PROJECT_DEFAULTS.start, finishText: NEW_PROJECT_DEFAULTS.finish,
        startMonth: NEW_PROJECT_DEFAULTS.startMonth, finishMonth: NEW_PROJECT_DEFAULTS.finishMonth,
        budgetKeur: budget, actualKeur: 0, progress: 0, spi: 1, isNew: true,
        currency: input.currency, calendar: input.calendar, contingencyPct: input.contingencyPct,
        templateCode: input.templateCode, sortOrder: min - 1,
      })
      .returning({ id: projects.id });
    if (cats.length)
      await tx.insert(costCategories).values(
        cats.map((c, i) => ({
          projectId, code: 'C' + String(i + 1).padStart(2, '0'), name: c.name, costType: c.type,
          budgetKeur: c.budget, actualKeur: 0, committedKeur: 0, forecastKeur: c.budget, position: i + 1,
        })),
      );
    return { ...id, name, budget };
  });
}

/** Number of projects (tests and sanity checks). */
export async function countProjects(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  return n;
}
