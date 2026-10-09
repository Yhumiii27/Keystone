'use server';
// Server Functions of the Projects register (docs/spec/03 §5.4–§5.8, 01 §10–§11): stage moves (auto / forced),
// stage-deliverable ticks with auto-advance, and the New project wizard. Each validates its input, checks the
// viewer's permission, writes through the DAL and revalidates every screen (stages show up on Home, Overview,
// My projects, the shell…). Messages are English source strings (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import {
  CATEGORY_TYPES, CONTINGENCIES, DAS_LIST, WIZARD_CURRENCIES, isTransitionAllowed, moveError,
} from '@/domain/lifecycle';
import { WIZARD_CALENDAR_OPTIONS, WIZARD_REQUIRED, plannedWindowError } from '@/domain/project-template';
import { costType, machineType, stage as stageCodec, type MachineTypeCode, type StageCode } from '@/server/db/codes';
import { listStages } from '@/server/dal/lifecycle';
import {
  createWizardProject, getNewProjectSetup, getProjectStage, missingDeliverables, moveProjectStage, setDeliverableAndAdvance,
} from '@/server/dal/projects-register';
import { inactiveStageCodes } from '@/server/dal/settings-lists';
import { getScreenAccess } from '@/server/project-context';
import { getViewer } from '@/server/session';
import { CREATE_PROJECT_ROLES } from './permissions';

export type ActionResult = { ok: true } | { ok: false; error: string };

const NOT_ALLOWED = 'Read-only — you cannot change the project lifecycle';
const UNKNOWN = 'Unknown project';
const FAILED = 'The change could not be saved';
const MAX_TEXT = 200;

const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isStage = (v: unknown): v is StageCode => stageCodec.isCode(v);

function refresh() {
  revalidatePath('/', 'layout');
}

/**
 * Moves a project to the next stage or to Annulé (advance 3922). `auto` is refused when deliverables are missing
 * or the target is Annulé; `forced` needs a reason and is recorded with the missing deliverables, pending the
 * portfolio director's validation.
 */
export async function moveStageAction(input: { code: string; to: string; mode: 'auto' | 'forced'; reason?: string }): Promise<ActionResult> {
  const { canEdit, viewer } = await getScreenAccess('projects');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const code = str(input?.code, 40);
  const to = input?.to;
  const mode = input?.mode === 'forced' ? 'forced' : 'auto';
  const reason = str(input?.reason, 500);
  if (!isStage(to)) return { ok: false, error: 'This stage change is not allowed' };
  try {
    const from = await getProjectStage(code);
    if (!from) return { ok: false, error: UNKNOWN };
    // A-14: stages deactivated in Settings › Project statuses are skipped by the "next stage" rule.
    const skip = new Set<string>(await inactiveStageCodes());
    const missing = to === 'annule' || !isTransitionAllowed(from, to, skip) ? [] : await missingDeliverables(code, from);
    const err = moveError(from, to, mode, missing, reason, skip);
    if (err) {
      refresh(); // the client may be showing a stale stage
      return { ok: false, error: err };
    }
    await moveProjectStage(code, to, mode, {
      reason: mode === 'forced' ? reason : undefined,
      missing: mode === 'forced' ? missing : undefined,
      requestedBy: viewer.short,
    });
  } catch (e) {
    console.error('moveStageAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/** Ticks / unticks a deliverable of the project's current stage (toggleDeliv 3923); may auto-advance the project. */
export async function setDeliverableAction(input: { code: string; stage: string; index: number; done: boolean }): Promise<ActionResult> {
  const { canEdit } = await getScreenAccess('projects');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const code = str(input?.code, 40);
  if (!isStage(input?.stage) || !Number.isInteger(input?.index) || typeof input?.done !== 'boolean')
    return { ok: false, error: 'Invalid deliverable' };
  try {
    const current = await getProjectStage(code);
    if (!current) return { ok: false, error: UNKNOWN };
    const def = (await listStages()).find((s) => s.code === input.stage);
    if (!def || input.index < 0 || input.index >= def.deliverables.length) return { ok: false, error: 'Invalid deliverable' };
    if (current !== input.stage) {
      refresh();
      return { ok: false, error: 'The project has already moved to another stage' };
    }
    await setDeliverableAndAdvance(code, input.stage, input.index, input.done);
  } catch (e) {
    console.error('setDeliverableAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/** Draft of the New project wizard (`state.np` without UI fields). Labels are the wizard's EN / data values. */
export interface NewProjectDraft {
  name: string;
  client: string;
  das: string;
  /** Machine type label: EMP, MEMU, SPUR, AUTRE, R&D, or a custom type's code. */
  mt: string;
  cur: string;
  /** 'blank' or the machine type label of the template. */
  template: string;
  /** Type = EN label (Labor…); budget = the free text typed (parseFloat, as npTotal). */
  cats: { name: string; type: string; budget: string }[];
  cont: number;
  /** Calendar code (WIZARD_CALENDAR_OPTIONS) or its EN label. */
  cal: string;
  /** Project manager, person id (L-3). */
  pm?: string | null;
  /** Planned window, ISO dates (L-3). */
  start?: string;
  finish?: string;
}

export type CreateProjectResult =
  | { ok: true; code: string; number: string; analytic: string; name: string }
  | { ok: false; error: string };

const INVALID_SETUP = 'Invalid project setup';

/**
 * npCreate (3969): creates the project at Initiative with the next number, its analytic code and cost categories, and
 * instantiates the machine-type template (chapter 4, A-2 / L-3): name and client required, PM among the wizard's
 * project managers, a valid planned window, calendar and currency stored.
 */
export async function createProjectAction(draft: NewProjectDraft): Promise<CreateProjectResult> {
  const viewer = await getViewer();
  if (!CREATE_PROJECT_ROLES.includes(viewer.role)) return { ok: false, error: 'You are not allowed to create projects' };
  if (WIZARD_REQUIRED.name && !str(draft?.name)) return { ok: false, error: 'Project name is required' };
  if (WIZARD_REQUIRED.client && !str(draft?.client)) return { ok: false, error: 'Client / sponsor is required' };
  const windowError = plannedWindowError(draft?.start, draft?.finish);
  if (windowError) return { ok: false, error: windowError };
  const setup = await getNewProjectSetup({ name: viewer.name, role: viewer.role });
  const das = (DAS_LIST as readonly string[]).includes(draft?.das) ? draft.das : null;
  const mt = typeof draft?.mt === 'string' && setup.machineTypes.includes(draft.mt) ? draft.mt : null;
  const cur = (WIZARD_CURRENCIES as readonly string[]).includes(draft?.cur) ? (draft.cur as 'EUR' | 'USD') : null;
  const cont = (CONTINGENCIES as readonly number[]).includes(draft?.cont) ? draft.cont : null;
  const cal = WIZARD_CALENDAR_OPTIONS.find((o) => o.value === draft?.cal || o.label === draft?.cal)?.value ?? null;
  const template = draft?.template === 'blank' || draft?.template === mt ? draft.template : null;
  const cats = Array.isArray(draft?.cats) && draft.cats.length <= 50 ? draft.cats : null;
  const pm = draft?.pm == null ? setup.defaultManagerId : setup.managers.some((m) => m.id === draft.pm) ? draft.pm : undefined;
  if (pm === undefined) return { ok: false, error: 'Choose the project manager among the proposed people' };
  if (!das || !mt || !cur || cont == null || !cal || !template || !cats) return { ok: false, error: INVALID_SETUP };
  const mtCode = (machineType.labels.includes(mt) ? machineType.code(mt) : mt) as MachineTypeCode;
  const categories = [];
  for (const c of cats) {
    if (!(CATEGORY_TYPES as readonly string[]).includes(c?.type)) return { ok: false, error: INVALID_SETUP };
    const budget = parseFloat(String(c?.budget ?? '')) || 0;
    if (!Number.isFinite(budget) || Math.abs(budget) > 1e9) return { ok: false, error: INVALID_SETUP };
    categories.push({ name: str(c?.name), type: costType.code(c.type), budget });
  }
  try {
    const created = await createWizardProject({
      name: str(draft?.name),
      client: str(draft?.client),
      das,
      machineType: mtCode,
      currency: cur,
      templateCode: template === 'blank' ? 'blank' : mtCode,
      categories,
      contingencyPct: cont,
      calendar: cal,
      pmPersonId: pm,
      plannedStart: draft.start,
      plannedFinish: draft.finish,
      actorName: viewer.name,
    });
    refresh();
    return { ok: true, code: created.code, number: created.number, analytic: created.analytic, name: created.name };
  } catch (e) {
    console.error('createProjectAction', e);
    return { ok: false, error: 'The project could not be created' };
  }
}
