// R-188: the "Estimate class" field of the dialogs that freeze a budget version (Plan › Set baseline, Schedule › Re-baseline)
// and its server-side parsing. Pure module shared by the client dialogs and the Server Functions; labels are EN source strings
// (FormDialog `translate`), values the class codes.
import type { FormFieldDef } from '@/components/app/form-def';
import { ESTIMATE_CLASSES, ESTIMATE_CLASS_LABEL, isEstimateClass, type EstimateClass } from '@/domain/estimate-class';

export const ESTIMATE_CLASS_FIELD_ID = 'estimateClass';

/** Select field, preset to the class of the project's stage (`stageEstimateClass`). */
export const estimateClassField = (defaultClass: EstimateClass): FormFieldDef => ({
  id: ESTIMATE_CLASS_FIELD_ID,
  label: 'Estimate class',
  type: 'select',
  defaultValue: defaultClass,
  options: ESTIMATE_CLASSES.map((c) => ({ value: c, label: ESTIMATE_CLASS_LABEL[c] })),
});

export const UNKNOWN_ESTIMATE_CLASS = 'Unknown estimate class';

/** The submitted class (untrusted): absent or blank = the stage default (undefined); anything else must be E50, E30 or E10. */
export function parseEstimateClassInput(v: unknown): { ok: true; value: EstimateClass | undefined } | { ok: false; error: string } {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : null;
  if (s === '') return { ok: true, value: undefined };
  return isEstimateClass(s) ? { ok: true, value: s } : { ok: false, error: UNKNOWN_ESTIMATE_CLASS };
}

// ── Budget screen: the class and range next to the BAC ───────────────────────────────────────────────────────────────

export interface EstimateKpi {
  label: string;
  value: string;
  sub: string;
  /** Not classified: LO. */
  alert: boolean;
}

/**
 * "Estimate range" tile of the Budget screen, already translated: low – high of the BAC, and the class with where it comes from
 * (the current baseline's code, or "Working budget" for the class of the stage). `money` formats k€ for the viewer's language.
 */
export function estimateKpi(
  e: { estimateClass: EstimateClass | null; source: 'baseline' | 'stage' | 'none'; baselineCode: string | null; range: { low: number; high: number } | null },
  money: (k: number) => string,
  t: (s: string) => string,
): EstimateKpi {
  if (!e.estimateClass || !e.range) return { label: t('Estimate range'), value: '—', sub: t('Not classified'), alert: true };
  const from = e.source === 'baseline' && e.baselineCode ? e.baselineCode : t('Working budget');
  return { label: t('Estimate range'), value: `${money(e.range.low)} – ${money(e.range.high)}`, sub: `${t(ESTIMATE_CLASS_LABEL[e.estimateClass])} · ${from}`, alert: false };
}
