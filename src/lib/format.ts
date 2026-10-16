// Formatting helpers ported from the prototype (docs/spec/01 §14). Pure and locale-aware.
import type { Lang } from '@/i18n/translate';

export type Currency = 'EUR' | 'USD';

export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Minus sign used by the prototype (U+2212). */
export const MINUS = '−';

/**
 * Amounts stored in thousands (k€). `money(4800)` → "€4.80M" / FR "4,80 M€";
 * `money(-27, true)` → "−€27k" / "−27 k€"; `money(160, true)` → "+€160k" / "+160 k€".
 * USD only swaps the symbol (FR + USD renders like EN).
 */
export function money(k: number, lang: Lang, opts: { signed?: boolean; currency?: Currency } = {}): string {
  const eur = (opts.currency ?? 'EUR') === 'EUR';
  const sym = eur ? '€' : '$';
  const a = Math.abs(k);
  const sign = k < 0 ? MINUS : opts.signed && k > 0 ? '+' : '';
  if (lang === 'fr' && eur)
    return a >= 1000 ? `${sign}${(a / 1000).toFixed(2).replace('.', ',')} M€` : `${sign}${Math.round(a)} k€`;
  return a >= 1000 ? `${sign}${sym}${(a / 1000).toFixed(2)}M` : `${sign}${sym}${Math.round(a)}k`;
}

/** Full euros (part prices, PO values): "€4,700" / "4 700 €". Always €. */
export function moneyEur(v: number, lang: Lang): string {
  return lang === 'fr'
    ? Math.round(v).toLocaleString('fr-FR') + ' €'
    : '€' + Math.round(v).toLocaleString('en-US');
}

/** One-decimal percentage string, mostly used for CSS widths: pct(.6438) → "64.4%". */
export const pct = (v: number) => Math.round(v * 1000) / 10 + '%';

/** Two-decimal ratio (CPI/SPI). Not localised, as in the prototype. */
export const ratio = (v: number) => v.toFixed(2);

/** Month offset from 1 Jan 2026 → "14 Jan ’27" (English; translate with t()). */
export function dateOf(m: number): string {
  const y = m >= 12 ? 2027 : 2026;
  const mm = Math.floor(m % 12);
  const d = Math.max(1, Math.round((m - Math.floor(m)) * 30));
  return d + ' ' + MO[mm] + (y === 2027 ? ' ’27' : '');
}

export const monthDate = (m: number) => new Date(2026 + Math.floor(m / 12), m % 12, 1 + Math.round((m - Math.floor(m)) * 27));
/** "12 Nov", "14 Jan ’27", "3 Mar ’28": the year suffix of the actual year after 2026 (L-8, R-136: the prototype always wrote ’27). */
export const fmtD = (dt: Date) => dt.getDate() + ' ' + MO[dt.getMonth()] + (dt.getFullYear() > 2026 ? ' ’' + String(dt.getFullYear()).slice(-2) : '');
export const fmtDY = (dt: Date) => dt.getDate() + ' ' + MO[dt.getMonth()] + ' ' + dt.getFullYear();
export const monthLabels = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => MO[(start + i) % 12] + (start + i >= 12 && (start + i) % 12 === 0 ? ' ’27' : ''));

/** "Dec 2026" / "14 Jan 2027" → month index since Jan 2026; '—' → null. */
export function mIdx(str: string | null | undefined): number | null {
  if (!str || str === '—') return null;
  const p = str.trim().split(/\s+/);
  let d = 1;
  let mon: string;
  let y: number;
  if (p.length === 3) [d, mon, y] = [parseInt(p[0], 10), p[1], parseInt(p[2], 10)];
  else [mon, y] = [p[0], parseInt(p[1], 10)];
  const m = MO.indexOf(mon.slice(0, 3) as (typeof MO)[number]);
  if (m < 0 || isNaN(y)) return null;
  return (y - 2026) * 12 + m + (d - 1) / 30;
}

/**
 * Prototype `dayDate` (3266). Same result for o ≥ 0; negative offsets (the weeks before 21 Sep — older tasks, the
 * My work calendar's previous weeks) use a floored remainder so −1 is Fri 18 Sep, not the prototype's Sun 13 Sep.
 */
export const dayDate = (o: number) => new Date(2026, 8, 21 + Math.floor(o / 5) * 7 + (o - Math.floor(o / 5) * 5));
export const dayLabel = (o: number) => {
  const d = dayDate(o);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()];
};


/** "5 Oct 2026" / "5 Oct" (in the business year `year`, R-013; the prototype's 2026) → local Date; null when unparseable. */
export const wbsParseDate = (s: string | null | undefined, year: number) => {
  const p = String(s || '').trim().split(/\s+/);
  const d = parseInt(p[0], 10);
  const m = MO.indexOf((p[1] || '').slice(0, 3) as (typeof MO)[number]);
  return isNaN(d) || m < 0 ? null : new Date(p[2] ? parseInt(p[2], 10) : year, m, d);
};
/** "05 Oct" / "14 Jan ’27": the year suffix outside the business year `year` (R-013; the prototype compared with 2026). */
export const wbsFmtDate = (d: Date, year: number) =>
  String(d.getDate()).padStart(2, '0') + ' ' + MO[d.getMonth()] + (d.getFullYear() !== year ? ' ’' + String(d.getFullYear()).slice(2) : '');

/** First letter of each word: "Marie Lefebvre" → "ML". */
export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .join('');

/** "Romain Aubert" → "R. Aubert" (how the prototype stores project managers). */
export const shortName = (name: string) => {
  const [first, ...rest] = name.split(' ');
  return rest.length ? `${first[0]}. ${rest.join(' ')}` : name;
};
