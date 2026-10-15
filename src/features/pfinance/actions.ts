'use server';
// Portfolio prioritisation Server Functions (docs/spec/03 §6.4, §6.6): the viewer's axis weights (Weights card) and
// "Score a proposal" (AF `portfolio`). Each one checks the viewer's access to the screen (director and pm; outside the
// workspace is read-only), validates the untrusted input, writes through the DAL and revalidates the screen.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { screenHref } from '@/config/screens';
import { validWeight } from '@/domain/portfolio-finance';
import { scoreAxis } from '@/server/db/codes';
import { listProposalOptions } from '@/server/dal/pfinance';
import { saveProposalScore, setScoreWeight } from '@/server/dal/prioritisation';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { SCORE_SAVED, parseScoreProposal } from './forms';

export type WeightResult = { ok: true; value: number } | { error: string };

async function editor(): Promise<{ role: string; name: string; userId: string | null; t: (s: string) => string } | { error: string }> {
  const [{ t }, { viewer, outside }] = await Promise.all([getI18n(), getScreenAccess('portfolio')]);
  if (outside) return { error: t('Outside my workspace · Read-only') };
  return { role: viewer.role, name: viewer.name, userId: viewer.userId ?? null, t };
}

/** Weight of one axis for the viewer (`setW`): 0 ≤ w ≤ 1 (the input's range); the ranking is not normalised on save. */
export async function setScoreWeightAction(axis: string, value: unknown): Promise<WeightResult> {
  const who = await editor();
  if ('error' in who) return who;
  if (typeof axis !== 'string' || !scoreAxis.isCode(axis)) return { error: who.t('Invalid request') };
  const w = validWeight(value);
  if (w == null) return { error: who.t('Weights are numbers from 0 to 1') };
  await setScoreWeight({ role: who.role, userId: who.userId }, axis, w);
  revalidatePath(screenHref('portfolio'));
  return { ok: true, value: w };
}

/**
 * "Score a proposal" (AF.portfolio, "Save score"): records the 5 ranking axes — strategic fit, financial return (Margin
 * / NPV axis), risk, resource fit and client priority (L-5a, R-134) — on a pipeline project with the viewer as scorer
 * (the prototype only toasted, 03 OQ10). The ranking picks the new scores up on the next render.
 */
export async function scoreProposalAction(values: Record<string, string>): Promise<FormDialogResult> {
  const who = await editor();
  if ('error' in who) return who;
  const options = await listProposalOptions();
  const parsed = parseScoreProposal(values, options.map((o) => o.value));
  if (!parsed.ok) return { error: who.t(parsed.error) };
  const { projectCode, fit, margin, risk, res, client, comment } = parsed.value;
  await saveProposalScore(projectCode, { fit, margin, risk, res, client, comment }, { name: who.name, role: who.role });
  revalidatePath(screenHref('portfolio'));
  return { toast: who.t(SCORE_SAVED) };
}
