// ITP · punch list and Commissioning translation helpers. English stays the prototype's source text (docs/spec/07 §2.4,
// §2.6, 01 §12); French comes from the prototype dictionary through t(), with these local rules:
// - `dataT`: plan, punch and dossier data (inspection names, systems, locations, dossier items) is translated the way
//   the prototype's deepTr did for the seed — whole text, else each " · " / " — " / " → " / " / " segment — but on exact
//   dictionary matches only, so text typed by people is never rewritten by the month / day / sentence rules.
// - `stepT`: the punch row step "Close" is "Clôturer" (the shared "Close" entry is the dialog's "Fermer"; the prototype
//   left "Close" in English).
// - KPI sentences with their French singular forms (the shared rules only have the plural: "1 échouées").
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';
import { blockedText, failedText, missingText, planShapeText } from '@/domain/itpcom';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };
const exact = (s: string) => (Object.hasOwn(DICT, s) ? DICT[s] : s);
const fr = (lang: Lang) => lang === 'fr';

/** Register data text in the viewer's language (exact dictionary matches, whole text then segments). */
export function dataT(s: string, lang: Lang): string {
  if (!fr(lang) || !s) return s;
  if (Object.hasOwn(DICT, s)) return DICT[s];
  return s
    .split(/( · | — | → | \/ )/)
    .map((p, i) => (i % 2 ? p : exact(p)))
    .join('');
}

const STEP_FR: Record<string, string> = { Start: 'Démarrer', Close: 'Clôturer' };
/** Punch row step label ("Start" / "Close"). */
export const stepT = (label: 'Start' | 'Close', t: T, lang: Lang) => (fr(lang) ? STEP_FR[label] : t(label));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 failed · NCR raised" / "1 échouée · NCR émise". */
export const failedT = (n: number, lang: Lang) => (fr(lang) ? `${plural(n, 'échouée', 'échouées')} · NCR émise` : failedText(n));

/** "6 systems · 2 custom lines" / "6 systèmes · 2 lignes personnalisées" (singular forms for 1). */
export const planShapeT = (systems: number, custom: number, lang: Lang) =>
  fr(lang) ? `${plural(systems, 'système', 'systèmes')} · ${plural(custom, 'ligne personnalisée', 'lignes personnalisées')}` : planShapeText(systems, custom);

/** "2 blocked by interfaces" / "2 bloquées par des interfaces". */
export const blockedT = (n: number, lang: Lang) => (fr(lang) ? `${plural(n, 'bloquée', 'bloquées')} par des interfaces` : blockedText(n));

/** "4 items missing" / "4 éléments manquants". */
export const missingT = (n: number, lang: Lang) => (fr(lang) ? plural(n, 'élément manquant', 'éléments manquants') : missingText(n));
