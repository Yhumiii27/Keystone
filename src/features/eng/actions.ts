'use server';
// Server Functions of the Engineering synthesis and the four discipline screens (docs/spec/09 §8.5–8.9). Each one
// validates its raw input, checks that the viewer may edit the screen for this project (not outside the workspace —
// director, PM, engineering lead, quality — and not a read-only project), re-reads the register to refuse a stale
// action (the row changed since the page was rendered), writes through the data-layer writers of
// src/server/dal/engineering.ts with the viewer as the actor, then revalidates (screens, sidebar badges, the Codex
// Documents screen that shares the deliverable statuses). "Validate release (PM)" is the project's PM or the director
// (09 OQ11, the prototype had no role check). Messages come back translated.
import { revalidatePath } from 'next/cache';
import {
  DELIVERABLE_STEP, SCREEN_OF_DISCIPLINE, canValidateRelease, isCheckClose, isDeliverableStep, isDiscipline, type CheckClose, type DeliverableStep, type Discipline,
  type EngScreen,
} from '@/domain/engineering';
import {
  closeEngCheck, confirmEngInput, freezeEngDeliverable, generateEngOutput, getEngineeringRegister, importEngList, proposeEngRelease, validateEngRelease,
  type EngineeringRegister,
} from '@/server/dal/engineering';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n, type Viewer } from '@/server/session';
import { ENG_MSG } from './i18n';

export type EngActionResult = { ok: true } | { ok: false; error: string };

const DOC_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+){1,4}$/;
const CHECK_RE = /^C-\d{2,4}$/;
const OUTPUT_RE = /^O-\d{2,4}$/;

/** Every screen the register touches: the five engineering pages and badges, Documents (shared statuses), Home. */
const refresh = () => revalidatePath('/', 'layout');

async function fail(english: string): Promise<{ ok: false; error: string }> {
  const { t } = await getI18n();
  return { ok: false, error: t(english) };
}

/** Known refusals of the data layer, shown as they are; anything else is a generic failure. */
async function failed(where: string, e: unknown): Promise<{ ok: false; error: string }> {
  const msg = e instanceof Error ? e.message : '';
  if (msg === ENG_MSG.pmOnly) return fail(ENG_MSG.pmOnly);
  if (msg.startsWith('Release blocked')) return fail(ENG_MSG.blocked);
  console.error(where, e);
  return fail(ENG_MSG.failed);
}

type Access = { code: string; viewer: Viewer; isLead: boolean };

/** The project and the viewer's right to edit `screen` on it. */
async function access(code: unknown, screen: EngScreen): Promise<Access | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: ENG_MSG.invalid };
  const project = await getProject(code);
  if (!project) return { error: ENG_MSG.invalid };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen)) return { error: ENG_MSG.readOnly };
  return { code: project.code, viewer: ctx.viewer, isLead: ctx.isLead };
}

const actorOf = (v: Viewer) => ({ name: v.name, role: v.role });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

type DisciplineAccess = Access & { disc: Discipline; reg: EngineeringRegister };

/** Access to the discipline screen `disc` and its register. */
async function disciplineAccess(input: { code?: unknown; disc?: unknown }): Promise<DisciplineAccess | { error: string }> {
  if (!isDiscipline(input?.disc)) return { error: ENG_MSG.invalid };
  const disc: Discipline = input.disc;
  const a = await access(input.code, SCREEN_OF_DISCIPLINE[disc]);
  if ('error' in a) return a;
  const reg = await getEngineeringRegister(a.code);
  if (!reg) return { error: ENG_MSG.noRegister };
  return { ...a, disc, reg };
}

/** "Confirm" an input of the discipline (not outdated, not yet confirmed). */
export async function confirmInputAction(input: { code: string; disc: string; doc: string }): Promise<EngActionResult> {
  const doc = str(input?.doc);
  if (!DOC_RE.test(doc)) return fail(ENG_MSG.invalid);
  const a = await disciplineAccess(input);
  if ('error' in a) return fail(a.error);
  const row = a.reg.inputs.find((i) => i.consumer === a.disc && i.documentNumber === doc);
  if (!row || row.outdated || row.acknowledged) {
    refresh();
    return fail(ENG_MSG.stale);
  }
  try {
    await confirmEngInput(a.code, a.disc, doc, actorOf(a.viewer));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed('confirmInputAction', e);
  }
}

/** "Resolve here" / "Send back to tool" on an open check listed on the discipline screen. */
export async function closeCheckAction(input: { code: string; disc: string; number: string; how: string }): Promise<EngActionResult> {
  const number = str(input?.number);
  if (!CHECK_RE.test(number) || !isCheckClose(input?.how)) return fail(ENG_MSG.invalid);
  const how: CheckClose = input.how;
  const a = await disciplineAccess(input);
  if ('error' in a) return fail(a.error);
  const c = a.reg.checks.find((x) => x.number === number && (x.owner === a.disc || x.rulePair.split('-').includes(a.disc)));
  if (!c || !c.open) {
    refresh();
    return fail(ENG_MSG.stale);
  }
  try {
    await closeEngCheck(a.code, number, how, actorOf(a.viewer));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed('closeCheckAction', e);
  }
}

/** "Freeze", "Propose release" or "Validate release (PM)" on an own deliverable of the discipline. */
export async function deliverableStepAction(input: { code: string; disc: string; number: string; step: string }): Promise<EngActionResult> {
  const number = str(input?.number);
  if (!DOC_RE.test(number) || !isDeliverableStep(input?.step)) return fail(ENG_MSG.invalid);
  const step: DeliverableStep = input.step;
  const a = await disciplineAccess(input);
  if ('error' in a) return fail(a.error);
  if (step === 'validate' && !canValidateRelease(a.viewer, a.isLead)) return fail(ENG_MSG.pmOnly);
  const d = a.reg.deliverables.find((x) => x.number === number && x.discipline === a.disc);
  if (!d || d.status !== DELIVERABLE_STEP[step].from) {
    refresh();
    return fail(ENG_MSG.stale);
  }
  if (step === 'propose' && d.blockingChecks) return fail(ENG_MSG.blocked);
  try {
    const actor = actorOf(a.viewer);
    if (step === 'freeze') await freezeEngDeliverable(a.code, number, actor);
    else if (step === 'propose') await proposeEngRelease(a.code, number, actor);
    else await validateEngRelease(a.code, number, actor);
    refresh();
    return { ok: true };
  } catch (e) {
    return failed('deliverableStepAction', e);
  }
}

/** "Generate xlsx" on an output of the discipline that is not Blocked (simulated generation, stamped). */
export async function generateOutputAction(input: { code: string; disc: string; number: string }): Promise<EngActionResult> {
  const number = str(input?.number);
  if (!OUTPUT_RE.test(number)) return fail(ENG_MSG.invalid);
  const a = await disciplineAccess(input);
  if ('error' in a) return fail(a.error);
  const o = a.reg.outputs.find((x) => x.number === number && x.discipline === a.disc);
  if (!o || o.state === 'blocked') {
    refresh();
    return fail(ENG_MSG.stale);
  }
  try {
    await generateEngOutput(a.code, number, actorOf(a.viewer));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed('generateOutputAction', e);
  }
}

/**
 * Import wizard "Import · freeze this revision as input" (from the Synthesis, `from: 'eng'`, or a discipline screen):
 * the discipline's input becomes the document's current revision, to confirm; the instrument list also refreshes the
 * P&ID input; the discipline's unresolved revision-alignment checks (sent back included) close ("Closed by import of rev D").
 */
export async function importListAction(input: { code: string; from: string; disc: string; doc: string; tool: number }): Promise<EngActionResult> {
  const doc = str(input?.doc);
  const tool = input?.tool;
  const from = input?.from === 'eng' ? 'eng' : isDiscipline(input?.from) ? SCREEN_OF_DISCIPLINE[input.from] : null;
  if (!from || !isDiscipline(input?.disc) || !DOC_RE.test(doc) || typeof tool !== 'number' || !Number.isInteger(tool)) return fail(ENG_MSG.invalid);
  const disc: Discipline = input.disc;
  const a = await access(input.code, from);
  if ('error' in a) return fail(a.error);
  const reg = await getEngineeringRegister(a.code);
  if (!reg) return fail(ENG_MSG.noRegister);
  // A deliverable of another discipline (a discipline does not import its own documents as inputs) and a listed tool.
  if (!reg.deliverables.some((d) => d.number === doc && d.discipline !== disc) || !reg.tools.some((t) => t.position === tool)) return fail(ENG_MSG.invalid);
  try {
    await importEngList(a.code, { consumer: disc, documentNumber: doc, toolPosition: tool }, actorOf(a.viewer));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed('importListAction', e);
  }
}
