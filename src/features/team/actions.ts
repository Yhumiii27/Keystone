'use server';
// Team & exchanges Server Functions (docs/spec/05 §6.5 AF `stakeholders`; 07 §2.5 / §3 AF `interfaces`, row actions
// "Mark received" / "Freeze"). Each one validates the raw input with the domain parsers, checks the viewer may edit
// the screen for this project (not outside the workspace, not a read-only project), writes through the data-layer
// writers with the viewer as the actor, then revalidates the project's pages (register, KPIs, sidebar badge).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { interfaceRowState, parseNewInterface, parseNewStakeholder, parseReceivedOn } from '@/domain/team';
import { businessToday } from '@/server/clock';
import { createInterface, freezeInterface, listInterfaces, markInterfaceReceived } from '@/server/dal/interfaces';
import { getProject } from '@/server/dal/projects';
import { addStakeholder } from '@/server/dal/stakeholders';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { INTERFACE_RESULT, STAKEHOLDER_RESULT } from './forms';

export type InterfaceActionResult = { ok: true } | { error: string };

type Screen = 'stakeholders' | 'interfaces';

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** Toast / error text translated per " · " segment, like the prototype's showToast. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** Resolves the project and checks the viewer may edit `screen` on it; returns the canonical code or an error. */
async function editable(code: unknown, screen: Screen): Promise<{ code: string; actor: string } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen))
    return { error: await tr(screen === 'stakeholders' ? 'This stakeholder register is read-only for you' : 'This interface register is read-only for you') };
  return { code: project.code, actor: ctx.viewer.name };
}

/** "Add stakeholder" (AF `stakeholders`, "Add"): appended with last contact the business date (R-013; the prototype's 30 Sep) and notes "New"; toast "Stakeholder added". */
export async function addStakeholderAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'stakeholders');
  if ('error' in ok) return ok;
  const parsed = parseNewStakeholder(strings(values), await teamOwnerOptions(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    await addStakeholder(ok.code, { name: v.name, organisation: v.organisation, role: v.role, type: v.type, contactEmail: v.contactEmail, owner: v.owner }, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: await tr(STAKEHOLDER_RESULT) };
}

/** "New interface" (AF `interfaces`, "Register"): IF-10… per project, Open; toast "Interface registered". */
export async function createInterfaceAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'interfaces');
  if ('error' in ok) return ok;
  const parsed = parseNewInterface(strings(values), await teamOwnerOptions(ok.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await createInterface(ok.code, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: await tr(INTERFACE_RESULT) };
}

/**
 * Row actions: "Mark received" (Open or Late → Received, with the received date — Q-4 a, R-116) and "Freeze" (Received →
 * Frozen, the provided date kept).
 */
async function transition(code: string, number: string, to: 'received' | 'frozen', values?: unknown): Promise<InterfaceActionResult> {
  const ok = await editable(code, 'interfaces');
  if ('error' in ok) return ok;
  if (typeof number !== 'string' || !number) return { error: await tr('Invalid request') };
  const row = (await listInterfaces(ok.code)).find((r) => r.number === number);
  if (!row) return { error: await tr('Unknown interface') };
  const state = interfaceRowState(row);
  if (to === 'received' ? !state.canReceive : !state.canFreeze)
    return { error: await tr(to === 'received' ? 'This interface is no longer open' : 'Only a received interface can be frozen') };
  let receivedOn: string | undefined;
  if (to === 'received') {
    const parsed = parseReceivedOn(strings(values).received, await businessToday()); // R-013: never after the business date
    if (!parsed.ok) return { error: await tr(parsed.error) };
    receivedOn = parsed.value;
  }
  try {
    if (to === 'received') await markInterfaceReceived(ok.code, row.number, ok.actor, receivedOn);
    else await freezeInterface(ok.code, row.number, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh(ok.code);
  return { ok: true };
}

/** "Mark received" → dialog "Received on" (`values.received`, today by default, never after today). */
export async function markInterfaceReceivedAction(code: string, number: string, values?: Record<string, string>): Promise<InterfaceActionResult> {
  return transition(code, number, 'received', values);
}

export async function freezeInterfaceAction(code: string, number: string): Promise<InterfaceActionResult> {
  return transition(code, number, 'frozen');
}
