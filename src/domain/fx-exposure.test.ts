// R-162 (P4, D9-34) — value tests of the FX exposure rules.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import {
  FX_THRESHOLDS_STANDARD, fxAlertTitle, parseFxThreshold, parseRate, parseReferenceRate, projectFxExposure, referenceRateOn, usableFxThresholds, type ReferenceRate,
} from './fx-exposure';

const today = DEMO_TODAY_ISO; // 2026-09-25
const RATES: ReferenceRate[] = [
  { currency: 'USD', rate: 0.9, validFrom: '2026-01-01' },
  { currency: 'USD', rate: 0.85, validFrom: '2026-09-01' },
  { currency: 'USD', rate: 0.8, validFrom: '2026-10-01' },
  { currency: 'GBP', rate: 1.15, validFrom: '2026-06-01' },
];

describe('reference rates', () => {
  it('takes the latest rate valid on the date', () => {
    expect(referenceRateOn(RATES, 'USD', today)?.rate).toBe(0.85);
    expect(referenceRateOn(RATES, 'USD', '2026-10-01')?.rate).toBe(0.8);
    expect(referenceRateOn(RATES, 'USD', '2025-12-31')).toBeNull();
    expect(referenceRateOn(RATES, 'CHF', today)).toBeNull();
    expect(referenceRateOn(RATES, 'EUR', today)?.rate).toBe(1);
  });

  it('parses the form', () => {
    expect(parseRate('0,92')).toBe(0.92);
    expect(parseRate('0')).toBeNull();
    expect(parseRate('-1')).toBeNull();
    expect(parseReferenceRate({ currency: 'USD', rate: '0.91' }, today)).toEqual({ ok: true, value: { currency: 'USD', rate: 0.91, validFrom: today } });
    expect(parseReferenceRate({ currency: 'EUR', rate: '1' }, today)).toEqual({ ok: false, error: 'currency' });
    expect(parseReferenceRate({ currency: 'XYZ', rate: '1' }, today)).toEqual({ ok: false, error: 'currency' });
    expect(parseReferenceRate({ currency: 'USD', rate: 'abc' }, today)).toEqual({ ok: false, error: 'rate' });
    expect(parseReferenceRate({ currency: 'USD', rate: '1', validFrom: '2026-13-01' }, today)).toEqual({ ok: false, error: 'date' });
  });
});

describe('thresholds', () => {
  it('defaults and bounds', () => {
    expect(usableFxThresholds(null)).toEqual(FX_THRESHOLDS_STANDARD);
    expect(usableFxThresholds({ exposureKeur: 250, driftPct: 'x' })).toEqual({ exposureKeur: 250, driftPct: 5 });
    expect(parseFxThreshold('driftPct', '2,5')).toBe(2.5);
    expect(parseFxThreshold('driftPct', '0')).toBeNull();
    expect(parseFxThreshold('exposureKeur', '0')).toBeNull();
    expect(parseFxThreshold('exposureKeur', '750.4')).toBe(750);
  });
});

describe('project exposure', () => {
  const docs = {
    // 4 000 k$ contract, 1 500 invoiced, 1 000 paid → 2 500 to invoice + 500 unpaid = 3 000 receivable.
    contract: { currency: 'USD', valueKeur: 4000, invoicedKeur: 1500, paidKeur: 1000 },
    // Orders: 1 200 k$ open (200 paid), a EUR order ignored, an over-paid one counts 0.
    orders: [
      { number: 'PO-1', currency: 'USD', valueKeur: 1400, paidKeur: 200 },
      { number: 'PO-2', currency: 'EUR', valueKeur: 900, paidKeur: 0 },
      { number: 'PO-3', currency: 'USD', valueKeur: 100, paidKeur: 150 },
    ],
  };

  it('nets receivable and payable, values them at the budget and reference rates', () => {
    const x = projectFxExposure(docs, { currency: 'USD', budgetRate: 0.92 }, RATES, FX_THRESHOLDS_STANDARD, today);
    expect(x.currencies).toEqual([{
      currency: 'USD', toInvoiceKeur: 2500, invoicedUnpaidKeur: 500, receivableKeur: 3000, payableKeur: 1200, netKeur: 1800,
      budgetRate: 0.92, referenceRate: 0.85, referenceFrom: '2026-09-01',
      netAtBudgetKeur: 1656, netAtReferenceKeur: 1530, gainLossKeur: -126, driftPct: -7.6,
    }]);
    // 1 530 k€ ≥ 500 k€ and |−7.6 %| ≥ 5 %: both alerts.
    expect(x.alerts).toEqual([{ kind: 'exposure', currency: 'USD' }, { kind: 'drift', currency: 'USD' }]);
    expect(fxAlertTitle('exposure', 'HLT-026', x.currencies[0])).toBe('FX exposure above threshold · HLT-026 · USD · 1530 k€');
    expect(fxAlertTitle('drift', 'HLT-026', x.currencies[0])).toBe('Exchange rate drift above threshold · HLT-026 · USD · -7.6 %');
  });

  it('no alert under the thresholds; a closed position raises no drift alert', () => {
    const small = { contract: { currency: 'USD', valueKeur: 300, invoicedKeur: 0, paidKeur: 0 }, orders: [] };
    const x = projectFxExposure(small, { currency: 'USD', budgetRate: 0.86 }, RATES, FX_THRESHOLDS_STANDARD, today);
    expect(x.currencies[0]).toMatchObject({ netKeur: 300, netAtReferenceKeur: 255, driftPct: -1.2 });
    expect(x.alerts).toEqual([]);
    const closed = { contract: { currency: 'USD', valueKeur: 300, invoicedKeur: 300, paidKeur: 300 }, orders: [] };
    expect(projectFxExposure(closed, { currency: 'USD', budgetRate: 1.2 }, RATES, FX_THRESHOLDS_STANDARD, today).alerts).toEqual([]);
  });

  it('a euro project has no exposure; without a reference rate the budget rate values it and no drift is computed', () => {
    expect(projectFxExposure({ contract: { currency: 'EUR', valueKeur: 5000, invoicedKeur: 0, paidKeur: 0 }, orders: [] }, { currency: 'EUR', budgetRate: null }, RATES, FX_THRESHOLDS_STANDARD, today))
      .toEqual({ currencies: [], alerts: [] });
    const x = projectFxExposure({ contract: { currency: 'CHF', valueKeur: 1000, invoicedKeur: 0, paidKeur: 0 }, orders: [] }, { currency: 'CHF', budgetRate: 1.05 }, RATES, FX_THRESHOLDS_STANDARD, today);
    expect(x.currencies[0]).toMatchObject({ referenceRate: null, netAtBudgetKeur: 1050, netAtReferenceKeur: 1050, gainLossKeur: null, driftPct: null });
    expect(x.alerts).toEqual([{ kind: 'exposure', currency: 'CHF' }]);
  });
});
