'use server';
// R-162 (P4, D9-34) — Server Functions of Settings › Reference exchange rates and the FX hedging alert thresholds: Finance and the
// portfolio director (`canEditFxRates`), with Settings in their workspace. The writers (src/server/dal/fx.ts) validate with the pure
// rules (src/domain/fx-exposure.ts), re-check the right in their transaction and write the audit (before / after).
import { revalidatePath } from 'next/cache';
import { FX_ERRORS, isFxThresholdKey } from '@/domain/fx-exposure';
import { canEditFxRates } from '@/domain/rights';
import { businessToday } from '@/server/clock';
import { FxWriteError, addReferenceRate, removeReferenceRate, setFxThreshold } from '@/server/dal/fx';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type FxActionResult = { ok: true } | { error: string };

const FX_ONLY = 'Only Finance or the portfolio director can edit the reference exchange rates';

async function run(write: (actor: { name: string; role: string }) => Promise<unknown>): Promise<FxActionResult> {
  const { t } = await getI18n();
  const access = await getScreenAccess('settings');
  if (!access.canEdit || !canEditFxRates(access.viewer.role)) return { error: t(FX_ONLY) };
  try {
    await write({ name: access.viewer.name, role: access.viewer.role });
  } catch (e) {
    if (!(e instanceof FxWriteError)) throw e;
    if (e.code === 'rights') return { error: t(FX_ONLY) };
    if (e.code === 'unknown') return { error: t('Invalid request') };
    return { error: t(FX_ERRORS[e.code]) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Adds a reference rate (currency, euros per unit, valid from). */
export async function addReferenceRateAction(values: Record<string, string>): Promise<FxActionResult> {
  const today = await businessToday();
  return run((actor) => addReferenceRate(rec(values), today, actor));
}

/** Removes a reference rate entered by mistake. */
export async function removeReferenceRateAction(id: string): Promise<FxActionResult> {
  if (typeof id !== 'string') return { error: (await getI18n()).t('Invalid request') };
  return run((actor) => removeReferenceRate(id, actor));
}

/** One hedging alert threshold (net exposure in k€, rate drift in %). */
export async function setFxThresholdAction(key: string, raw: string): Promise<FxActionResult> {
  if (!isFxThresholdKey(key)) return { error: (await getI18n()).t('Invalid request') };
  return run((actor) => setFxThreshold(key, raw, actor));
}
