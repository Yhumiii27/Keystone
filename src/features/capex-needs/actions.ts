'use server';
// R-187 (Arche K-02, K-03, K-10): Server Functions of the "Subsidiaries' machine needs" card (Portfolio › Projects). Each one checks
// the viewer (reading: the director and the project managers with the Projects register in their workspace; writing: the
// portfolio director), validates the untrusted input with the domain parsers, writes through the DAL (which checks the role and
// parses again, then writes the audit row and the activity event in its transaction) and revalidates the app. Errors come back in
// the viewer's language.
import { revalidatePath } from 'next/cache';
import { ANSWER_STATUSES, CAPEX_NEEDS_DIRECTOR_ONLY, canAnswerCapexNeeds, canReadCapexNeeds, type AnswerStatus } from '@/domain/capex-needs';
import { addNeedToProject, createNeedAnswer, createProjectFromNeed, setNeedAnswerStatus, updateNeedAnswer } from '@/server/dal/capex-needs';
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { capexRefreshSummary, refreshCapexMirror } from '@/server/integrations/capex/connector';
import { logError } from '@/server/log';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { parseProjectDraft, type NewProjectDraft } from '@/features/projects/draft';

export type NeedActionResult = { ok: true; message?: string; code?: string } | { error: string };

const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** Form values as sent by the client, keeping string entries only. */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};

/** The viewer when they may answer: the director, with Portfolio › Projects in their workspace. */
async function director(): Promise<{ actor: { name: string; role: string } } | { error: string }> {
  const { viewer, canEdit } = await getScreenAccess('projects');
  if (!canEdit || !canAnswerCapexNeeds(viewer.role)) return { error: await tr(CAPEX_NEEDS_DIRECTOR_ONLY) };
  return { actor: { name: viewer.name, role: viewer.role } };
}

const refRe = /^CPX-[A-Z]{3}-\d{4}-\d{2,}\/B\d{2,}$/;
const numberRe = /^RB-\d{3,}$/;

/** "Refresh": reads Arche's views again (the director and the project managers who see the card). */
export async function refreshCapexNeedsAction(): Promise<NeedActionResult> {
  const { viewer, canEdit } = await getScreenAccess('projects');
  if (!canEdit || !canReadCapexNeeds(viewer.role)) return { error: await tr('Only the director and the project managers read the subsidiaries’ machine needs') };
  const r = await refreshCapexMirror('refresh');
  refresh();
  if (r.state === 'done') return { ok: true, message: await tr(r.source === 'simulation' ? 'Machine needs refreshed (simulated)' : 'Machine needs refreshed') };
  if (r.state === 'failed') return { error: `${await tr('Arche’s machine needs could not be read')} — ${r.error}` };
  return { error: await tr(capexRefreshSummary(r)) };
}

/** Records a new answer to a need (status "in preparation"). */
export async function recordNeedAnswerAction(needRef: string, values: unknown): Promise<NeedActionResult> {
  if (typeof needRef !== 'string' || !refRe.test(needRef)) return { error: await tr('Invalid request') };
  const ok = await director();
  if ('error' in ok) return ok;
  try {
    const number = await createNeedAnswer(needRef, strings(values), ok.actor);
    refresh();
    return { ok: true, code: number };
  } catch (e) {
    return { error: await tr(e instanceof Error ? e.message : 'The change could not be saved') };
  }
}

/** Edits an answer in preparation. */
export async function editNeedAnswerAction(number: string, values: unknown): Promise<NeedActionResult> {
  if (typeof number !== 'string' || !numberRe.test(number)) return { error: await tr('Invalid request') };
  const ok = await director();
  if ('error' in ok) return ok;
  try {
    await updateNeedAnswer(number, strings(values), ok.actor);
  } catch (e) {
    return { error: await tr(e instanceof Error ? e.message : 'The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** Sends, accepts or lapses an answer. */
export async function setNeedAnswerStatusAction(number: string, to: string): Promise<NeedActionResult> {
  if (typeof number !== 'string' || !numberRe.test(number) || !(ANSWER_STATUSES as readonly string[]).includes(to)) return { error: await tr('Invalid request') };
  const ok = await director();
  if ('error' in ok) return ok;
  try {
    await setNeedAnswerStatus(number, to as AnswerStatus, ok.actor);
  } catch (e) {
    return { error: await tr(e instanceof Error ? e.message : 'The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/**
 * K-10 (a): creates the EPC2i project from an ordered need with the New project wizard's draft (checked as the wizard's own
 * creation is). The first equipment line is the need's (its type, quantity, options, capacity, catalogue version, need reference);
 * the draft's other lines are kept. Returns the project code.
 */
export async function createProjectFromNeedAction(needRef: string, draft: NewProjectDraft): Promise<NeedActionResult> {
  if (typeof needRef !== 'string' || !refRe.test(needRef) || !draft || typeof draft !== 'object') return { error: await tr('Invalid request') };
  const ok = await director();
  if ('error' in ok) return ok;
  const setup = await getNewProjectSetup(ok.actor);
  // The need's line carries its own catalogue version (possibly retired since): the wizard's choice on the first line is ignored.
  const lines = Array.isArray(draft.lines) && draft.lines.length ? draft.lines.map((l, i) => (i === 0 ? { ...l, cat: '' } : l)) : draft.lines;
  const parsed = parseProjectDraft({ ...draft, lines }, setup);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const { equipments, machineType: mt, ...rest } = parsed.input;
  try {
    const created = await createProjectFromNeed(needRef, {
      ...rest,
      otherLines: equipments?.slice(1),
      typeIfFree: mt,
    }, ok.actor);
    refresh();
    return { ok: true, code: created.code, message: created.name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (!/^(The |This |Record |Choose |Unknown |Only )/.test(msg)) logError('createProjectFromNeedAction', e);
    return { error: await tr(msg && /^(The |This |Record |Choose |Unknown |Only )/.test(msg) ? msg : 'The project could not be created') };
  }
}

/** K-10 (b): adds the ordered need's equipment line to an existing project. Returns the line reference. */
export async function addNeedToProjectAction(needRef: string, values: unknown): Promise<NeedActionResult> {
  const v = strings(values);
  if (typeof needRef !== 'string' || !refRe.test(needRef) || !v.project) return { error: await tr('Invalid request') };
  const ok = await director();
  if ('error' in ok) return ok;
  try {
    const ref = await addNeedToProject(needRef, v.project, v.machineTypeCode || null, ok.actor);
    refresh();
    return { ok: true, code: ref };
  } catch (e) {
    return { error: await tr(e instanceof Error ? e.message : 'The change could not be saved') };
  }
}
