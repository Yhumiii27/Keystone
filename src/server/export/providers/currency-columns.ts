// C-9 (R-075) in the exports: an amount column of a document in another currency than the euro (contract, purchase order,
// supplier invoice) is exported in that currency — a plain number with the currency in the header ("Amount (k USD)",
// "Unit price (USD)") — never with the € formats of the euro columns. EUR documents keep the € column types unchanged.
// R-046 (NEW-D2-1): every amount column built here is marked `price` — in any currency — so that a priced provider drops it for
// a viewer who may not see supplier prices (the € types alone no longer identify an amount once a document is in USD).
import type { CurrencyCode } from '@/domain/currency';
import type { ExportColumn } from '../types';
import { col } from './common';

/** Amount column of a document in `currency`: thousands (`k`) or full units (`units`). */
export function moneyCol(key: string, header: string, currency: CurrencyCode, unit: 'k' | 'units', width?: number): ExportColumn {
  if (currency === 'EUR') return col(key, header, unit === 'k' ? 'money_keur' : 'money_eur', width, { price: true });
  return col(key, `${header} (${unit === 'k' ? 'k ' : ''}${currency})`, 'number', width, { decimals: unit === 'k' ? 0 : 2, price: true });
}

/**
 * Amount column of several documents: `moneyCol` in their common currency, or — when they mix currencies (`currency` null,
 * see `commonCurrency`) — a plain number whose currency a Currency column gives row by row. A price column either way.
 */
export function amountsCol(key: string, header: string, currency: CurrencyCode | null, unit: 'k' | 'units', width?: number): ExportColumn {
  if (currency) return moneyCol(key, header, currency, unit, width);
  return col(key, header, 'number', width, { decimals: unit === 'k' ? 0 : 2, price: true });
}

/** Single currency of several documents, or null when they mix currencies (the export then adds a currency column). */
export function commonCurrency(currencies: readonly CurrencyCode[]): CurrencyCode | null {
  const set = new Set(currencies);
  return set.size <= 1 ? (currencies[0] ?? 'EUR') : null;
}
