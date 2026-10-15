// Translator of the Sourcing screen: the shared t() (prototype dictionary + FR_RULES + src/i18n/extra/procurement.json)
// plus the French forms the shared engine misses or gets wrong on this screen (docs/spec/08 OQ2, OQ26):
// - "Request" is the RFQ drawer's section heading (a noun): "Demande", not the verb "Demander" of the dictionary;
// - "Lead time" heads the quote comparison column (the prototype showed "Discipline lead" / "Référent"): "Délai";
// - singulars: "1 ready to award" → "1 prête à attribuer", "1 rated A" → "1 noté A", "1 quote · from …" → "1 devis · à
//   partir de …" (the shared rules only know the plural);
// - "Awarded to {supplier} — no purchase order drafted (…)": the award made without an order to draft;
// - R-095: "Awarded to {supplier} — purchase order {n} awaiting approval / placed / cancelled before it was placed.".
// Text typed by people or read from the catalogue (RFQ titles, part names, articles) goes through `dataText`: French
// only on an exact dictionary match, so it is never half-translated.
import type { Lang, T } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

const OWN: Record<string, string> = {
  Request: 'Demande',
  'Lead time': 'Délai',
};

const READY = /^(\d+) ready to award$/;
const RATED_A = /^(\d+) rated A$/;
const ONE_QUOTE = /^1 quote · from (.+)$/;
const NO_PO = /^Awarded to (.+) — no purchase order drafted \(no project or quantity on the RFQ\)\.$/;
const PO_NOW = /^Awarded to (.+) — purchase order (\S+) (awaiting approval|placed|cancelled before it was placed)\.$/;
const PO_NOW_FR: Record<string, string> = { 'awaiting approval': 'en attente d’approbation', placed: 'passée', 'cancelled before it was placed': 'annulée avant d’être passée' };

export function procT(t: T, lang: Lang): T {
  if (lang !== 'fr') return t;
  return (s: string) => {
    if (Object.hasOwn(OWN, s)) return OWN[s];
    let m = READY.exec(s);
    if (m) return `${m[1]} ${+m[1] > 1 ? 'prêtes' : 'prête'} à attribuer`;
    m = RATED_A.exec(s);
    if (m) return `${m[1]} ${+m[1] > 1 ? 'notés' : 'noté'} A`;
    m = ONE_QUOTE.exec(s);
    if (m) return `1 devis · à partir de ${m[1]}`;
    m = NO_PO.exec(s);
    if (m) return `Attribuée à ${m[1]} — aucune commande brouillon créée (consultation sans projet ni quantité).`;
    m = PO_NOW.exec(s);
    if (m) return `Attribuée à ${m[1]} — commande ${m[2]} ${PO_NOW_FR[m[3]]}.`;
    return t(s);
  };
}
