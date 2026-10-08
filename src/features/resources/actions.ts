'use server';
// What-if levelling Server Functions (docs/spec/05 §4.5): priority segment, lever toggle, auto-level, select
// scenario, "New scenario" (AF whatif). Each one checks the viewer may edit what-if levelling (screen in the
// workspace, project not read-only for a PM who does not own it), validates the raw input, writes through the
// resources DAL and revalidates the screen. Resources / Project resources have no write of their own ("Request
// resource" belongs to the requests feature, "Apply" has no behaviour in the prototype).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { screenHref } from '@/config/screens';
import { WHATIF_PRIORITIES, type WhatIfPriority } from '@/domain/whatif';
import { getProject } from '@/server/dal/projects';
import { autoLevelScenario, createScenario, getWhatIf, selectScenario, setScenarioPriority, toggleScenarioLever, type WhatIf } from '@/server/dal/resources';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { NEW_SCENARIO_RESULT, parseNewScenario } from './whatif-form';

export type WhatIfActionResult = { ok: true } | { error: string };

/** Loads the project's what-if levelling after checking the viewer may edit it. */
async function editableWhatIf(code: unknown): Promise<{ code: string; data: WhatIf; actor: string } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Invalid request') };
  const [access, scope] = await Promise.all([getScreenAccess('whatif'), getProjectScope()]);
  if (!access.canEdit || scope.readOnly(project)) return { error: t('What-if levelling is read-only for you') };
  const data = await getWhatIf(project.code);
  if (!data) return { error: t('No levelling scenario for this project') };
  return { code: project.code, data, actor: access.viewer.name };
}

const refresh = () => revalidatePath(screenHref('whatif'));

async function scenarioOf(code: unknown, scenario: unknown) {
  const r = await editableWhatIf(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  if (typeof scenario !== 'string' || !r.data.scenarios.some((s) => s.name === scenario)) return { error: t('Invalid request') };
  return { ...r, scenario };
}

/** Priority segment ("Protect date / budget / people"); does not change the levers, as in the prototype. */
export async function setWhatIfPriority(code: string, scenario: string, priority: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario);
  if ('error' in r) return r;
  if (!WHATIF_PRIORITIES.includes(priority as WhatIfPriority)) return { error: (await getI18n()).t('Invalid request') };
  await setScenarioPriority(r.code, r.scenario, priority as WhatIfPriority);
  refresh();
  return { ok: true };
}

/** Lever row click: toggles one lever of a scenario. */
export async function toggleWhatIfLever(code: string, scenario: string, lever: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario);
  if ('error' in r) return r;
  if (typeof lever !== 'string' || !r.data.levers.some((l) => l.code === lever)) return { error: (await getI18n()).t('Invalid request') };
  await toggleScenarioLever(r.code, r.scenario, lever);
  refresh();
  return { ok: true };
}

/** "Auto-level for this priority": the levers become AUTO[priority]. */
export async function autoLevelWhatIf(code: string, scenario: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario);
  if ('error' in r) return r;
  await autoLevelScenario(r.code, r.scenario);
  refresh();
  return { ok: true };
}

/**
 * "Select scenario → create requests": marks the scenario selected (audit row by the viewer). As in the prototype,
 * no resource request is created yet (05 OQ11).
 */
export async function selectWhatIfScenario(code: string, scenario: string): Promise<WhatIfActionResult> {
  const r = await scenarioOf(code, scenario);
  if ('error' in r) return r;
  await selectScenario(r.code, r.scenario, r.actor);
  refresh();
  return { ok: true };
}

/** "New scenario" (AF whatif): a third card with no lever enabled, priority "Protect date"; audit row by the viewer. */
export async function createWhatIfScenario(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const r = await editableWhatIf(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const parsed = parseNewScenario(values, r.data.scenarios.map((s) => s.name));
  if (!parsed.ok) return { error: t(parsed.error) };
  const v = parsed.value;
  await createScenario(r.code, { name: v.name, basis: v.basis, horizonMonths: v.horizonMonths, hypotheses: v.hypotheses || undefined }, r.actor);
  refresh();
  return { toast: t(NEW_SCENARIO_RESULT) };
}
