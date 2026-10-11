// C-9 (R-075): currencies of the project documents, budget rate and consolidation in euros — golden values by hand.
import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY, CURRENCIES, EUR_FX, budgetRateText, currencyOf, documentCurrencies, documentCurrencyError, eurEquivalentText, eurRate, isCurrency,
  moneyIn, moneyUnitsIn, parseBudgetRate, projectFxOf, rateToEur, thousandsUnit, toEur, type ProjectFx,
} from './currency';

const USD: ProjectFx = { currency: 'USD', budgetRate: 0.92 };
const USD_NO_RATE: ProjectFx = { currency: 'USD', budgetRate: null };

describe('currency codes and project fx', () => {
  it('known codes; stored values fall back to EUR', () => {
    expect(CURRENCIES[0]).toBe(BASE_CURRENCY);
    expect([isCurrency('USD'), isCurrency('usd'), isCurrency('XYZ'), isCurrency(null)]).toEqual([true, false, false, false]);
    expect([currencyOf('GBP'), currencyOf(null), currencyOf(''), currencyOf('XYZ')]).toEqual(['GBP', 'EUR', 'EUR', 'EUR']);
    expect(projectFxOf({ currency: 'USD', budgetRate: 0.92 })).toEqual(USD);
    expect(projectFxOf({ currency: null, budgetRate: null })).toEqual(EUR_FX);
    // A zero, negative or non-finite stored rate counts as "not set".
    expect([projectFxOf({ currency: 'USD', budgetRate: 0 }), projectFxOf({ currency: 'USD', budgetRate: -1 }), projectFxOf({ currency: 'USD', budgetRate: NaN })])
      .toEqual([USD_NO_RATE, USD_NO_RATE, USD_NO_RATE]);
  });

  it('a document is in euros or in the project currency, which needs a budget rate', () => {
    expect([documentCurrencies(EUR_FX), documentCurrencies(USD)]).toEqual([['EUR'], ['EUR', 'USD']]);
    expect(documentCurrencyError('EUR', EUR_FX)).toBeNull();
    expect(documentCurrencyError('EUR', USD)).toBeNull();
    expect(documentCurrencyError('USD', USD)).toBeNull();
    expect(documentCurrencyError('GBP', USD)).toBe('A document is in euros or in the project currency');
    expect(documentCurrencyError('USD', EUR_FX)).toBe('A document is in euros or in the project currency');
    expect(documentCurrencyError('USD', USD_NO_RATE)).toBe('Ask the portfolio director to set the project’s budget rate first');
    expect([documentCurrencyError('usd', USD), documentCurrencyError(42, USD), documentCurrencyError(undefined, USD)]).toEqual(['Unknown currency', 'Unknown currency', 'Unknown currency']);
  });
});

describe('consolidation in euros', () => {
  it('rate to EUR: 1 for euros, the budget rate for the project currency, null otherwise', () => {
    expect([rateToEur('EUR', USD), rateToEur(null, USD), rateToEur('USD', USD), rateToEur('USD', USD_NO_RATE), rateToEur('GBP', USD)]).toEqual([1, 1, 0.92, null, null]);
    // The consolidation never drops an amount: a stale row without a rate counts at par.
    expect([eurRate('USD', USD), eurRate('USD', USD_NO_RATE), eurRate('GBP', USD)]).toEqual([0.92, 1, 1]);
  });

  it('toEur keeps the unit (k → k€)', () => {
    expect(toEur(1000, 'USD', USD)).toBeCloseTo(920, 9);
    expect(toEur(5400, 'EUR', USD)).toBe(5400);
    expect(toEur(1200, 'CHF', { currency: 'CHF', budgetRate: 1.05 })).toBeCloseTo(1260, 9);
  });
});

describe('budget rate input', () => {
  it('positive decimal, comma or dot, ≤ 10 000, 6 decimals', () => {
    expect([parseBudgetRate('0.92'), parseBudgetRate('0,92'), parseBudgetRate(' 1.0745 '), parseBudgetRate(1.17), parseBudgetRate('10000')]).toEqual([0.92, 0.92, 1.0745, 1.17, 10000]);
    expect(parseBudgetRate('0.1234567')).toBe(0.123457);
    expect([parseBudgetRate('0'), parseBudgetRate('0.00001'), parseBudgetRate('-1'), parseBudgetRate('10001'), parseBudgetRate('1e3'), parseBudgetRate('abc'), parseBudgetRate(''), parseBudgetRate(null)])
      .toEqual([null, null, null, null, null, null, null, null]);
  });

  it('rate in words', () => {
    expect([budgetRateText(USD, 'en'), budgetRateText(USD, 'fr'), budgetRateText(USD_NO_RATE, 'en'), budgetRateText(EUR_FX, 'fr')]).toEqual([
      '1 USD = 0.92 €', '1 USD = 0,92 €', '—', '1 € = 1 €',
    ]);
  });
});

describe('formatting in the document currency', () => {
  it('thousands: EUR is money(); symbols before (EN) / after (FR); other currencies by code', () => {
    expect([moneyIn(4800, 'EUR', 'en'), moneyIn(4800, 'EUR', 'fr'), moneyIn(-338, 'EUR', 'en', { signed: true })]).toEqual(['€4.80M', '4,80 M€', '−€338k']);
    expect([moneyIn(1200, 'USD', 'en'), moneyIn(1200, 'USD', 'fr'), moneyIn(450, 'CHF', 'en'), moneyIn(450, 'CHF', 'fr')]).toEqual(['$1.20M', '1,20 M$', 'CHF 450k', '450 k CHF']);
    expect([moneyIn(-45, 'GBP', 'en'), moneyIn(45, 'GBP', 'fr', { signed: true }), moneyIn(0, 'USD', 'en')]).toEqual(['−£45k', '+45 k£', '$0k']);
    expect([thousandsUnit('EUR'), thousandsUnit('USD'), thousandsUnit('GBP'), thousandsUnit('CHF')]).toEqual(['k€', 'k$', 'k£', 'k CHF']);
  });

  it('full units and the euro equivalent', () => {
    expect([moneyUnitsIn(4700, 'EUR', 'en'), moneyUnitsIn(4700, 'USD', 'en'), moneyUnitsIn(4700, 'CHF', 'en')]).toEqual(['€4,700', '$4,700', 'CHF 4,700']);
    expect(moneyUnitsIn(4700, 'USD', 'fr')).toMatch(/^4\s700 \$$/u);
    expect([eurEquivalentText(5400, 'USD', USD, 'en'), eurEquivalentText(5400, 'USD', USD, 'fr'), eurEquivalentText(5400, 'EUR', USD, 'en'), eurEquivalentText(5400, 'USD', USD_NO_RATE, 'en')])
      .toEqual(['≈ €4.97M', '≈ 4,97 M€', '', '']);
  });
});
