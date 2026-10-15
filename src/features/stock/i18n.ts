// Stock & storages translation helpers. English stays the prototype's source text (docs/spec/08 §4, 01 §12); the
// French comes from the prototype dictionary through t(), except where the prototype's French was wrong or missing:
// - movement types: "Transfer" is the noun "Transfert" in the movement lists (the shared entry is the verb
//   "Transférer" of the operation button);
// - movement "where" texts recorded in English ("· counted", "→ HLT activity", "· rework / scrap", "QC failed",
//   "BL-… accepted") are translated piece by piece; location, activity and receipt names stay as stored;
// - the KPI sub-lines have their singular forms ("1 line"), the scrap warning its second sentence;
// - the rule messages of the movement form and the toasts of the X3 exchange (new in the rebuild).
import type { Lang, T } from '@/i18n/translate';

const fr = (lang: Lang) => lang === 'fr';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Quantity in the viewer's language ("1,240" / "1 240"). */
export const qtyText = (n: number, lang: Lang) => n.toLocaleString(fr(lang) ? 'fr-FR' : 'en-US');

const MOVE_FR: Record<string, string> = { Transfer: 'Transfert' };
/** Movement type of the movement lists (EN label → FR noun). */
export const moveTypeT = (label: string, t: T, lang: Lang) => (fr(lang) && Object.hasOwn(MOVE_FR, label) ? MOVE_FR[label] : t(label));

/** Movement "where" text (stored in English by the movement writers). */
export function whereT(text: string, lang: Lang): string {
  if (!fr(lang)) return text;
  return text
    .replace(/ · counted$/, ' · inventaire')
    .replace(/ → ([A-Z]{3}) activity$/, ' → activité $1')
    .replace(/ · rework \/ scrap$/, ' · reprise / rebut')
    .replace(/^QC failed · /, 'QC non conforme · ')
    .replace(/ · QC failed$/, ' · QC non conforme')
    .replace(/ · (\S+) accepted$/, ' · $1 accepté')
    .replace(/ · ([A-Z]{3}) released$/, ' · réservation $1 libérée');
}

/** KPI "Stock value" sub: "18 lines · 6 locations". */
export const linesLocationsText = (lines: number, locations: number, lang: Lang) =>
  fr(lang)
    ? `${lines} ${plural(lines, 'ligne', 'lignes')} · ${locations} ${plural(locations, 'emplacement', 'emplacements')}`
    : `${lines} ${plural(lines, 'line', 'lines')} · ${locations} ${plural(locations, 'location', 'locations')}`;

/** KPI "X3 import" sub: "Today · 15 lines from Sage X3". */
export const x3LinesText = (n: number, lang: Lang) =>
  fr(lang) ? `Aujourd’hui · ${n} ${plural(n, 'ligne', 'lignes')} depuis Sage X3` : `Today · ${n} ${plural(n, 'line', 'lines')} from Sage X3`;

/** Scrap warning of a pinned part (the prototype left its second sentence in English). */
export function scrapWarnT(pinnedEn: string, t: T, lang: Lang): string {
  if (!fr(lang)) return `Pinned revision in service — ${pinnedEn}. Scrapping is allowed but After-sales must confirm spare coverage first.`;
  return `Révision épinglée en service — ${t(pinnedEn)}. Le rebut est autorisé, mais le SAV doit d’abord confirmer la couverture en pièces de rechange.`;
}

/** Toast of "Import from X3" — R-034: a simulation, Sage X3 is not connected (demo database only). */
export const importToastText = (lines: number, keptLocal: number, lang: Lang) =>
  fr(lang)
    ? `Import simulé (Sage X3 non connecté) · ${lines} ${plural(lines, 'ligne', 'lignes')} · ${keptLocal} ${plural(keptLocal, 'modification locale conservée', 'modifications locales conservées')}`
    : `Simulated import (Sage X3 not connected) · ${lines} ${plural(lines, 'line', 'lines')} · ${keptLocal} ${plural(keptLocal, 'local change', 'local changes')} kept`;

/** Toast of the drawer's "Push to X3" — R-034: a simulation, Sage X3 is not connected (demo database only). */
export const pushToastText = (ref: string, location: string, movements: number, lang: Lang) =>
  fr(lang)
    ? `Envoi simulé (Sage X3 non connecté) · ${ref} · ${location} · ${movements} ${plural(movements, 'mouvement', 'mouvements')}`
    : `Simulated push (Sage X3 not connected) · ${ref} · ${location} · ${movements} ${plural(movements, 'movement', 'movements')}`;

/** Rule messages of the movement form (src/domain/stock.ts, the stock DAL) → the viewer's language; null when unknown. */
export function stockErrorT(message: string, t: T, lang: Lang): string | null {
  const only = /^Only (\d+) (on hand|available|reserved) at (.+)$/.exec(message);
  if (only) {
    const [, n, kind, loc] = only;
    if (!fr(lang)) return message;
    if (kind === 'reserved') return `Seulement ${n} ${plural(+n, 'réservé', 'réservés')} à ${loc}`;
    return kind === 'on hand' ? `Seulement ${n} en stock à ${loc}` : `Seulement ${n} ${plural(+n, 'disponible', 'disponibles')} à ${loc}`;
  }
  // R-099: units reserved for another project.
  const others = /^(\d+) reserved for (\S+) — its project manager must release them first$/.exec(message);
  if (others) {
    const [, n, project] = others;
    return fr(lang) ? `${n} ${plural(+n, 'réservé', 'réservés')} pour ${project} — son chef de projet doit d’abord les libérer` : message;
  }
  return KNOWN_ERRORS.has(message) ? t(message) : null;
}

const KNOWN_ERRORS = new Set([
  'Invalid movement', 'Invalid quantity', 'Enter a whole quantity', 'Enter a quantity above 0', 'Choose a destination', 'The destination is the current location',
  'A project is required', 'This line is already reserved for another project', 'The destination is reserved for another project', 'Unknown stock line',
  'Unknown project',
  // Delivery 7 (SC-5a, R-098 / R-099).
  'Choose the activity the parts are issued to', 'Choose an activity of the project plan', 'This line holds no reservation for this project',
]);
