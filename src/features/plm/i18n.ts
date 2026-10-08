// PLM-specific translation helpers. English stays the prototype's source text (docs/spec/09 §2–§3); French comes from
// the prototype dictionary through t(), with the fixes below where the prototype left parameterised strings in English
// or the shared dictionary entry is wrong in this context:
// - "54 of 54 parts" (`plmCount`) and the Projects equipped quantity "6 units" stayed English in the prototype;
// - thousands follow the language ("6 200 unités", the prototype wrote "6,200" in French);
// - "Unit" is "Unitaire" in the shared dictionary (the unit-price column); the New part form's field is "Unité";
// - stock and reservation texts of the part record are new.
import { leadLongText, leadShortText, totalQuantityText, unitsText } from '@/domain/parts';
import type { Lang, T } from '@/i18n/translate';

const fr = (lang: Lang) => lang === 'fr';

/** Quantity with the language's thousands separator ("6,200" / "6 200"). */
export const qtyT = (n: number, lang: Lang) => n.toLocaleString(fr(lang) ? 'fr-FR' : 'en-US');

/** Catalogue count line "12 of 54 parts" / "12 sur 54 articles". */
export const countT = (shown: number, total: number, lang: Lang) => (fr(lang) ? `${shown} sur ${total} article${total > 1 ? 's' : ''}` : `${shown} of ${total} parts`);

/** Projects equipped quantity: "6 units" / "6 unités" (singular for 1). */
export const unitsT = (qty: number, lang: Lang) => (fr(lang) ? `${qtyT(qty, lang)} ${qty === 1 ? 'unité' : 'unités'}` : unitsText(qty));

/** "Total quantity": "6 units · 1 project" / "6 unités · 1 projet". */
export const totalQuantityT = (qty: number, projects: number, lang: Lang) =>
  fr(lang) ? `${unitsT(qty, lang)} · ${projects} ${projects === 1 ? 'projet' : 'projets'}` : totalQuantityText(qty, projects);

/** Lead time in the table ("9 wks" / "9 sem.") and in the record ("9 weeks" / "9 semaines"). */
export const leadShortT = (weeks: number | null, t: T) => t(leadShortText(weeks));
export const leadLongT = (weeks: number | null, t: T) => t(leadLongText(weeks));

/** Stock row sub-line part: "4 reserved · HLT" / "4 réservés · HLT". */
export function reservedT(n: number, project: string | null, lang: Lang): string {
  const base = fr(lang) ? `${qtyT(n, lang)} réservé${n > 1 ? 's' : ''}` : `${qtyT(n, lang)} reserved`;
  return project ? `${base} · ${project}` : base;
}

/** Below-minimum hint: "below min. 8" / "sous le min. 8". */
export const belowMinT = (min: number, lang: Lang) => (fr(lang) ? `sous le min. ${qtyT(min, lang)}` : `below min. ${qtyT(min, lang)}`);

/** Stock row quantity: "12 in stock" / "12 en stock". */
export const inStockT = (n: number, lang: Lang) => (fr(lang) ? `${qtyT(n, lang)} en stock` : `${qtyT(n, lang)} in stock`);

/** Revision step "rev B → rev C" / "rév. B → rév. C". */
export const revStepT = (from: string, to: string, lang: Lang) => (fr(lang) ? `rév. ${from} → rév. ${to}` : `rev ${from} → rev ${to}`);
/** "rev C" / "rév. C". */
export const revT = (rev: string, lang: Lang) => (fr(lang) ? `rév. ${rev}` : `rev ${rev}`);

/** New part form labels whose French differs from the shared dictionary entry. */
const FORM_FR: Record<string, string> = { Unit: 'Unité' };
/** Form label of the New part / Register equivalent dialogs. */
export const formLabelT = (label: string, t: T, lang: Lang) => (fr(lang) && Object.hasOwn(FORM_FR, label) ? FORM_FR[label] : t(label));

/** "EL-VFD-200 already exists in the catalogue" / "EL-VFD-200 existe déjà dans le catalogue". */
export const duplicateRefT = (ref: string, lang: Lang) => (fr(lang) ? `${ref} existe déjà dans le catalogue` : `${ref} already exists in the catalogue`);

/** "Equivalent registered · KS-STL-0450B". */
export const equivalentRegisteredT = (ref: string, t: T) => `${t('Equivalent registered')} · ${ref}`;
