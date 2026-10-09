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

// ── Chapter 4 (S-1, S-2, S-3): Reschedule, baselines, calendars, relationships ─────────────────────────────────────
// Dates passed in are already translated ("18 janv. 2027").

/** Reschedule toast: "Rescheduled at 25 Sep 2026 · finish 18 Jan 2027 · 11 activities changed" (or "· no change"). */
export function rescheduledText(dataDate: string, finish: string, changed: number, lang: Lang): string {
  if (lang === 'fr') {
    const what = changed ? `${changed} activité${changed > 1 ? 's' : ''} modifiée${changed > 1 ? 's' : ''}` : 'aucun changement';
    return `Replanifié au ${dataDate} · fin ${finish} · ${what}`;
  }
  const what = changed ? `${changed} activit${changed > 1 ? 'ies' : 'y'} changed` : 'no change';
  return `Rescheduled at ${dataDate} · finish ${finish} · ${what}`;
}

/** "Circular logic: A1250 → A1260 → A1250 — nothing was rescheduled". */
export const cycleText = (cycle: string[], lang: Lang) =>
  lang === 'fr' ? `Logique circulaire : ${cycle.join(' → ')} — rien n’a été replanifié` : `Circular logic: ${cycle.join(' → ')} — nothing was rescheduled`;

/** Relationship refused because of a loop. */
export const linkCycleText = (cycle: string[], lang: Lang) =>
  lang === 'fr' ? `Ce lien créerait une boucle logique : ${cycle.join(' → ')}` : `This relationship would create a logic loop: ${cycle.join(' → ')}`;

/** "BL3 · Baseline set · 21 activities". */
export const baselineSetText = (code: string, n: number, lang: Lang) =>
  lang === 'fr' ? `${code} · Référence fixée · ${n} activité${n > 1 ? 's' : ''}` : `${code} · Baseline set · ${n} activit${n === 1 ? 'y' : 'ies'}`;

/** "BL2 displayed · variances recomputed". */
export const baselineShownText = (code: string, lang: Lang) =>
  lang === 'fr' ? `${code} affichée · écarts recalculés` : `${code} displayed · variances recomputed`;

/** "Calendar · Chantier 6d · 10h · dates move at the next Reschedule" (calendar name translated). */
export const calendarSetText = (name: string, lang: Lang) =>
  lang === 'fr' ? `Calendrier · ${name} · dates recalculées à la prochaine replanification` : `Calendar · ${name} · dates move at the next Reschedule`;

/** "A1250 · calendar Chantier 6d · 10h" / back to the project calendar. */
export const activityCalendarText = (act: string, name: string | null, lang: Lang) =>
  lang === 'fr'
    ? `${act} · ${name ? `calendrier ${name}` : 'calendrier du projet'} · pris en compte à la prochaine replanification`
    : `${act} · ${name ? `calendar ${name}` : 'project calendar'} · applied at the next Reschedule`;

/** Drawer key "BL1 finish" for the displayed baseline ("Fin BL2"). */
export const baselineFinishKey = (code: string, lang: Lang) => (lang === 'fr' ? `Fin ${code}` : `${code} finish`);

/** Progress KPI sub: "Finish 18 Jan 2027 vs BL1 18 Dec 2026". */
export const finishVsBaselineText = (finish: string, code: string, baseline: string, lang: Lang) =>
  lang === 'fr' ? `Fin ${finish} vs ${code} ${baseline}` : `Finish ${finish} vs ${code} ${baseline}`;

/** Structure KPI sub of the Baseline tile: "Set 12 Mar 2026 · 21 activities" / "Pending CR-009 · 0 activities". */
export function baselineKpiSub(setOn: string | null, changeRequest: string | null, n: number, lang: Lang): string {
  const acts = lang === 'fr' ? `${n} activité${n > 1 ? 's' : ''}` : `${n} activit${n === 1 ? 'y' : 'ies'}`;
  if (setOn) return lang === 'fr' ? `Fixée le ${setOn} · ${acts}` : `Set ${setOn} · ${acts}`;
  return `${baselineWhenText(null, changeRequest, lang)} · ${acts}`;
}

/** "Relationship added · A1240 FS → A1250". */
export const linkAddedText = (pred: string, rel: string, succ: string, lang: Lang) =>
  lang === 'fr' ? `Lien ajouté · ${pred} ${rel} → ${succ}` : `Relationship added · ${pred} ${rel} → ${succ}`;

/** "Relationship removed · A1240 → A1250". */
export const linkRemovedText = (pred: string, succ: string, lang: Lang) =>
  lang === 'fr' ? `Lien supprimé · ${pred} → ${succ}` : `Relationship removed · ${pred} → ${succ}`;

/** "T-2341 · To-do added". */
export const todoAddedText = (number: string, lang: Lang) => (lang === 'fr' ? `${number} · À faire ajouté` : `${number} · To-do added`);

/** Remove a to-do: "Remove T-2341?" is not asked — removal is immediate for composer to-dos without logged time. */
export const todoRemovedText = (number: string, lang: Lang) => (lang === 'fr' ? `${number} · À faire retiré` : `${number} · To-do removed`);

/** Date part of a baseline chip / menu line: "12 mars 2026" (translated date given), else "Pending CR-009" / "Not set". */
export const baselineWhenText = (setOn: string | null, changeRequest: string | null, lang: Lang) =>
  setOn ?? (changeRequest ? (lang === 'fr' ? `En attente de ${changeRequest}` : `Pending ${changeRequest}`) : lang === 'fr' ? 'Non fixée' : 'Not set');

// ── Chapter 4 (S-5): removal with undo ─────────────────────────────────────────────────────────────────────────────

/** Removal toast: "A1250 removed" / "Work package 1.7 removed". */
export const removedText = (kind: 'wp' | 'act', code: string, lang: Lang) =>
  kind === 'wp' ? (lang === 'fr' ? `Lot ${code} retiré` : `Work package ${code} removed`) : lang === 'fr' ? `${code} retirée` : `${code} removed`;

/** Restore toast: "Work package 1.7 restored · 2 activities" / "A1250 restored". */
export function restoredText(kind: 'wp' | 'act', code: string, n: number, lang: Lang): string {
  if (kind === 'act') return lang === 'fr' ? `${code} restaurée` : `${code} restored`;
  const acts = lang === 'fr' ? `${n} activité${n > 1 ? 's' : ''}` : `${n} activit${n === 1 ? 'y' : 'ies'}`;
  return lang === 'fr' ? `Lot ${code} restauré · ${acts}` : `Work package ${code} restored · ${acts}`;
}

/** Restore refused: the code was given to a new row since. */
export const restoreConflictText = (code: string, lang: Lang) =>
  lang === 'fr' ? `${code} existe de nouveau dans le plan — restauration impossible` : `${code} exists again in the plan — it cannot be restored`;

/** "Recently deleted" line meta: "2 activities · Romain Aubert · 9 Oct 14:05" (date already formatted). */
export function trashMetaText(kind: 'wp' | 'act', n: number, who: string, when: string, lang: Lang): string {
  if (kind === 'act') return `${who} · ${when}`;
  const acts = lang === 'fr' ? `${n} activité${n > 1 ? 's' : ''}` : `${n} activit${n === 1 ? 'y' : 'ies'}`;
  return `${acts} · ${who} · ${when}`;
}
