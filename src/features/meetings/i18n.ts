// Meetings & minutes translation helpers (docs/spec/05 §5). English stays the prototype's source text; the shared
// engine (prototype dictionary + FR_RULES + src/i18n/extra/meetings.json) does the rest. Kept local to this screen:
// - minutes content (titles, agenda points, notes, transcripts, client questions) is people's text: translated
//   only on an exact dictionary match (seeded titles, "Change requests"), never through the segment / month rules
//   that half-translated it in the prototype ("Émettre le the revised milestone schedule", "20 oct..");
// - the New meeting form fixes two shared dictionary entries in this context: "Time" → "Heure" (not "Temps") and
//   "Location" → "Lieu" (not "Emplacement") (05 OQ23);
// - counts the rules leave plural ("1 conviés", "1 actions") and the Send minutes toast, which the prototype built
//   by hand in French.
import type { Lang, T } from '@/i18n/translate';
import { isDateDue } from '@/domain/meetings';
import { dataText } from '@/i18n/data-text';

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

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

// ── Transcripts (chapter 4, S-10) ──────────────────────────────────────────────────────────────────────────────────

const count = (n: number, en: [string, string], fr: [string, string], lang: Lang) => {
  const [one, many] = lang === 'fr' ? fr : en;
  return `${n} ${n > 1 || (lang === 'en' && n === 0) ? many : one}`;
};

/** "Transcript imported · 412 words · 4 speakers" / "Transcription importée · 412 mots · 4 intervenants". */
export function importedToastText(r: { replaced: boolean; words: number; speakers: number }, lang: Lang): string {
  const head = lang === 'fr' ? (r.replaced ? 'Transcription remplacée' : 'Transcription importée') : r.replaced ? 'Transcript replaced' : 'Transcript imported';
  const parts = [head, count(r.words, ['word', 'words'], ['mot', 'mots'], lang)];
  if (r.speakers) parts.push(count(r.speakers, ['speaker', 'speakers'], ['intervenant', 'intervenants'], lang));
  return parts.join(' · ');
}

/** "{n} decisions · {n} actions · {n} risks · {n} client questions" (non-zero counts) or "no proposal". */
export function proposalCountsText(c: { decision: number; action: number; risk: number; question: number }, lang: Lang): string {
  const parts = [
    c.decision ? count(c.decision, ['decision', 'decisions'], ['décision', 'décisions'], lang) : '',
    c.action ? count(c.action, ['action', 'actions'], ['action', 'actions'], lang) : '',
    c.risk ? count(c.risk, ['risk', 'risks'], ['risque', 'risques'], lang) : '',
    c.question ? count(c.question, ['client question', 'client questions'], ['question client', 'questions client'], lang) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : lang === 'fr' ? 'aucune proposition' : 'no proposal';
}

/** Toast of "Analyse transcript": analyser, counts and the fallback notice when Claude failed. */
export function analysedToastText(
  r: { analyzer: 'local' | 'claude'; notice: string | null; counts: { decision: number; action: number; risk: number; question: number } },
  t: T,
  lang: Lang,
): string {
  const head =
    lang === 'fr'
      ? `Transcription analysée (${r.analyzer === 'claude' ? 'Claude' : 'règles locales'})`
      : `Transcript analysed (${r.analyzer === 'claude' ? 'Claude' : 'local rules'})`;
  const notice = r.notice ? ` · ${r.notice.split(' · ').map(t).join(' · ')}` : '';
  return `${head} · ${proposalCountsText(r.counts, lang)}${notice}`;
}
