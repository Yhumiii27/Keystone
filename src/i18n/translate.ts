// Translation engine ported from the prototype (trFR / frSeg, design file lines 3755-3756).
// UI strings are authored in English — exactly as in the prototype — and rendered in French
// through the FR dictionary (exact match), the parameterised FR_RULES, and per-segment
// translation on " · ", " — ", " → ", " / " with month/day names.
import FR_DICT_BASE from './fr-dict.json';
import { FR_DAYS, FR_MONTHS, FR_RULES } from './fr-rules';
import { EXTRA_FR } from './extra';

export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];
export const DEFAULT_LANG: Lang = 'fr';

const FR_DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };

const MONTH_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;
const DAY_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Yesterday)\b/g;

function frSeg(s: string): string {
  const exact = FR_DICT[s];
  if (exact != null) return exact;
  let out = s;
  for (const [re, rep] of FR_RULES) {
    if (re.test(out)) {
      out = out.replace(re, rep);
      break;
    }
  }
  return out
    .replace(MONTH_RE, (m) => FR_MONTHS[m])
    .replace(DAY_RE, (m) => FR_DAYS[m])
    .replace(/\bToday\b/g, 'Aujourd’hui')
    .replace(/\btoday\b/g, 'aujourd’hui')
    .replace(/\byesterday\b/g, 'hier');
}

export function trFR(s: string): string {
  if (!s) return s;
  const exact = FR_DICT[s];
  if (exact != null) return exact;
  if (/^[\s\d.,%€$+−–\-]*$/.test(s)) return s;
  for (const [re] of FR_RULES) {
    if (
      re.test(s) &&
      / · | — /.test(s) &&
      re.source.startsWith('^') &&
      re.source.endsWith('$') &&
      !re.source.startsWith('^(.+)')
    )
      return frSeg(s);
  }
  const parts = s.split(/( · | — | → | \/ )/);
  if (parts.length > 1) return parts.map((p, i) => (i % 2 ? p : frSeg(p))).join('');
  return frSeg(s);
}

export type T = (english: string) => string;

/** Returns the translator for a language. English is the identity. */
export function makeT(lang: Lang): T {
  return lang === 'fr' ? trFR : (s) => s;
}

/** Locale used by Intl formatters. */
export const intlLocale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');
