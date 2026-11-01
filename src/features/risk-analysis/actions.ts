'use server';
// R-205 (K-205, K-205b): Server Functions of the « Analyse de risques » section of the Risk register — run the Monte-Carlo
// simulation (server side, on request; the result is stored with its date and inputs summary), set or clear an activity's
// three-point estimates, set or clear a risk's delay. Each one validates its input, checks the viewer is a lead of the project
// (PM of record, co-PM, deputy, or the director: `isLead`) on a project they may edit (`canEdit('risks')`: not read-only, not
// outside the workspace; a client never reaches here, getProjectContext sends them home), writes through the DAL writers
// (audit row + activity event), then revalidates the project's pages.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { CpmCycleError, CpmInputError } from '@/domain/cpm';
import { canEditRiskAnalysis, parseActivityRanges, parseIterations } from '@/domain/monte-carlo';
import { getProject } from '@/server/dal/projects';
import { RiskAnalysisError, runRiskAnalysis, saveActivityRange, saveRiskDelay } from '@/server/dal/risk-analysis';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { intlLocale } from '@/i18n/translate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RISK_ANALYSIS_REFUSED = 'Only the project’s leads and the director run the risk analysis and enter its ranges';

const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** The project and the viewer as actor, once the rights are checked; else the error to show. */
async function allowed(code: unknown): Promise<{ code: string; actor: { name: string; role: string } } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'risks');
  if (!canEditRiskAnalysis({ lead: ctx.isLead, canEdit: ctx.canEdit('risks') })) return { error: t(RISK_ANALYSIS_REFUSED) };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** "Run analysis": `iterations` (default 2 000, 200–5 000). Toast "Risk analysis complete · 2 000 iterations". */
export async function runRiskAnalysisAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await allowed(code);
  if ('error' in ok) return ok;
  const { t, lang } = await getI18n();
  const iterations = parseIterations(strings(values).iterations);
  if (iterations == null) return { error: t('Choose between 200 and 5,000 iterations') };
  try {
    await runRiskAnalysis(ok.code, iterations, ok.actor);
  } catch (e) {
    if (e instanceof CpmCycleError) return { error: `${t('Circular logic')} · ${e.cycle.join(' → ')}` };
    if (e instanceof CpmInputError) return { error: t('The schedule network is invalid: reschedule the project first') };
    if (e instanceof RiskAnalysisError) return { error: t(e.message) };
    console.error('runRiskAnalysisAction', e);
    return { error: t('The analysis could not be run') };
  }
  refresh(ok.code);
  return { toast: `${t('Risk analysis complete')} · ${iterations.toLocaleString(intlLocale(lang))} ${t('iterations')}` };
}

/** Three-point estimates of one activity (form fields dMin… cMax); all empty = back to the default range. */
export async function saveActivityRangeAction(code: string, activityId: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await allowed(code);
  if ('error' in ok) return ok;
  const { t } = await getI18n();
  if (typeof activityId !== 'string' || !UUID_RE.test(activityId)) return { error: t('Invalid request') };
  const parsed = parseActivityRanges(strings(values));
  if (!parsed.ok) return { error: t(parsed.error) };
  try {
    await saveActivityRange(ok.code, activityId, parsed.duration, parsed.cost, ok.actor);
  } catch (e) {
    if (e instanceof RiskAnalysisError) return { error: t(e.message) };
    console.error('saveActivityRangeAction', e);
    return { error: t('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: t(parsed.duration || parsed.cost ? 'Three-point estimate saved' : 'Back to the default range') };
}

/** Delay of one open risk if it occurs (working days, 0–250); empty = back to the default (impact × 5). */
export async function saveRiskDelayAction(code: string, riskId: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await allowed(code);
  if ('error' in ok) return ok;
  const { t } = await getI18n();
  if (typeof riskId !== 'string' || !UUID_RE.test(riskId)) return { error: t('Invalid request') };
  const raw = (strings(values).delay ?? '').trim();
  const days = raw === '' ? null : Number(raw);
  if (days != null && !(Number.isInteger(days) && days >= 0 && days <= 250)) return { error: t('Enter a whole number of working days between 0 and 250') };
  try {
    await saveRiskDelay(ok.code, riskId, days, ok.actor);
  } catch (e) {
    if (e instanceof RiskAnalysisError) return { error: t(e.message) };
    console.error('saveRiskDelayAction', e);
    return { error: t('The change could not be saved') };
  }
  refresh(ok.code);
  return { toast: t(days == null ? 'Back to the default delay' : 'Delay saved') };
}
