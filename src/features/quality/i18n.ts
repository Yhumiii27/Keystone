// Translation helpers of the Quality — NCR & deliverables screen. English stays the prototype's source text; the shared
// engine (prototype dictionary + FR_RULES + src/i18n/extra/quality.json) does the rest. Local fixes:
// - "Move to <step>": the prototype's French left the step in English ("Passer à Corrective action"); the step is
//   translated like the step indicator ("Passer à Action corrective");
// - singular French forms of the KPI subs ("1 clôturée ce trimestre", "1 accepté par le client"; the prototype wrote
//   "1 clôturées", "1 acceptés");
// - texts that come from Vigie (NCR titles, causes, actions, ISO clauses) are translated on an exact dictionary match
//   only, so a French text typed in Vigie is never altered and an English one is never half-translated.
import type { Lang, T } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';

const SINGULAR: [RegExp, string][] = [
  [/^([01]) clôturées ce trimestre$/, '$1 clôturée ce trimestre'],
  [/^([01]) acceptés par le client$/, '$1 accepté par le client'],
];

/** `t` of the screen: the shared engine, then the French singular forms. English is the identity. */
export const qualityT = (t: T, lang: Lang): T =>
  lang === 'fr' ? (s) => SINGULAR.reduce((x, [re, rep]) => x.replace(re, rep), t(s)) : t;

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

/** "Move to Containment" (drawer button, ncrVals.nextLabel) with the step translated. */
export const moveToText = (stepLabel: string, t: T, lang: Lang) => (lang === 'fr' ? `Passer à ${t(stepLabel)}` : `Move to ${stepLabel}`);
