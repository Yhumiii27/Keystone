// Contract & Billing translation helpers. English stays the prototype's source text (docs/spec/04 §3–4); the
// shared t() renders the French (prototype dictionary + rules + src/i18n/extra/contract.json).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang } from '@/i18n/translate';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };

/**
 * Text typed by people (amendment subjects, milestone labels and conditions, invoice notes, guarantee issuers):
 * French only on an exact dictionary match (the seeded prototype strings such as "Permits approved"). The segment /
 * month / rule engine is not applied, so typed text is never half-translated ("Mar works" → "mars works").
 */
export const dataText = (s: string, lang: Lang) => (lang === 'fr' && s && Object.hasOwn(DICT, s) ? DICT[s] : s);
