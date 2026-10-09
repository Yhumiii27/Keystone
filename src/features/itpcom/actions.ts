'use server';
// ITP · punch list and Commissioning Server Functions (docs/spec/07 §2.4 / §2.6 / §3: AF `itp` "Add inspection",
// AF `punch` "Add punch item", the punch row step Start / Close, AF `commissioning` "Plan SAT"). Each one validates the
// raw input with the domain parsers, checks the viewer may edit the screen for this project (not outside the
// workspace, not a read-only project), writes through the data-layer writers with the viewer as the actor (the writers
// re-check the workspace), then revalidates the project's pages (registers, KPIs, the ITP sidebar badge, Commissioning's
// "Blocking A").
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseNewInspection, parseNewPunch, parsePlanSat, punchStep } from '@/domain/itpcom';
import { shortName } from '@/lib/format';
import { NOW_ISO, punchStatus } from '@/server/db/codes';
import { listSatSystems, planSat } from '@/server/dal/commissioning';
import { addItpInspection, addPunchItem, advancePunchItem, listItpSystems, listPunchItems } from '@/server/dal/itp';
import type { Actor } from '@/server/dal/ops-common';
import { getProject } from '@/server/dal/projects';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { INSPECTION_RESULT, PUNCH_RESULT, SAT_RESULT } from './forms';

export type PunchStepResult = { ok: true } | { error: string };

type Screen = 'itp' | 'commissioning';

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** Message in the viewer's language: the whole sentence when the dictionary has it, else per " · " segment. */
async function tr(english: string) {
  const { t } = await getI18n();
  const whole = t(english);
  return whole !== english ? whole : english.split(' · ').map(t).join(' · ');
}

const READ_ONLY: Record<Screen, string> = {
  itp: 'This inspection plan is read-only for you',
  commissioning: 'This commissioning plan is read-only for you',
};

/** Resolves the project and checks the viewer may edit `screen` on it; returns the canonical code and the actor. */
async function editable(code: unknown, screen: Screen): Promise<{ code: string; actor: Actor } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen)) return { error: await tr(READ_ONLY[screen]) };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

/** "Add inspection" (AF `itp`, "Add to plan"): I-20… per project, Planned; toast "Inspection added to the plan". */
export async function addInspectionAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'itp');
  if ('error' in ok) return ok;
  const parsed = parseNewInspection(strings(values), await listItpSystems(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    await addItpInspection(ok.code, { name: v.name, system: v.system, pointType: v.pointType, stage: v.stage, reference: v.reference, plannedOn: v.plannedOn }, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: await tr(INSPECTION_RESULT) };
}

/** "Add punch item" (AF `punch`, "Add item"): P-10… per project, Open; owner stored as the short name; toast "Punch item added". */
export async function addPunchItemAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'itp');
  if ('error' in ok) return ok;
  const parsed = parseNewPunch(strings(values), await teamOwnerOptions(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    await addPunchItem(ok.code, { description: v.description, location: v.location, category: v.category, source: v.source, owner: shortName(v.owner), dueOn: v.dueOn }, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: await tr(PUNCH_RESULT) };
}

const MOVED_ON = 'This punch item has already moved on';
const CLOSED = 'This punch item is already closed';

/** Refusal because the item moved on since the page was rendered (another viewer acted): refresh the stale row too. */
async function stale(code: string, english: string): Promise<PunchStepResult> {
  refresh(code);
  return { error: await tr(english) };
}

/**
 * Punch row step: "Start" (Open → In progress) or "Close" (In progress → Closed, closed on the business date). `from` is
 * the status the viewer saw: an item someone else moved on meanwhile is refused instead of taking a second step.
 */
export async function advancePunchItemAction(code: string, number: string, from: string): Promise<PunchStepResult> {
  const ok = await editable(code, 'itp');
  if ('error' in ok) return ok;
  if (typeof number !== 'string' || !number || !punchStatus.isCode(from)) return { error: await tr('Invalid request') };
  const row = (await listPunchItems(ok.code, 'itp')).find((r) => r.number === number);
  if (!row) return { error: await tr('Unknown punch item') };
  if (!punchStep(row.status)) return stale(ok.code, CLOSED);
  if (row.status !== from) return stale(ok.code, MOVED_ON);
  try {
    await advancePunchItem(ok.code, row.number, ok.actor, NOW_ISO, from);
  } catch (e) {
    if (e instanceof Error && / has moved on$/.test(e.message)) return stale(ok.code, MOVED_ON);
    if (e instanceof Error && / is closed$/.test(e.message)) return stale(ok.code, CLOSED);
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { ok: true };
}

/**
 * "Plan SAT" (AF `commissioning`, "Plan & invite"): records the plan and dates the system's SAT step. Systems: the
 * commissioning plan's, else the inspection template's (the prototype's `ITPSYS`; the plan is recorded, no grid created).
 */
export async function planSatAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'commissioning');
  if ('error' in ok) return ok;
  const systems = await listSatSystems(ok.code);
  const parsed = parsePlanSat(strings(values), systems);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    await planSat(ok.code, { system: v.system, date: v.date, clientWitnesses: v.clientWitnesses, prerequisites: v.prerequisites }, ok.actor);
  } catch (e) {
    if (e instanceof Error && / is already done$/.test(e.message)) return { error: await tr('The SAT of this system is already done') };
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: await tr(SAT_RESULT) };
}
