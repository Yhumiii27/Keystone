// HR-specific French forms the prototype's FR_RULES do not cover (docs/spec/06 §0.5, OQ12–13). Applied on whole
// strings before the shared t(); everything else goes through t(). English is the identity.
import type { Lang, T } from '@/i18n/translate';
import { FR_MONTHS } from '@/i18n/fr-rules';

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

/** Leave codes the prototype leaves in English in FR (06 OQ12). CP and RTT are French already. */
const LEAVE_FR: Record<string, string> = {
  Sick: 'Maladie',
  'Hol.': 'Férié',
  'Sick · sick leave': 'Maladie · arrêt maladie',
  'Hol. · public holiday': 'Férié · jour férié',
  // Tag of hours routed to a work package ("heures affectées").
  Assigned: 'Affectées',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const RULES: [RegExp, (t: T, ...m: string[]) => string][] = [
  // Week column labels "Sep 28" → "28 sept." (the engine's month substitution gives "sept. 28", 06 OQ13).
  [new RegExp(`^(${MONTHS}) (\\d{1,2})$`), (_t, _s, m, d) => `${d} ${FR_MONTHS[m]}`],
  // Matrix cell tooltip "{skill} · level {n}".
  [/^(.+) · level (\d)$/, (t, _s, skill, n) => `${t(skill)} · niveau ${n}`],
  // Hours KPI label of the imported month (the dictionary only has September).
  [new RegExp(`^Declared in Lucca · (${MONTH_NAMES.join('|')})$`), (_t, _s, m) => `Déclaré dans Lucca · ${MONTH_NAMES_FR[MONTH_NAMES.indexOf(m)]}`],
  // Singular forms (the prototype always pluralises).
  [/^1 resource × work package line$/, () => '1 ligne ressource × lot'],
  [/^1 line without a planned task$/, () => '1 ligne sans tâche planifiée'],
  [/^Cost rate · 1 role$/, () => 'Taux de coût · 1 rôle'],
  // Import toast with the real counts (the prototype's "12 lines matched" is a constant, 06 OQ9).
  [
    /^Lucca hours imported · (\d+) lines? matched · (\d+) to assign$/,
    (_t, _s, a, b) => `Heures Lucca importées · ${a} ligne${a === '1' ? '' : 's'} rapprochée${a === '1' ? '' : 's'} · ${b} à affecter`,
  ],
  // Assign toast.
  [/^(\d+(?:[.,]\d+)?) h assigned to (.+)$/, (t, _s, h, wp) => `${h.replace('.', ',')} h affectées à ${t(wp)}`],
];

/** t() extended with the HR screens' FR forms. */
export function hrT(t: T, lang: Lang): T {
  if (lang !== 'fr') return t;
  return (s) => {
    const leave = LEAVE_FR[s];
    if (leave) return leave;
    for (const [re, rep] of RULES) {
      const m = s.match(re);
      if (m) return rep(t, ...m);
    }
    return t(s);
  };
}
