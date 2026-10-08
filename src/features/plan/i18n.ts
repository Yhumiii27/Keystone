// Plan-specific translation helpers. English stays the prototype's source text.
// - `planT` fixes three shared FR dictionary entries that are wrong in this screen's context (docs/spec/05 OQ 23):
//   "Start" → "Démarrer" (column header, drawer key: should be "Début") and "Complete" → "Avancement" (drawer
//   status tag: should be "Terminée"), plus "None" → "Aucun" (drawer Constraint value: "Aucune", feminine).
//   Kept local so other screens using the shared entries are not affected.
// - Parameterised sentences that the shared FR rule engine (src/i18n/fr-rules.ts) does not cover.
import type { Lang, T } from '@/i18n/translate';

const FR_OVERRIDES: Record<string, string> = { Start: 'Début', Complete: 'Terminée', None: 'Aucune' };

/** `t` with the plan's FR overrides. */
export const planT = (t: T, lang: Lang): T => (s) => (lang === 'fr' && Object.hasOwn(FR_OVERRIDES, s) ? FR_OVERRIDES[s] : t(s));

/**
 * Day counts in FR: "-27d" → "-27 j", "FS +10d" → "FS +10 j", "40d / 11d" → "40 j / 11 j". The prototype leaves
 * the English "d" in French (docs/spec/05 OQ 23: "+15d" partly untranslated); the KPI tiles already read "−27 j".
 */
export const daysText = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/([+\-−]?\d+)d\b/g, '$1 j') : s);

/** Drawer to-do count: "2 of 6 done". */
export const todoCountText = (done: number, total: number, lang: Lang) =>
  lang === 'fr' ? `${done} sur ${total} terminées` : `${done} of ${total} done`;

/** Drawer cost note: "Forecast +€190k over this package’s budget" (amount already formatted). */
export const forecastOverText = (amount: string, lang: Lang) =>
  lang === 'fr' ? `Prévision ${amount} au-dessus du budget de ce lot` : `Forecast ${amount} over this package’s budget`;

/** Pending resource request meta: "awaiting Engineering approval" (department already translated). */
export const awaitingApprovalText = (dept: string, lang: Lang) =>
  lang === 'fr' ? `en attente de validation ${dept}` : `awaiting ${dept} approval`;

/** Rescheduled resource request meta: "reschedule proposed by Sophie Renard". */
export const rescheduleProposedText = (head: string, lang: Lang) =>
  lang === 'fr' ? `replanification proposée par ${head}` : `reschedule proposed by ${head}`;

/** Removal confirmation: "Remove A1250 · Steel erection — Bays 3–4?" / work package with its activities. */
export const removeQuestion = (kind: 'wp' | 'act', label: string, count: number, lang: Lang) => {
  if (kind === 'act') return lang === 'fr' ? `Retirer ${label} ?` : `Remove ${label}?`;
  if (lang === 'fr')
    return count ? `Retirer le lot ${label} et ses ${count} activité${count > 1 ? 's' : ''} ?` : `Retirer le lot ${label} ?`;
  return count ? `Remove work package ${label} and its ${count} activit${count > 1 ? 'ies' : 'y'}?` : `Remove work package ${label}?`;
};
