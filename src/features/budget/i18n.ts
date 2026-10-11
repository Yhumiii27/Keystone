// Budget-specific French forms that the prototype's FR_RULES do not cover (docs/spec/04 §0.7: these strings fell
// through trFR untranslated). Applied on whole strings before the shared t(); everything else goes through t().
import type { Lang, T } from '@/i18n/translate';

const comma = (n: string) => n.replace('.', ',');

const RULES: [RegExp, (...m: string[]) => string][] = [
  // KPI subs: "70% of budget" (also covered by FR_RULES) and "-9.1% of budget" (decimal, not covered).
  [/^(-?\d+(?:\.\d+)?)% of budget$/, (_, n) => `${comma(n)} % du budget`],
  // Reconciliation › Contingency: "139% drawn" · "+58 k€ over".
  [/^(\d+)% drawn$/, (_, n) => `${n} % consommés`],
  [/^([+−-]?[\d,.]+ (?:k|M)€) over$/, (_, v) => `${v} de dépassement`],
  // Delivery 7 (A-4): reconciliation "Pending" sub-line from the register.
  [/^(\d+) change requests in review$/, (_, n) => `${n} demandes de modification en revue`],
  // Generated project notes (projectData().note, logic 3337).
  [
    /^Spending is running ahead of earned value \(CPI ([\d.]+)\); the forecast at completion exceeds the budget\.$/,
    (_, c) => `Les dépenses devancent la valeur acquise (CPI ${comma(c)}) ; la prévision à l’achèvement dépasse le budget.`,
  ],
  [
    /^Cost performance is healthy \(CPI ([\d.]+)\); the forecast at completion sits within budget\.$/,
    (_, c) => `La performance coûts est saine (CPI ${comma(c)}) ; la prévision à l’achèvement reste dans le budget.`,
  ],
];

/** t() extended with the Budget screen's parameterised FR forms. English is the identity. */
export function budgetT(t: T, lang: Lang): T {
  if (lang !== 'fr') return t;
  return (s) => {
    for (const [re, rep] of RULES) {
      const m = s.match(re);
      if (m) return rep(...m);
    }
    return t(s);
  };
}

/**
 * Cost-type tag label. The prototype dictionary renders "Reserve" as "Réservation" (a stock-movement word, still
 * right for the Stock screen), so the cost type gets its own FR label (docs/spec/04 §0.7).
 */
export const costTypeLabel = (label: string, t: T, lang: Lang) => (lang === 'fr' && label === 'Reserve' ? 'Réserve' : t(label));
