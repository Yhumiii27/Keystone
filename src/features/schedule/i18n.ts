// Schedule-specific translation helpers. English stays the prototype's source text.
import type { Lang } from '@/i18n/translate';

/**
 * Slip in days, FR unit: "+15d" → "+15 j", "−15d" → "−15 j" ("—" unchanged). The prototype leaves the English
 * "d" in French (docs/spec/05 OQ 23: "+15d" partly untranslated); same rule as the Plan screen's `daysText`.
 */
export const slipText = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/([+\-−]?\d+)d\b/g, '$1 j') : s);

/**
 * S-06 — refusal of a move earlier than the logic allows: "A1330 cannot start before 30 Nov 2026: its predecessor A1320 (FS)
 * holds it". `date` is already formatted in the viewer's language.
 */
export function heldText(hold: { activity: string; by: { id: string; link: string }[]; floor: 'predecessor' | 'dataDate' | 'projectStart' }, date: string, lang: Lang): string {
  const who = hold.by.map((p) => `${p.id} (${p.link})`).join(', ');
  const many = hold.by.length > 1;
  if (lang === 'fr') {
    const why =
      hold.floor === 'predecessor'
        ? many ? `ses prédécesseurs ${who} la retiennent` : `son prédécesseur ${who} la retient`
        : hold.floor === 'projectStart' ? 'le début du projet la retient' : 'la date des données la retient';
    return `${hold.activity} ne peut pas commencer avant le ${date} : ${why}`;
  }
  const why =
    hold.floor === 'predecessor'
      ? many ? `its predecessors ${who} hold it` : `its predecessor ${who} holds it`
      : hold.floor === 'projectStart' ? 'the project start holds it' : 'the data date holds it';
  return `${hold.activity} cannot start before ${date}: ${why}`;
}
