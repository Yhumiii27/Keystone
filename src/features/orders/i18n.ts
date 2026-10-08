// Purchase orders translation helpers (docs/spec/08 §2, 08 OQ26). English stays the prototype's source text; the
// French of the parameterised sentences is built here because the prototype's rules leave them half English
// ("2 lines · 98 unités", "1 ligne(s) · 180 units · part status issue", untranslated part-status warning), and both
// languages get their singular forms ("1 order in total", "1 unit"). Quantities follow the language (the prototype
// used the browser's locale).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';
import type { PartStatus } from '@/server/db/codes';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };
const exact = (s: string) => (Object.hasOwn(DICT, s) ? DICT[s] : s);
const fr = (lang: Lang) => lang === 'fr';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Register data (supplier names, part names, delivery terms) in the viewer's language: exact dictionary matches only,
 * whole text then each " · " / " — " segment — never the month / day rules, which would rewrite names.
 */
export function dataT(s: string, lang: Lang): string {
  if (!fr(lang) || !s) return s;
  if (Object.hasOwn(DICT, s)) return DICT[s];
  return s
    .split(/( · | — )/)
    .map((p, i) => (i % 2 ? p : exact(p)))
    .join('');
}

/** Quantity with the language's grouping ("6,214" / "6 214"). */
export const qtyText = (n: number, lang: Lang) => n.toLocaleString(fr(lang) ? 'fr-FR' : 'en-US');

/** "Articles" line 2: "2 lines · 688 units" (+ " · part status issue"). */
export function lineCountText(lines: number, units: number, issue: boolean, lang: Lang): string {
  const q = qtyText(units, lang);
  if (fr(lang)) return `${lines} ${plural(lines, 'ligne', 'lignes')} · ${q} ${plural(units, 'unité', 'unités')}${issue ? ' · problème de statut article' : ''}`;
  return `${lines} ${plural(lines, 'line', 'lines')} · ${q} ${plural(units, 'unit', 'units')}${issue ? ' · part status issue' : ''}`;
}

/** KPI "Open orders" sub: "6 orders in total". */
export const ordersInTotalText = (n: number, lang: Lang) =>
  fr(lang) ? `${n} ${plural(n, 'commande', 'commandes')} au total` : `${n} ${plural(n, 'order', 'orders')} in total`;

/** Shortfall banner title: "15 BOM articles are not fully ordered" / "1 BOM article is not fully ordered". */
export const shortfallTitleText = (n: number, lang: Lang) =>
  fr(lang)
    ? n === 1
      ? '1 article de nomenclature pas entièrement commandé'
      : `${n} articles de nomenclature pas entièrement commandés`
    : `${n} ${n === 1 ? 'BOM article is' : 'BOM articles are'} not fully ordered`;

const PART_STATUS_FR: Record<Exclude<PartStatus, 'validated'>, string> = { not_validated: 'non validé', outdated: 'périmé', obsolete: 'obsolète' };
const PART_STATUS_EN: Record<Exclude<PartStatus, 'validated'>, string> = { not_validated: 'not validated', outdated: 'outdated', obsolete: 'obsolete' };

/** Drawer warning: "FD-DET-OPT is outdated · … — resolve in PLM before this order is released." */
export function partWarningText(ws: readonly { ref: string; status: PartStatus }[], lang: Lang): string {
  const bad = ws.filter((w): w is { ref: string; status: Exclude<PartStatus, 'validated'> } => w.status !== 'validated');
  if (!bad.length) return '';
  if (fr(lang)) return bad.map((w) => `${w.ref} est ${PART_STATUS_FR[w.status]}`).join(' · ') + ' — à résoudre dans le PLM avant la libération de cette commande.';
  return bad.map((w) => `${w.ref} is ${PART_STATUS_EN[w.status]}`).join(' · ') + ' — resolve in PLM before this order is released.';
}

/** Shortfall chip "KS-PLT-S355 · 192 to order". */
export const toOrderText = (ref: string, need: number, t: T, lang: Lang) => `${ref} · ${qtyText(need, lang)} ${t('to order')}`;
