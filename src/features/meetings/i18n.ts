// Meetings & minutes translation helpers (docs/spec/05 §5). English stays the prototype's source text; the shared
// engine (prototype dictionary + FR_RULES + src/i18n/extra/meetings.json) does the rest. Kept local to this screen:
// - minutes content (titles, agenda points, notes, transcripts, client questions) is people's text: translated
//   only on an exact dictionary match (seeded titles, "Change requests"), never through the segment / month rules
//   that half-translated it in the prototype ("Émettre le the revised milestone schedule", "20 oct..");
// - the New meeting form fixes two shared dictionary entries in this context: "Time" → "Heure" (not "Temps") and
//   "Location" → "Lieu" (not "Emplacement") (05 OQ23);
// - counts the rules leave plural ("1 conviés", "1 actions") and the Send minutes toast, which the prototype built
//   by hand in French.
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';
import { isDateDue } from '@/domain/meetings';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };

/** People's text: FR only on an exact dictionary match. */
export const dataText = (s: string, lang: Lang) => (lang === 'fr' && s && Object.hasOwn(DICT, s) ? DICT[s] : s);

const FORM_FR: Record<string, string> = { Time: 'Heure', Location: 'Lieu' };
/** t() for the New meeting form labels. */
export const formT = (t: T, lang: Lang): T => (s) => (lang === 'fr' && Object.hasOwn(FORM_FR, s) ? FORM_FR[s] : t(s));

/** Due as typed: a date ("2 Oct") gets the translated month, anything else is people's text ("—", "next week"). */
export const dueText = (due: string | null | undefined, t: T, lang: Lang) => (!due ? '' : isDateDue(due) ? t(due) : dataText(due, lang));

/** "5 invited" / "1 convié". */
export const invitedText = (n: number, lang: Lang) => (lang === 'fr' ? `${n} convié${n > 1 ? 's' : ''}` : `${n} invited`);

/** "3 actions" / "1 action" (the prototype wrote "1 actions"). */
export const actionsText = (n: number) => `${n} action${n === 1 ? '' : 's'}`;

/** Toast of "Send minutes" (sendMinutes 4852): EN and the prototype's French sentence, singular forms added. */
export function sentToastText(doc: string, invited: number, tasks: number, lang: Lang): string {
  if (lang === 'fr')
    return `${doc} · CR envoyé à ${invited} convié${invited > 1 ? 's' : ''} · ${tasks} action${tasks > 1 ? 's' : ''} ajoutée${tasks > 1 ? 's' : ''} aux tâches`;
  return `${doc} · minutes sent to ${invited} invitee${invited === 1 ? '' : 's'} · ${tasks} action${tasks === 1 ? '' : 's'} added to tasks`;
}
