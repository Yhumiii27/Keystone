// Change control & Trends translation helpers. English stays the prototype's source text; the shared engine
// (prototype dictionary + FR_RULES + src/i18n/extra/changes.json) does the rest. Fixes kept local to these screens:
// - "Request" (CR register column) is the verb "Demander" in the shared dictionary → "Demande" here;
// - day counts "-12 d" / "-31 d" (prototype hyphen) are not covered by the FR rule `^([+−]?\d+) d$` → "j";
// - parameterised forms the rules do not cover: "BL2 proposed · CR-009 in review", "Contingency 150 k€"
//   (left in English by the prototype), "13 weekly snapshots" for any snapshot count, the baselines hint for any
//   proposed baseline, "Weekly · Fridays · since 10 Jul" for any first snapshot date.
import type { Lang, T } from '@/i18n/translate';

const OVERRIDES: Record<string, string> = { Request: 'Demande' };
const STATUS_FR: Record<string, string> = { draft: 'brouillon', 'in review': 'en revue', approved: 'approuvée', rejected: 'refusée' };

const RULES: [RegExp, (...m: string[]) => string][] = [
  [/^(BL\d+) proposed · (\S+) (draft|in review|approved|rejected)$/, (_, bl, cr, st) => `${bl} proposée · ${cr} ${STATUS_FR[st]}`],
  [/^(BL\d+) proposed$/, (_, bl) => `${bl} proposée`],
  [
    /^A re-baseline is itself a change request — (BL\d+) becomes current when (\S+) is approved$/,
    (_, bl, cr) => `Une nouvelle référence est elle-même une demande de modification — ${bl} devient courante à l’approbation de ${cr}`,
  ],
  [/^Contingency (.+)$/, (_, v) => `Provision ${v}`],
  [/^(\d+) weekly snapshots$/, (_, n) => `${n} instantanés hebdomadaires`],
];

/** "-12 d" → "-12 j" (any sign), applied to the translated FR text; never inside a word ("18 déc."). */
const days = (s: string) => s.replace(/(^|[\s(])([+\-−]?\d+) d(?![\p{L}\p{N}])/gu, '$1$2 j');

/** t() extended for the Change control and Trends screens. English is the identity. */
export function changesT(t: T, lang: Lang): T {
  if (lang !== 'fr') return t;
  return (s) => {
    if (Object.hasOwn(OVERRIDES, s)) return OVERRIDES[s];
    for (const [re, rep] of RULES) {
      const m = s.match(re);
      if (m) return rep(...m);
    }
    // Snapshots KPI sub for any first snapshot date (the dictionary has the "since 3 Jul" sentence only).
    const since = s.match(/^Weekly · Fridays · since (.+)$/);
    if (since) return `Hebdomadaire · vendredi · depuis le ${t(since[1])}`;
    return days(t(s));
  };
}
