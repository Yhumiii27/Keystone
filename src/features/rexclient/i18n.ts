// Lessons learned & closure and client portal translation helpers. English stays the prototype's source text; the
// shared engine (prototype dictionary + FR_RULES + src/i18n/extra/rexclient.json) does the rest. Local additions:
// - parameterised forms the rules do not cover: "Due 10 Nov" (any due date; the dictionary only knows "Due 15 Oct"),
//   "lowest · Schedule adherence" (the rule leaves the criterion in English while the survey rows translate it);
// - text typed in Keystone (lessons, client issues, contract milestone labels) is translated only on an exact
//   dictionary match, never segment by segment ("Mar works" must not become "mars works");
// - French decimals of the survey are formatted by the domain (oneDecimal).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };

/** Free text typed by people: French only when the whole text is a dictionary entry. */
export const exactText = (s: string, lang: Lang) => (lang === 'fr' && s && Object.hasOwn(DICT, s) ? DICT[s] : s);

/** Payment column "Due 10 Nov" → "Échéance 10 nov.". */
export const dueText = (date: string, t: T, lang: Lang) => (lang === 'fr' ? `Échéance ${t(date)}` : `Due ${date}`);

/**
 * Contract milestone "M3 Structure topped out": the number stays, the label is translated on an exact match
 * ("Structure hors d’eau"); legacy plan rows ("Sep") are month names.
 */
export function milestoneText(label: string, number: string | null, t: T, lang: Lang): string {
  if (number && label.startsWith(number + ' ')) return `${number} ${exactText(label.slice(number.length + 1), lang)}`;
  return t(label);
}

/**
 * Toast / error text: the whole sentence when the dictionary has it ("Lesson recorded · to be validated" → "REX
 * enregistré · à valider" — the prototype translated it segment by segment and left it in English), else per " · "
 * segment like the prototype's showToast.
 */
export function toastText(english: string, t: T): string {
  const whole = t(english);
  return whole !== english ? whole : english.split(' · ').map(t).join(' · ');
}

/**
 * Submit of "Add lesson learned": the verb "Record" ("Enregistrer"). The dictionary's "Record" is the noun "Fiche"
 * (Quality drawers' record section), which the prototype printed on this button in French.
 */
export const recordVerb = (lang: Lang) => (lang === 'fr' ? 'Enregistrer' : 'Record');

/** KPI sub-line; "lowest · {criterion}" with the criterion translated like the survey rows ("plus bas · Respect du planning"). */
export function subText(sub: string, t: T, lang: Lang): string {
  const m = lang === 'fr' ? sub.match(/^lowest · (.+)$/) : null;
  return m ? `plus bas · ${t(m[1])}` : t(sub);
}
