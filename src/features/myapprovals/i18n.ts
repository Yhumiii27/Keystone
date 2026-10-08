// My approvals translation helper. English stays the prototype's source text; the shared engine (prototype
// dictionary + FR_RULES + src/i18n/extra/myapprovals.json) does the rest. One fix kept local to this screen:
// the change-request sub line ends with signed day counts written as the prototype does ("-12 d", ASCII hyphen,
// apprItems 4726), which the shared FR rule `^([+−]?\d+) d$` misses inside a " · " line → "j" in French, as on
// Change control (src/features/changes/i18n.ts) and Plan / Schedule (05 OQ23).
import type { Lang, T } from '@/i18n/translate';

/** Signed day count closing a " · " segment: "+27 d", "-12 d", "−12 d". */
const SIGNED_DAYS = /(^|\s)([+\-−]\d+) d(?=$|\s·)/g;

/** "Budget · Planning · +85 k€ · -12 d" → "… · -12 j" (French only; applied to the translated text). */
export const daysFr = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(SIGNED_DAYS, '$1$2 j') : s);

/** `t` of the inbox: the shared engine, then the French day unit. English is the identity. */
export const inboxT = (t: T, lang: Lang): T => (lang === 'fr' ? (s) => daysFr(t(s), lang) : t);
