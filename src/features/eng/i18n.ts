// Translation helpers of the engineering screens. English stays the prototype's source text; the shared engine
// (prototype dictionary + FR_RULES + src/i18n/extra/eng.json) does the rest. Local fixes:
// - French singular after "1" (the prototype wrote "1 ouvertes · 0 bloquantes", "1 gelés"): "1 ouverte", "1 bloquante",
//   "1 bloquée", "1 gelé" — English keeps the prototype's texts, except the gate tag "Blocked by 1 blocking inconsistency";
// - the generation stamp of an output on an earlier day ("Generated 2 Oct · xlsx", the prototype only had "today");
// - Server Function messages (English sources with their French in eng.json).
import type { Lang, T } from '@/i18n/translate';
import { generatedText, type OutputRowV } from '@/domain/engineering';

const FR_ONE: [RegExp, string][] = [
  [/\b1 ouvertes\b/g, '1 ouverte'],
  [/\b1 bloquantes\b/g, '1 bloquante'],
  [/\b1 bloquées\b/g, '1 bloquée'],
  [/\b1 gelés\b/g, '1 gelé'],
];
/** French singular after "1" (see above). */
export const frSingular = (s: string) => FR_ONE.reduce((x, [re, rep]) => x.replace(re, rep), s);

/** `t` of the engineering screens: the shared engine, then the French singulars. English is the identity. */
export const engT = (t: T, lang: Lang): T => (lang === 'fr' ? (s) => frSingular(t(s)) : t);

/** "Generated today · xlsx" (prototype FR "Généré aujourd’hui · xlsx") / "Generated 2 Oct · xlsx" ("Généré le 2 oct. · xlsx"). */
export function generatedLine(g: OutputRowV['generated'], t: T, lang: Lang): string {
  if (!g) return '';
  if (g.on === 'today' || lang !== 'fr') return t(generatedText(g));
  return `Généré le ${t(g.on)} · ${g.format}`;
}

/** English messages of the Server Functions (FR in src/i18n/extra/eng.json). */
export const ENG_MSG = {
  readOnly: 'The engineering register is read-only for you',
  invalid: 'Invalid request',
  failed: 'The change could not be saved',
  noRegister: 'No engineering register for this project yet — import the first list to start.',
  stale: 'This action is not available any more',
  pmOnly: 'Only the project manager validates releases',
  blocked: 'Release blocked by open blocking inconsistencies',
} as const;
