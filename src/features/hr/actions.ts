'use server';
// HR Server Functions (docs/spec/06 §2–§5): rate card edits and "Add role", "Add skill", "Import Lucca hours" and the
// "Assign" of hours declared without a planned task ("Sync Lucca" is retired: absences come from Cursus, NEW-CURSUS-7). Each one checks the viewer's access to the
// screen (not outside the workspace; rates: director/pm; hours: project editable), validates the untrusted input,
// writes through the DAL (the viewer is the actor of the audit row) and revalidates the screen.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { screenHref } from '@/config/screens';
import { canSeeRates } from '@/domain/hr';
import {
  addRateRole, addSkill, assignUnassignedHours, getHoursReconciliation, getRateCard, getSkillsMatrix, markHoursImported, setBaseRate, setMultiplier,
} from '@/server/dal/hr';
import { getProject } from '@/server/dal/projects';
import { getProjectContext, getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import {
  ADD_ROLE_RESULT, ADD_SKILL_RESULT, importHoursResult, parseAddRole, parseAddSkill, parseFactor, parseImportHours, parseRate, periodCovers,
} from './forms';
import { hrT } from './i18n';

export type HrEditResult = { ok: true; value: number } | { error: string };

async function tr() {
  const { t, lang } = await getI18n();
  return hrT(t, lang);
}

/** Rate card writes: director and pm inside their workspace (multipliers included — 06 OQ6). */
async function rateEditor(): Promise<{ actor: string } | { error: string }> {
  const t = await tr();
  const { viewer, outside } = await getScreenAccess('rates');
  if (outside || !canSeeRates(viewer.role)) return { error: t('Rates are visible to directors and project managers only') };
  return { actor: viewer.name };
}

/** Base €/h of a role (`setRate`); the cell keeps the stored value. */
export async function setBaseRateAction(role: string, value: number): Promise<HrEditResult> {
  const t = await tr();
  const who = await rateEditor();
  if ('error' in who) return who;
  const rate = parseRate(value);
  if (!rate.ok) return { error: t(rate.error) };
  const card = await getRateCard();
  if (typeof role !== 'string' || !card.roles.some((r) => r.role === role)) return { error: t('Invalid request') };
  await setBaseRate(role, rate.value, who.actor);
  revalidatePath(screenHref('rates'));
  return { ok: true, value: rate.value };
}

/** Multiplier factor (`setMult`). */
export async function setMultiplierAction(key: string, value: number): Promise<HrEditResult> {
  const t = await tr();
  const who = await rateEditor();
  if ('error' in who) return who;
  const factor = parseFactor(value);
  if (!factor.ok) return { error: t(factor.error) };
  const card = await getRateCard();
  if (typeof key !== 'string' || !card.multipliers.some((m) => m.key === key)) return { error: t('Invalid request') };
  await setMultiplier(key, factor.value, who.actor);
  revalidatePath(screenHref('rates'));
  return { ok: true, value: factor.value };
}

/** "Add role" (AF.rates): appends the role to the rate card (the prototype only toasts — 06 OQ8). */
export async function addRateRoleAction(values: Record<string, string>): Promise<FormDialogResult> {
  const t = await tr();
  const who = await rateEditor();
  if ('error' in who) return who;
  const card = await getRateCard();
  const parsed = parseAddRole(values, card.roles.map((r) => r.role));
  if (!parsed.ok) return { error: t(parsed.error) };
  const { role, rateEur, costCenter, grade } = parsed.value;
  await addRateRole({ role, rateEur, costCenter, grade }, who.actor);
  revalidatePath(screenHref('rates'));
  return { toast: t(ADD_ROLE_RESULT) };
}

/** "Add skill" (AF.skills): appends a skill family (a new matrix column, every level 0). */
export async function addSkillAction(values: Record<string, string>): Promise<FormDialogResult> {
  const t = await tr();
  const { viewer, outside } = await getScreenAccess('skills');
  if (outside) return { error: t('Outside my workspace · Read-only') };
  const matrix = await getSkillsMatrix();
  const parsed = parseAddSkill(values, matrix.skills.map((s) => s.name));
  if (!parsed.ok) return { error: t(parsed.error) };
  await addSkill({ name: parsed.value.name, category: parsed.value.category }, viewer.name);
  revalidatePath(screenHref('skills'));
  return { toast: t(ADD_SKILL_RESULT) };
}

async function hoursEditor(code: unknown): Promise<{ code: string; analytic: string | null; actor: string } | { error: string }> {
  const t = await tr();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Invalid request') };
  const ctx = await getProjectContext(project.code, 'hours');
  if (!ctx.canEdit('hours')) return { error: t('Hours are read-only for you on this project') };
  return { code: project.code, analytic: project.analytic, actor: ctx.viewer.name };
}

/**
 * "Import Lucca hours" (AF.hours): re-stamps the project's latest import (imported 30 Sep 2026), its analytic code and
 * matching mode. The Lucca connector is not modelled, so no line is fetched (TODO(db)); a period that does not
 * contain the latest import, or a project without any import, is refused instead of toasting a fake result.
 */
export async function importHoursAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const t = await tr();
  const who = await hoursEditor(code);
  if ('error' in who) return who;
  const parsed = parseImportHours(values, who.analytic);
  if (!parsed.ok) return { error: t(parsed.error) };
  const recon = await getHoursReconciliation(who.code);
  if (!recon || !periodCovers(parsed.value.period, recon.periodStart)) return { error: t('No hours declared in Lucca for this period') };
  await markHoursImported(who.code, { analyticCode: parsed.value.analyticCode, matchingMode: parsed.value.matchingMode }, who.actor);
  revalidatePath(screenHref('hours', { code: who.code }));
  return { toast: t(importHoursResult(recon.lines.length, recon.unassigned.filter((u) => !u.assignedWbs).length)) };
}

/**
 * "Assign" (no handler in the prototype, 06 OQ9 / R-6): routes hours declared without a planned task to a level-1
 * work package. `index` is the line's position in the "To assign" list of the latest import.
 */
export async function assignHoursAction(code: string, index: number, wbsCode: string): Promise<FormDialogResult> {
  const t = await tr();
  const who = await hoursEditor(code);
  if ('error' in who) return who;
  const recon = await getHoursReconciliation(who.code);
  const line = recon && Number.isInteger(index) ? recon.unassigned[index] : undefined;
  if (!recon || !line) return { error: t('Invalid request') };
  if (line.assignedWbs) return { error: t('These hours are already assigned') };
  const wp = recon.workPackages.find((w) => w.code === wbsCode);
  if (!wp) return { error: t('Choose a work package') };
  await assignUnassignedHours(who.code, index, wp.code, who.actor);
  revalidatePath(screenHref('hours', { code: who.code }));
  return { toast: t(`${line.hours} h assigned to ${wp.label}`) };
}
