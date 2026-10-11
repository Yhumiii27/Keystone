// C-9 (R-075): amount columns of the exports in the document's currency.
import { describe, expect, it } from 'vitest';
import { amountsCol, commonCurrency, moneyCol } from './currency-columns';

describe('export amount columns per currency', () => {
  it('EUR documents keep the € column types; others export a number with the currency in the header', () => {
    // R-046 (NEW-D2-1): every amount column is marked `price`, in any currency, so a masked viewer never gets it (a USD
    // amount is a plain number, which the € types alone no longer identified).
    expect(moneyCol('amount', 'Amount', 'EUR', 'k')).toEqual({ key: 'amount', header: 'Amount', type: 'money_keur', price: true });
    expect(moneyCol('unit', 'Unit price', 'EUR', 'units', 12)).toEqual({ key: 'unit', header: 'Unit price', type: 'money_eur', width: 12, price: true });
    expect(moneyCol('amount', 'Amount', 'USD', 'k')).toEqual({ key: 'amount', header: 'Amount (k USD)', type: 'number', decimals: 0, price: true });
    expect(moneyCol('unit', 'Prix unitaire', 'CHF', 'units', 12)).toEqual({ key: 'unit', header: 'Prix unitaire (CHF)', type: 'number', width: 12, decimals: 2, price: true });
  });

  it('R-046: amounts of documents in mixed currencies are plain numbers, still price columns', () => {
    expect(amountsCol('value', 'Value', null, 'units')).toEqual({ key: 'value', header: 'Value', type: 'number', decimals: 2, price: true });
    expect(amountsCol('value', 'Value', 'USD', 'units')).toEqual(moneyCol('value', 'Value', 'USD', 'units'));
  });

  it('one currency for a list of documents, or null when they mix', () => {
    expect([commonCurrency([]), commonCurrency(['EUR', 'EUR']), commonCurrency(['USD']), commonCurrency(['EUR', 'USD'])]).toEqual(['EUR', 'EUR', 'USD', null]);
  });
});
