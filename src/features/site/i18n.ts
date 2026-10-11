// Site-specific translation helpers. English stays the prototype's source text (docs/spec/10 §3, 01 §12).
// - Prototype data (site sheet, prerequisites, equipment, rotation, collisions, seeded reports, HSE titles) goes through
//   t() like the prototype's deepTr; text typed in Keystone (daily-report progress) is translated on an exact
//   dictionary match only (the segment / month engine would alter "Montage poteaux…").
// - Weather: the dictionary renders "Clear" as "Effacer" (the button) — the weather is "Dégagé".
// - Parameterised sentences the shared FR rules do not cover (man-days consumed ≠ 0, the preparation footnote for any
//   start date, the last-sync lines, the toasts with a number).
import type { Lang, T } from '@/i18n/translate';
import { hseIncident, weather, type HseIncident, type Weather } from '@/server/db/codes';
import { dataText } from '@/i18n/data-text';

const fr = (lang: Lang) => lang === 'fr';

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

const WEATHER_FR: Record<Weather, string> = { clear: 'Dégagé', rain: 'Pluie', wind: 'Vent > 50 km/h', storm: 'Tempête' };
/** Weather of a daily report (form option, report detail). */
export const weatherText = (w: Weather, t: T, lang: Lang) => (fr(lang) ? WEATHER_FR[w] : t(weather.label(w)));
/** HSE field of a daily report ("None", "Near miss"…). */
export const incidentText = (i: HseIncident, t: T) => t(hseIncident.label(i));

/** French plural mark: 0 and 1 take the singular. */
const pl = (n: string) => (+n > 1 ? 's' : '');

/**
 * FR forms of the feature's parameterised sentences (English source → French); `null` when none applies. The counts
 * agree in French (the shared rules give "1 non confirmés", "1 conditions sur 5", "1 expédiés", "1 approbations").
 */
const RULES: [RegExp, (m: RegExpExecArray, t: T) => string][] = [
  [/^(\d+) consumed · site starts (.+)$/, (m, t) => `${m[1]} consommé${pl(m[1])} · démarrage chantier ${t(m[2])}`],
  [/^Site starts (.+) — reports so far cover preparation visits\.$/, (m, t) => `Le chantier démarre le ${t(m[1])} — les rapports actuels couvrent les visites de préparation.`],
  [/^Last sync (.+)$/, (m, t) => `Dernière synchro ${t(m[1])}`],
  [/^(\d+) on site$/, (m) => `${m[1]} sur site`],
  [/^Daily report saved · (\S+)$/, (m) => `Rapport journalier enregistré · ${m[1]}`],
  [/^(\d+) unconfirmed$/, (m) => `${m[1]} non confirmé${pl(m[1])}`],
  [/^(\d+) of (\d+) conditions open · start (.+)$/, (m, t) => `${m[1]} condition${pl(m[1])} sur ${m[2]} ouverte${pl(m[1])} · démarrage ${t(m[3])}`],
  [/^(\d+) shipped · (\d+) local \/ client$/, (m) => `${m[1]} expédié${pl(m[1])} · ${m[2]} loca${+m[2] > 1 ? 'ux' : 'l'} / client`],
  [/^Cursus sync · (\d+) approvals received$/, (m) => `Synchro Cursus · ${m[1]} approbation${pl(m[1])} reçue${pl(m[1])}`],
  [
    /^Cursus sync · (\d+) approvals received · (\d+) sent · (\d+) failed$/,
    (m) => `Synchro Cursus · ${m[1]} approbation${pl(m[1])} reçue${pl(m[1])} · ${m[2]} envoyée${pl(m[2])} · ${m[3]} en échec`,
  ],
];

function ruleFr(s: string, t: T): string | null {
  for (const [re, f] of RULES) {
    const m = re.exec(s);
    if (m) return f(m, t);
  }
  return null;
}

/** A screen sentence built in English: the feature's rules, else t(). */
export const siteText = (s: string, t: T, lang: Lang) => (fr(lang) ? (ruleFr(s, t) ?? t(s)) : s);

/** A message (toast, error) built in English: the feature's rules, else t() per " · " segment. */
export const messageText = (s: string, t: T, lang: Lang) => (fr(lang) ? (ruleFr(s, t) ?? s.split(' · ').map(t).join(' · ')) : s);
