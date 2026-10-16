'use server';
// R-121 (owner's decision D-4 'a' ★): "Raise as a risk" on a client prerequisite late at J-15 — the existing "New risk" form,
// pre-filled from the prerequisite (src/domain/prerequisite-alerts.ts), confirmed by a lead of the project. Checked here: the
// viewer is a lead of the project (PM of record, co-PM, deputy, director — R-041) who may edit its Site and its Risk register
// (inside the workspace, project not read-only); the line as the page showed it (`stamp`); still late at the business date and
// no risk raised from it yet. The values are parsed like "New risk" (owners, active categories). The writer re-checks the lead
// right and the line in its transaction, records the audit rows and the activity line; the pages are then revalidated.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { PREREQ_RISK_LEADS_ONLY, PREREQ_RISK_NOT_LATE, PREREQ_RISK_RAISED, canRaisePrerequisiteRisk, prerequisiteRiskTrigger } from '@/domain/prerequisite-alerts';
import { FORM_CATEGORIES, parseNewRisk } from '@/domain/risk';
import { siteDateText } from '@/domain/site';
import { SITE_LINE_CHANGED } from '@/domain/site-sheet';
import { orderedOptions } from '@/domain/settings-rules';
import { businessToday } from '@/server/clock';
import { getProject } from '@/server/dal/projects';
import { raisePrerequisiteRisk } from '@/server/dal/prerequisite-alerts';
import { riskOwnerOptions } from '@/server/dal/risks-screen';
import { riskCategoryOptions } from '@/server/dal/settings-lists';
import { getSite } from '@/server/dal/site';
import { logError } from '@/server/log';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { RISK_RESULT } from '@/features/risks/forms';
import { messageText } from './i18n';

const INVALID = 'Invalid request';
const FAILED = 'The change could not be saved';
const STALE = 'This step is not available any more';

async function fail(english: string): Promise<{ error: string }> {
  const { t, lang } = await getI18n();
  return { error: messageText(english, t, lang) };
}

/** Form values as sent by the client, keeping string entries only. */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
const isPosition = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000;
const isStamp = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-z]{1,16}$/.test(v);

/** "Raise as a risk" → "R-21 · Risk registered"; the prerequisite's row then links to the risk. */
export async function raisePrerequisiteRiskAction(code: string, position: number, stamp: string, values: Record<string, string>): Promise<FormDialogResult> {
  if (typeof code !== 'string' || !code || !isPosition(position) || !isStamp(stamp)) return fail(INVALID);
  const project = await getProject(code);
  if (!project) return fail('Unknown project');
  const ctx = await getProjectContext(project.code, 'site');
  if (!ctx.isLead || !ctx.canEdit('site') || !ctx.canEdit('risks')) return fail(PREREQ_RISK_LEADS_ONLY);
  const site = await getSite(project.code);
  const p = site?.prerequisites.find((x) => x.position === position);
  if (!site || !p) return fail('Unknown prerequisite');
  if (p.stamp !== stamp) return fail(STALE);
  if (p.riskNumber) return fail(PREREQ_RISK_RAISED);
  if (!canRaisePrerequisiteRisk(p, await businessToday())) return fail(PREREQ_RISK_NOT_LATE);

  const [team, cats] = await Promise.all([riskOwnerOptions(project.code), riskCategoryOptions()]);
  const parsed = parseNewRisk(strings(values), team, orderedOptions(cats.active, FORM_CATEGORIES).map((c) => c.code));
  if (!parsed.ok) return fail(parsed.error);
  const { t, lang } = await getI18n();
  const trigger = prerequisiteRiskTrigger(p, t(siteDateText(p.neededBy)), t);
  let number: string;
  try {
    number = await raisePrerequisiteRisk(project.code, position, stamp, parsed.value, trigger, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === SITE_LINE_CHANGED) return fail(STALE);
    if (m === PREREQ_RISK_LEADS_ONLY || m === PREREQ_RISK_NOT_LATE || m === PREREQ_RISK_RAISED) return fail(m);
    logError('raisePrerequisiteRiskAction', e);
    return fail(FAILED);
  } finally {
    revalidatePath('/', 'layout');
  }
  return { toast: `${number} · ${messageText(RISK_RESULT, t, lang)}` };
}
