// C-9 (owner answer b, R-075): one currency per contract, purchase order and invoice; totals consolidated in euros at a
// budget rate fixed for each project. Pure rules and formatting:
// - a project has a currency (`projects.currency`, EUR when null) and, when it is not EUR, a budget rate (euros per unit,
//   set by the portfolio director);
// - a document of the project (contract, purchase order, supplier or customer invoice) is in EUR or in the project currency;
//   its amounts stay in that currency on the document's own screens and are converted with `toEur` wherever the portfolio
//   is consolidated (Budget › Cash & recovery, Cash flow, Prioritisation, portfolio margin, alerts);
// - the write rules (src/server/dal/currency.ts) refuse a non-EUR document while the project has no budget rate, so the
//   conversion always has a rate (a stale row without one counts at par, `eurRate`).
// Golden values: src/domain/currency.test.ts.
import type { Lang } from '@/i18n/translate';
import { MINUS, money, moneyEur } from '@/lib/format';

/** Currencies a project, contract or order may use (ISO 4217). EUR is the consolidation currency. */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'SGD', 'ZAR', 'MAD', 'AED'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: CurrencyCode = 'EUR';

export const isCurrency = (v: unknown): v is CurrencyCode => typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
/** Stored currency → code; null, empty or unknown → EUR (the seed and every project created before C-9). */
export const currencyOf = (v: string | null | undefined): CurrencyCode => (isCurrency(v) ? v : BASE_CURRENCY);

/** Symbols printed before (EN) or after (FR) the amount; other currencies print their code. */
const SYMBOL: Partial<Record<CurrencyCode, string>> = { EUR: '€', USD: '$', GBP: '£' };

/** Project currency and budget rate (euros per unit of the project currency; null = not set). */
export interface ProjectFx {
  currency: CurrencyCode;
  budgetRate: number | null;
}

export const EUR_FX: ProjectFx = { currency: BASE_CURRENCY, budgetRate: null };

/** Project currency and rate as stored (`projects.currency`, `projects.budget_rate`). */
export const projectFxOf = (p: { currency?: string | null; budgetRate?: number | null }): ProjectFx => ({
  currency: currencyOf(p.currency),
  budgetRate: p.budgetRate != null && Number.isFinite(p.budgetRate) && p.budgetRate > 0 ? p.budgetRate : null,
});

/** Currencies a document of the project may use: EUR, and the project currency when it is another one. */
export const documentCurrencies = (fx: ProjectFx): CurrencyCode[] => (fx.currency === BASE_CURRENCY ? [BASE_CURRENCY] : [BASE_CURRENCY, fx.currency]);

/**
 * Euros per unit of `currency` for a project: 1 for EUR; the budget rate for the project currency; null when the rate is not
 * set or the currency is neither (the write rules prevent both).
 */
export function rateToEur(currency: string | null | undefined, fx: ProjectFx): number | null {
  const c = currencyOf(currency);
  if (c === BASE_CURRENCY) return 1;
  return c === fx.currency ? fx.budgetRate : null;
}

/** Why a document of the project cannot use `currency` (EN source), null when it can. */
export function documentCurrencyError(currency: unknown, fx: ProjectFx): string | null {
  if (!isCurrency(currency)) return 'Unknown currency';
  if (currency === BASE_CURRENCY) return null;
  if (currency !== fx.currency) return 'A document is in euros or in the project currency';
  if (fx.budgetRate == null) return 'Ask the portfolio director to set the project’s budget rate first';
  return null;
}

/** Rate actually applied by the consolidation: the budget rate, or 1 for a stale row without one (see header). */
export const eurRate = (currency: string | null | undefined, fx: ProjectFx) => rateToEur(currency, fx) ?? 1;

/** An amount of a document converted to euros at the project's budget rate (same unit: k → k€, units → €). */
export const toEur = (amount: number, currency: string | null | undefined, fx: ProjectFx) => amount * eurRate(currency, fx);

// ── Budget rate input ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bounds of a budget rate (euros per unit): guards a rate typed the wrong way round for most currencies. */
export const MIN_BUDGET_RATE = 0.0001;
export const MAX_BUDGET_RATE = 10_000;

/** A budget rate as typed ("0.92", "0,92"): positive, ≤ 10 000, rounded to 6 decimals; null when invalid. */
export function parseBudgetRate(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/[\s  ]/g, '').replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(Number(s) * 1e6) / 1e6;
  return v >= MIN_BUDGET_RATE && v <= MAX_BUDGET_RATE ? v : null;
}

/** "1 USD = 0.92 €" (EN) / "1 USD = 0,92 €" (FR); "—" without a rate. */
export function budgetRateText(fx: ProjectFx, lang: Lang): string {
  if (fx.currency === BASE_CURRENCY) return '1 € = 1 €';
  if (fx.budgetRate == null) return '—';
  const r = String(fx.budgetRate);
  return `1 ${fx.currency} = ${lang === 'fr' ? r.replace('.', ',') : r} €`;
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Unit suffix of the thousands in a label: "k€", "k$", "k£", "k CHF". */
export const thousandsUnit = (currency: CurrencyCode) => 'k' + (SYMBOL[currency] ?? ' ' + currency);

/**
 * Thousands of `currency`, like `money()`: EUR is exactly `money()` ("€4.80M" / "4,80 M€"); "$1.20M" / "1,20 M$"; "CHF 450k" /
 * "450 k CHF". Signed: "+" / "−" (U+2212).
 */
export function moneyIn(k: number, currency: CurrencyCode, lang: Lang, opts: { signed?: boolean } = {}): string {
  if (currency === BASE_CURRENCY) return money(k, lang, opts);
  const sym = SYMBOL[currency];
  const a = Math.abs(k);
  const sign = k < 0 ? MINUS : opts.signed && k > 0 ? '+' : '';
  const big = a >= 1000;
  if (lang === 'fr') {
    const n = big ? `${(a / 1000).toFixed(2).replace('.', ',')} M` : `${Math.round(a)} k`;
    return `${sign}${n}${sym ?? ' ' + currency}`;
  }
  const n = big ? `${(a / 1000).toFixed(2)}M` : `${Math.round(a)}k`;
  return `${sign}${sym ?? currency + ' '}${n}`;
}

/** Full units of `currency`, like `moneyEur()`: "€4,700" / "4 700 €"; "$4,700" / "4 700 $"; "CHF 4,700" / "4 700 CHF". */
export function moneyUnitsIn(v: number, currency: CurrencyCode, lang: Lang): string {
  if (currency === BASE_CURRENCY) return moneyEur(v, lang);
  const sym = SYMBOL[currency];
  if (lang === 'fr') return `${Math.round(v).toLocaleString('fr-FR')} ${sym ?? currency}`;
  return `${sym ?? currency + ' '}${Math.round(v).toLocaleString('en-US')}`;
}

/** "≈ €5.08M" — the euro equivalent of an amount at the budget rate (shown next to amounts in another currency); '' in EUR. */
export function eurEquivalentText(k: number, currency: CurrencyCode, fx: ProjectFx, lang: Lang): string {
  if (currency === BASE_CURRENCY) return '';
  const r = rateToEur(currency, fx);
  return r == null ? '' : `≈ ${money(k * r, lang)}`;
}
