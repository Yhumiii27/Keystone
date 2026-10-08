// Translation helpers of the Change orders and Drawings screens. English stays the prototype's source text; the shared
// engine (prototype dictionary + FR_RULES + src/i18n/extra/eco.json) does the rest. Local fixes:
// - signed day counts written as the prototype does ("-6 d", ASCII hyphen) take the French unit "j", which the shared
//   rule only applies to "+6 d" (same fix as My approvals and Change control, 05 OQ23);
// - texts that come from Vigie (ECO titles, stock impact, documents, notes) are translated on an exact dictionary
//   match only, so a French text typed in Vigie is never altered and an English one is never half-translated
//   ("None — not yet ordered" → "Aucun — not yet ordered" in the prototype);
// - parameterised sentences the rule engine does not cover (vault sync result, progress toasts).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };

/** Signed day count, alone or closing a " · " segment: "-6 d", "+6 d", "−6 d". */
const SIGNED_DAYS = /(^|\s)([+\-−]\d+) d(?=$|\s·)/g;
export const daysFr = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(SIGNED_DAYS, '$1$2 j') : s);

/** `t` of the two screens: the shared engine, then the French day unit. English is the identity. */
export const ecoT = (t: T, lang: Lang): T => (lang === 'fr' ? (s) => daysFr(t(s), lang) : t);

/** Data text from Vigie or the PDM vault: FR only on an exact dictionary match. */
export const dataText = (s: string, lang: Lang) => (lang === 'fr' && s && Object.hasOwn(DICT, s) ? DICT[s] : s);

/** "Vault synchronised · 6 drawings updated" (AF_RESULT.drawings) with the real count. */
export function vaultSyncedText(n: number, lang: Lang): string {
  if (lang === 'fr') return `Coffre synchronisé · ${n} ${n > 1 ? 'plans mis à jour' : 'plan mis à jour'}`;
  return `Vault synchronised · ${n} ${n === 1 ? 'drawing updated' : 'drawings updated'}`;
}
