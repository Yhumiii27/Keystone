// C-9 (R-075): amount columns of the exports in the document's currency.
import { describe, expect, it } from 'vitest';
import { commonCurrency, moneyCol } from './currency-columns';

describe('export amount columns per currency', () => {
  it('EUR documents keep the € column types; others export a number with the currency in the header', () => {
    expect(moneyCol('amount', 'Amount', 'EUR', 'k')).toEqual({ key: 'amount', header: 'Amount', type: 'money_keur' });
    expect(moneyCol('unit', 'Unit price', 'EUR', 'units', 12)).toEqual({ key: 'unit', header: 'Unit price', type: 'money_eur', width: 12 });
    expect(moneyCol('amount', 'Amount', 'USD', 'k')).toEqual({ key: 'amount', header: 'Amount (k USD)', type: 'number', decimals: 0 });
    expect(moneyCol('unit', 'Prix unitaire', 'CHF', 'units', 12)).toEqual({ key: 'unit', header: 'Prix unitaire (CHF)', type: 'number', width: 12, decimals: 2 });
  });

  it('one currency for a list of documents, or null when they mix', () => {
    expect([commonCurrency([]), commonCurrency(['EUR', 'EUR']), commonCurrency(['USD']), commonCurrency(['EUR', 'USD'])]).toEqual(['EUR', 'EUR', 'USD', null]);
  });
});
