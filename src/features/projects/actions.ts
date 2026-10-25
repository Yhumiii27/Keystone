'use server';
// Server Functions of the Projects register (docs/spec/03 §5.4–§5.8, 01 §10–§11): stage moves (auto / forced),
// stage-deliverable ticks with auto-advance, and the New project wizard. Each validates its input, checks the
// viewer's permission, writes through the DAL and revalidates every screen (stages show up on Home, Overview,
// My projects, the shell…). Messages are English source strings (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import { RESERVED_CLIENT_CODE } from '@/domain/subsidiaries';
import { effectiveDateError, isTransitionAllowed, moveError } from '@/domain/lifecycle';
import { stage as stageCodec, type StageCode } from '@/server/db/codes';
import { BL1_DELIVERABLE_MESSAGE, bl1TickRefused } from '@/domain/baseline-policy';
import { StageChangeError, getStageChangeBounds, listStages, projectHasBl1 } from '@/server/dal/lifecycle';
import {
  createWizardProject, getNewProjectSetup, getProjectStage, missingDeliverables, moveProjectStage, setDeliverableAndAdvance,
} from '@/server/dal/projects-register';
import { inactiveStageCodes } from '@/server/dal/settings-lists';
import { getProject } from '@/server/dal/projects';
import { getScreenAccess, projectAccessResolver } from '@/server/project-context';
import { getViewer } from '@/server/session';
import { CREATE_PROJECT_ROLES } from './permissions';
import { parseProjectDraft, type NewProjectDraft } from './draft';
import { logError } from '@/server/log';

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
 * Lifecycle writes (L-4b, R-041): the director, or the project's PMs — PM of record, co-PMs and deputies — with the Projects
 * register in their workspace (another PM's project is read-only, 01 §5.2).
 */
async function mayManageLifecycle(code: string): Promise<boolean> {
  const { canEdit, viewer } = await getScreenAccess('projects');
  if (!canEdit) return false;
  const project = await getProject(code);
  return !!project && (await projectAccessResolver(viewer))(project).lead;
}

/**
 * Moves a project to the next stage or to Annulé (advance 3922). `auto` is refused when deliverables are missing
 * or the target is Annulé; `forced` needs a reason and is recorded with the missing deliverables, pending the
 * portfolio director's validation. `effectiveOn` (L-4c = a, R-055): the real date of the change entered by the PM
 * (ISO; absent = today, the project's data date), refused before the previous change or after today; the time of entry
 * stays in the audit trail.
 */
export async function moveStageAction(input: { code: string; to: string; mode: 'auto' | 'forced'; reason?: string; effectiveOn?: string }): Promise<ActionResult> {
  const { viewer } = await getScreenAccess('projects');
  const code = str(input?.code, 40);
  if (!(await mayManageLifecycle(code))) return { ok: false, error: NOT_ALLOWED };
  const to = input?.to;
  const mode = input?.mode === 'forced' ? 'forced' : 'auto';
  const reason = str(input?.reason, 500);
  const rawDate: unknown = input?.effectiveOn;
  if (!isStage(to)) return { ok: false, error: 'This stage change is not allowed' };
  if (rawDate !== undefined && rawDate !== null && rawDate !== '' && typeof rawDate !== 'string') return { ok: false, error: 'Enter a valid effective date' };
  const effectiveOn = typeof rawDate === 'string' && rawDate !== '' ? rawDate : undefined;
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
    if (effectiveOn !== undefined) {
      const bounds = await getStageChangeBounds(code);
      const dateErr = bounds ? effectiveDateError(effectiveOn, bounds) : UNKNOWN;
      if (dateErr) return { ok: false, error: dateErr };
    }
    await moveProjectStage(code, to, mode, {
      reason: mode === 'forced' ? reason : undefined,
      missing: mode === 'forced' ? missing : undefined,
      requestedBy: viewer.short,
      effectiveOn,
      from,
    });
  } catch (e) {
    if (e instanceof StageChangeError) {
      refresh();
      return { ok: false, error: e.message };
    }
    logError('moveStageAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/** Ticks / unticks a deliverable of the project's current stage (toggleDeliv 3923); may auto-advance the project. */
export async function setDeliverableAction(input: { code: string; stage: string; index: number; done: boolean }): Promise<ActionResult> {
  const code = str(input?.code, 40);
  if (!(await mayManageLifecycle(code))) return { ok: false, error: NOT_ALLOWED };
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
    // R-054 (L-2 "a"): « Planning BL1 posé » follows BL1 — no manual tick without it, no untick while it exists (forcing stays).
    if (bl1TickRefused({ stage: input.stage, position: input.index, done: input.done }, (await projectHasBl1(code)).bl1)) {
      refresh();
      return { ok: false, error: BL1_DELIVERABLE_MESSAGE };
    }
    await setDeliverableAndAdvance(code, input.stage, input.index, input.done, (await getViewer()).short);
  } catch (e) {
    if (e instanceof Error && e.message === BL1_DELIVERABLE_MESSAGE) return { ok: false, error: BL1_DELIVERABLE_MESSAGE };
    logError('setDeliverableAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

export type { NewProjectDraft } from './draft';

export type CreateProjectResult =
  | { ok: true; code: string; number: string; analytic: string; name: string }
  | { ok: false; error: string };

/**
 * npCreate (3969): creates the project at Initiative with the next number, its analytic code and cost categories, and
 * instantiates the machine-type template (chapter 4, A-2 / L-3): required name, client, PM (among the wizard's project
 * managers), type, planned start and location (L-3b: site city + a country of the countries table; zone from the country);
 * the planned finish is optional and comes from the instantiated plan when absent; calendar and currency stored.
 */
export async function createProjectAction(draft: NewProjectDraft): Promise<CreateProjectResult> {
  const viewer = await getViewer();
  if (!CREATE_PROJECT_ROLES.includes(viewer.role)) return { ok: false, error: 'You are not allowed to create projects' };
  const setup = await getNewProjectSetup({ name: viewer.name, role: viewer.role });
  const parsed = parseProjectDraft(draft, setup);
  if (!parsed.ok) return parsed;
  try {
    const created = await createWizardProject({ ...parsed.input, actorName: viewer.name });
    refresh();
    return { ok: true, code: created.code, number: created.number, analytic: created.analytic, name: created.name };
  } catch (e) {
    // Matrix D21: the client's proposed code is a group subsidiary's (an EN source string the wizard translates).
    if (e instanceof Error && e.message === RESERVED_CLIENT_CODE) return { ok: false, error: RESERVED_CLIENT_CODE };
    logError('createProjectAction', e);
    return { ok: false, error: 'The project could not be created' };
  }
}
