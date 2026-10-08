// Schedule-specific translation helpers. English stays the prototype's source text.
import type { Lang } from '@/i18n/translate';

/**
 * Slip in days, FR unit: "+15d" → "+15 j", "−15d" → "−15 j" ("—" unchanged). The prototype leaves the English
 * "d" in French (docs/spec/05 OQ 23: "+15d" partly untranslated); same rule as the Plan screen's `daysText`.
 */
export const slipText = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/([+\-−]?\d+)d\b/g, '$1 j') : s);
