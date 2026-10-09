// Chapter 4 — A-12: texts of the computed KPIs that the shared FR rule engine (src/i18n/fr-rules.ts) does not cover —
// parameterised sentences and decimal values. Fixed strings go through t() with their FR entries in
// src/i18n/extra/ch4-kpis.json. Formulas: src/domain/kpis.ts.
import type { Lang, T } from '@/i18n/translate';

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
};

/** "October" / "January 2027" (the year when it differs from `refYear`). */
export const monthName = (iso: string, lang: Lang, refYear: number) =>
  MONTHS[lang][+iso.slice(5, 7) - 1] + (+iso.slice(0, 4) !== refYear ? ` ${iso.slice(0, 4)}` : '');

/** « d’octobre » / « de novembre » (French elision before a vowel). */
const deMonth = (iso: string) => {
  const m = MONTHS.fr[+iso.slice(5, 7) - 1].toLowerCase();
  return /^[aeiouyéè]/.test(m) ? `d’${m}` : `de ${m}`;
};

/**
 * "Lowest cumulative point" sub-line: "October — before M3 payment lands (HLT-026)" / « Octobre — avant l’encaissement de
 * M3 (HLT-026) »; a monthly progress invoice: "October — before the October progress payment lands (NDC-031)" /
 * « Octobre — avant l’encaissement de la situation d’octobre (NDC-031) »; "October — lowest point of the window" when no
 * payment is expected after it. '' without a forecast.
 */
export function lowPointSubText(
  low: { month: string; next: { project: string; label: string; progressMonth?: string } | null } | null | undefined,
  t: T,
  lang: Lang,
  refYear: number,
): string {
  if (!low) return '';
  const m = monthName(low.month, lang, refYear);
  if (!low.next) return lang === 'fr' ? `${m} — point bas de la période` : `${m} — lowest point of the window`;
  const { label, project, progressMonth } = low.next;
  if (progressMonth)
    return lang === 'fr'
      ? `${m} — avant l’encaissement de la situation ${deMonth(progressMonth)} (${project})`
      : `${m} — before the ${monthName(progressMonth, 'en', refYear)} progress payment lands (${project})`;
  return lang === 'fr' ? `${m} — avant l’encaissement de ${t(label)} (${project})` : `${m} — before ${label} payment lands (${project})`;
}

/** Average response in working days, one decimal: "1.0 d" / « 1,0 j »; "—" without a decided request. */
export const responseDaysText = (days: number | null, lang: Lang) =>
  days == null ? '—' : lang === 'fr' ? `${days.toFixed(1).replace('.', ',')} j` : `${days.toFixed(1)} d`;

/** Whole days: "9 d" / « 9 j »; "—" when unknown. */
export const wholeDaysText = (days: number | null, lang: Lang) => (days == null ? '—' : lang === 'fr' ? `${days} j` : `${days} d`);

/** A percentage KPI: "83%" (both languages, as the prototype printed it); "—" when there is nothing to measure. */
export const pctOrDash = (pct: number | null | undefined) => (pct == null ? '—' : `${pct}%`);

/** "Logged this week" sub with the calendar's weekly hours: "of 40 h · 38%" / « sur 40 h · 38 % ». */
export const loggedOfText = (weekHours: number, pct: number, lang: Lang) =>
  lang === 'fr' ? `sur ${weekHours} h · ${pct} %` : `of ${weekHours} h · ${pct}%`;
