// Project BOM translation helpers. English stays the prototype's source text (docs/spec/09 §1); the French comes from
// the prototype dictionary through t(), with these local forms:
// - quantities are formatted in the viewer's language ("2 042" in French; the prototype used the browser locale);
// - parameterised sentences the prototype left in English in French (its deepTr skipped the `qty` and `total` keys):
//   "32 per project", "6 units", "+€19,942 per crane" (E-2b, R-104);
// - singular forms ("1 part · 1 direct child", "1 unit", "1 week") the prototype never built;
// - catalogue data is translated on exact dictionary matches only (`dataT`: part names such as "Safety PLC",
//   restriction texts, spare notes), never through the month / day / sentence rules; supplier names and manufacturer
//   references are shown as stored.
import type { Lang, T } from '@/i18n/translate';
import { MINUS, moneyEur } from '@/lib/format';
import { dataText } from '@/i18n/data-text';

const fr = (lang: Lang) => lang === 'fr';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Integer / quantity in the viewer's language ("2,042" / "2 042"). */
export const qtyText = (v: number, lang: Lang) => v.toLocaleString(fr(lang) ? 'fr-FR' : 'en-US');

/**
 * Register data (names, descriptions, notes typed in Keystone or received): as typed, or a seeded string's exact
 * dictionary entry — never segment by segment (R-148, NEW-D1-2: the shared helper, src/i18n/data-text.ts).
 */
export const dataT = (s: string, lang: Lang): string => dataText(s, lang);

/** KPI sub "2,042 units in total". */
export const unitsInTotalText = (n: number, lang: Lang) => (fr(lang) ? `${qtyText(n, lang)} unités au total` : `${qtyText(n, lang)} units in total`);

/** Where-used projects "32 units" (singular "1 unit"). */
export const unitsText = (n: number, lang: Lang) =>
  fr(lang) ? `${qtyText(n, lang)} ${plural(n, 'unité', 'unités')}` : `${qtyText(n, lang)} ${plural(n, 'unit', 'units')}`;

/** Where-used paths "32 per project". */
export const perProjectText = (n: number, lang: Lang) => (fr(lang) ? `${qtyText(n, lang)} par projet` : `${qtyText(n, lang)} per project`);

/** Lead time in tables "9 wks" ("9 sem."); "—" when none. */
export const wksText = (n: number | null, lang: Lang) => (n ? (fr(lang) ? `${n} sem.` : `${n} wks`) : '—');

/** Lead time in the node drawer "8 weeks" (singular "1 week"); "—" when none. */
export const weeksText = (n: number | null, lang: Lang) =>
  n ? (fr(lang) ? `${n} ${plural(n, 'semaine', 'semaines')}` : `${n} ${plural(n, 'week', 'weeks')}`) : '—';

/** Node drawer "Components": "21 parts · 4 direct children" (singular forms), or "Leaf part". */
export function componentsText(leaves: number, children: number, t: T, lang: Lang): string {
  if (!children) return t('Leaf part');
  return fr(lang)
    ? `${leaves} ${plural(leaves, 'article', 'articles')} · ${children} ${plural(children, 'enfant direct', 'enfants directs')}`
    : `${leaves} ${plural(leaves, 'part', 'parts')} · ${children} ${plural(children, 'direct child', 'direct children')}`;
}

/** PU/PR stock cell "16 in stock" / "None in stock". */
export const stockText = (n: number, t: T, lang: Lang) => (n > 0 ? (fr(lang) ? `${qtyText(n, lang)} en stock` : `${qtyText(n, lang)} in stock`) : t('None in stock'));

/** Signed full-euro amount "+€13,600" / "−€42" ("+13 600 €"). */
export const signedEur = (v: number, lang: Lang) => (v >= 0 ? '+' : MINUS) + moneyEur(Math.abs(v), lang);

/** Compare revisions total "+€19,942 per crane" ("+19 942 € par grue"; E-2b, R-104). */
export const perCraneText = (v: number, lang: Lang) => `${signedEur(v, lang)} ${fr(lang) ? 'par grue' : 'per crane'}`;

/** PU/PR KPI sub "4 wear · 8 spare". */
export const wearSpareText = (wear: number, spare: number, lang: Lang) => (fr(lang) ? `${wear} usure · ${spare} rechange` : `${wear} wear · ${spare} spare`);

/** PU/PR KPI sub "At last purchase price · × 2 systems". */
export const systemsText = (n: number, t: T) => t(`At last purchase price · × ${n} ${n > 1 ? 'systems' : 'system'}`);

/** Pinned spare "Keep for the installed base · 2 machines · ECO-2026-014". */
export const keepForInstalledBaseText = (machines: number, ecos: readonly string[], t: T) =>
  t(`Keep for the installed base · ${machines} ${plural(machines, 'machine', 'machines')} · ${ecos.join(', ')}`);

/** Flat list count "35 / 35 articles". */
export const countText = (shown: number, total: number, t: T) => t(`${shown} / ${total} articles`);

/** Flat list card title "Bill of materials · 35 articles". */
export const bomTitleText = (n: number, t: T) => t(`Bill of materials · ${n} ${plural(n, 'article', 'articles')}`);
