'use server';
// What-if levelling Server Functions (docs/spec/05 §4.5; chapter 4, S-7): priority segment, lever toggle, auto-level,
// "Select scenario → create requests", "New scenario", rename and delete — and "Apply" on a Suggested rebalancing line
// (Resources, Project resources; R-3). Each one checks the viewer may edit (screen in the workspace, project not read-only
// for a PM who does not own it), validates the raw input, writes through the resources DAL (audited under the viewer) and
// revalidates. Requests are created as DRAFTS through the requests DAL; the plan changes only at the next Reschedule.
// Owner answers 17 Oct 2026 (navigable what-if): every what-if action takes the horizon the screen shows — the start of its
// 8-week window, validated here as `?week=` is on the page (an invalid one is refused, absent = the current window) — so the
// levers toggled, the effects saved and the requests drafted are those on screen; a horizon entirely in the past is
// read-only (refused with `WHATIF_PAST_HORIZON`).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { screenHref } from '@/config/screens';
import { WHATIF_PRIORITIES, type WhatIfPriority } from '@/domain/whatif';
import { getProject } from '@/server/dal/projects';
import {
  applyLever, applyScenario, autoLevelScenario, createScenario, deleteScenario, hasWhatIf, listScenarioNames, renameScenario, retainedScenario, selectScenario, setScenarioPriority,
  toggleScenarioLever, whatIfWindow,
} from '@/server/dal/resources';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { DELETE_SCENARIO_RESULT, NEW_SCENARIO_RESULT, parseNewScenario, parseRenameScenario, RENAME_SCENARIO_RESULT } from './whatif-form';
import { WHATIF_PAST_HORIZON, applyMessage, scenarioTitle, suggestionMessage } from './whatif-model';

export type WhatIfActionResult = { ok: true; message?: string } | { error: string };

/**
 * The horizon an action carries (the window start of the screen): absent = the current window; not a valid window start
 * (malformed, out of the ±52-week bounds) → refused; entirely in the past → refused (read-only).
 */
async function horizonOf(horizon: unknown): Promise<{ horizon: string | undefined } | { error: string }> {
  const { t } = await getI18n();
  if (horizon === undefined || horizon === null) return { horizon: undefined };
  if (typeof horizon !== 'string') return { error: t('Invalid request') };
  try {
    const { window, past } = await whatIfWindow(horizon);
    return past ? { error: t(WHATIF_PAST_HORIZON) } : { horizon: window.start };
  } catch {
    return { error: t('Invalid request') };
  }
}

/** Checks the viewer may edit the project's what-if levelling on the horizon shown. */
async function editableWhatIf(code: unknown, horizon?: unknown): Promise<{ code: string; actor: string; horizon: string | undefined } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Invalid request') };
  const [access, scope] = await Promise.all([getScreenAccess('whatif'), getProjectScope()]);
  if (!access.canEdit || scope.readOnly(project)) return { error: t('What-if levelling is read-only for you') };
  if (!(await hasWhatIf(project.code))) return { error: t('No levelling scenario for this project') };
  const h = await horizonOf(horizon);
  if ('error' in h) return h;
  return { code: project.code, actor: access.viewer.name, horizon: h.horizon };
}

const refresh = () => {
  revalidatePath(screenHref('whatif'));
  // Drafted requests appear in Resource requests; suggestions on Resources / Project resources change with them.
  revalidatePath(screenHref('requests'));
  revalidatePath(screenHref('resources'));
};

async function scenarioOf(code: unknown, scenario: unknown, horizon?: unknown) {
  const r = await editableWhatIf(code, horizon);
  if ('error' in r) return r;
  const { t } = await getI18n();
  if (typeof scenario !== 'string' || !(await listScenarioNames(r.code)).includes(scenario)) return { error: t('Invalid request') };
  return { ...r, scenario };
}

/** Runs a DAL write; an unexpected refusal (stale lever, unknown person) becomes a translated error. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch {
    return { error: (await getI18n()).t('The change could not be saved') };
  }
}

/** Priority segment ("Protect date / budget / people"); does not change the levers, as in the prototype. */
export async function setWhatIfPriority(code: string, scenario: string, priority: string, horizon?: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  if (!WHATIF_PRIORITIES.includes(priority as WhatIfPriority)) return { error: (await getI18n()).t('Invalid request') };
  const done = await attempt(() => setScenarioPriority(r.code, r.scenario, priority as WhatIfPriority, r.actor));
  if (done && typeof done === 'object' && 'error' in done) return done;
  refresh();
  return { ok: true };
}

/** Lever row click: toggles one derived lever of a scenario; its effects are recomputed and saved. */
export async function toggleWhatIfLever(code: string, scenario: string, lever: string, horizon?: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  if (typeof lever !== 'string' || !lever) return { error: (await getI18n()).t('Invalid request') };
  const done = await attempt(() => toggleScenarioLever(r.code, r.scenario, lever, r.actor, r.horizon));
  if (typeof done === 'object' && 'error' in done) return done;
  refresh();
  return { ok: true };
}

/** "Auto-level for this priority": the levers become the derived set of the scenario's priority. */
export async function autoLevelWhatIf(code: string, scenario: string, horizon?: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  const done = await attempt(() => autoLevelScenario(r.code, r.scenario, r.actor, r.horizon));
  if (!Array.isArray(done)) return done;
  refresh();
  return { ok: true };
}

/**
 * "Select scenario → create requests": marks the scenario selected and turns its enabled levers into DRAFT resource
 * requests (overtime, extra resource, contractor, colleague) through the requests DAL; shifts are reported as plan changes.
 */
export async function selectWhatIfScenario(code: string, scenario: string, horizon?: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const done = await attempt(async () => {
    await selectScenario(r.code, r.scenario, r.actor);
    return applyScenario(r.code, r.scenario, r.actor, r.horizon);
  });
  if ('error' in done) return done;
  refresh();
  return { ok: true, message: applyMessage(done, scenarioTitle(r.scenario, t), lang) };
}

/**
 * "New scenario" (AF whatif), audited under the viewer: a card with no lever enabled and priority "Protect date", or —
 * basis "Selected scenario" — a copy of the retained scenario's levers and priority.
 */
export async function createWhatIfScenario(code: string, values: Record<string, string>, horizon?: string): Promise<FormDialogResult> {
  const r = await editableWhatIf(code, horizon);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const parsed = parseNewScenario(values, await listScenarioNames(r.code));
  if (!parsed.ok) return { error: t(parsed.error) };
  const v = parsed.value;
  if (v.basis === 'last_approved' && !(await retainedScenario(r.code))) return { error: t('No scenario is selected or applied yet — start from the current plan') };
  const done = await attempt(() => createScenario(r.code, { name: v.name, basis: v.basis, hypotheses: v.hypotheses || undefined }, r.actor, r.horizon));
  if (done && typeof done === 'object' && 'error' in done) return done;
  refresh();
  return { toast: t(NEW_SCENARIO_RESULT) };
}

/** Rename (and hypotheses) of a scenario. */
export async function renameWhatIfScenario(code: string, scenario: string, values: Record<string, string>, horizon?: string): Promise<FormDialogResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const parsed = parseRenameScenario(values, r.scenario, await listScenarioNames(r.code));
  if (!parsed.ok) return { error: t(parsed.error) };
  const done = await attempt(() => renameScenario(r.code, r.scenario, { name: parsed.value.name, hypotheses: parsed.value.hypotheses }, r.actor));
  if (done && typeof done === 'object' && 'error' in done) return done;
  refresh();
  return { toast: t(RENAME_SCENARIO_RESULT) };
}

/** Deletes a scenario (confirmed in the board); the requests it drafted stay. */
export async function deleteWhatIfScenario(code: string, scenario: string, horizon?: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario, horizon);
  if ('error' in r) return r;
  const done = await attempt(() => deleteScenario(r.code, r.scenario, r.actor));
  if (done && typeof done === 'object' && 'error' in done) return done;
  refresh();
  return { ok: true, message: (await getI18n()).t(DELETE_SCENARIO_RESULT) };
}

/**
 * "Apply" on a Suggested rebalancing line (Resources / Project resources): drafts the lever's resource request. Allowed to
 * viewers who may edit that screen and the lever's project.
 */
export async function applySuggestion(projectCode: string, lever: string): Promise<WhatIfActionResult> {
  const { t, lang } = await getI18n();
  if (typeof projectCode !== 'string' || typeof lever !== 'string' || !lever) return { error: t('Invalid request') };
  const project = await getProject(projectCode);
  if (!project) return { error: t('Invalid request') };
  const [resources, presources, scope] = await Promise.all([getScreenAccess('resources'), getScreenAccess('presources'), getProjectScope()]);
  if ((!resources.canEdit && !presources.canEdit) || scope.readOnly(project)) return { error: t('Resource requests are read-only for you') };
  const done = await attempt(() => applyLever(project.code, lever, resources.viewer.name));
  if (done && typeof done === 'object' && 'error' in done) return done;
  revalidatePath(screenHref('resources'));
  revalidatePath(screenHref('presources', { code: project.code }));
  revalidatePath(screenHref('requests'));
  return { ok: true, message: suggestionMessage(done, lang) };
}
