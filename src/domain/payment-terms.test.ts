// C-6 (R-076): the contract's payment rule — due dates by hand on the calendar.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYMENT_DAYS, DEFAULT_PAYMENT_RULE, MAX_PAYMENT_DAYS, PAYMENT_RULES, isPaymentRule, parsePaymentDays, paymentDueOn, paymentTermsText, termsOfText,
} from './payment-terms';

describe('payment rule', () => {
  it('codes and defaults (the seed contract: net 45 days)', () => {
    expect(PAYMENT_RULES).toEqual(['net', 'days_eom', 'eom_days']);
    expect([isPaymentRule('net'), isPaymentRule('eom'), isPaymentRule(null)]).toEqual([true, false, false]);
    expect([DEFAULT_PAYMENT_RULE, DEFAULT_PAYMENT_DAYS, MAX_PAYMENT_DAYS]).toEqual(['net', 45, 180]);
  });

  it('net: invoice date + N days (the prototype’s termsDays) — the seed’s dates are kept', () => {
    expect(paymentDueOn('2026-09-26', { rule: 'net', days: 45 })).toBe('2026-11-10'); // INV-2026-003
    expect(paymentDueOn('2026-12-14', { rule: 'net', days: 45 })).toBe('2027-01-28'); // M4 planned
    expect(paymentDueOn('2026-01-31', { rule: 'net', days: 0 })).toBe('2026-01-31');
  });

  it('N days end of month: invoice date + N, then the last day of that month', () => {
    expect(paymentDueOn('2026-09-26', { rule: 'days_eom', days: 45 })).toBe('2026-11-30');
    expect(paymentDueOn('2026-01-10', { rule: 'days_eom', days: 30 })).toBe('2026-02-28');
    expect(paymentDueOn('2028-01-30', { rule: 'days_eom', days: 30 })).toBe('2028-02-29'); // leap year
    expect(paymentDueOn('2026-12-14', { rule: 'days_eom', days: 45 })).toBe('2027-01-31');
  });

  it('end of month + N days: last day of the invoice month, then + N', () => {
    expect(paymentDueOn('2026-09-26', { rule: 'eom_days', days: 45 })).toBe('2026-11-14');
    expect(paymentDueOn('2026-01-10', { rule: 'eom_days', days: 30 })).toBe('2026-03-02');
    expect(paymentDueOn('2026-02-03', { rule: 'eom_days', days: 0 })).toBe('2026-02-28');
    // A negative or fractional N (never stored: the sheet validates it) is clamped and rounded.
    expect(paymentDueOn('2026-02-03', { rule: 'eom_days', days: -5 })).toBe('2026-02-28');
    expect(paymentDueOn('2026-02-03', { rule: 'net', days: 1.6 })).toBe('2026-02-05');
  });

  it('terms in words, EN and FR', () => {
    expect([
      paymentTermsText({ rule: 'net', days: 45 }), paymentTermsText({ rule: 'days_eom', days: 45 }), paymentTermsText({ rule: 'eom_days', days: 30 }),
      paymentTermsText({ rule: 'eom_days', days: 0 }), paymentTermsText({ rule: 'net', days: 1 }),
    ]).toEqual(['Net 45 days', '45 days end of month', 'End of month + 30 days', 'End of month', 'Net 1 day']);
    expect([
      paymentTermsText({ rule: 'net', days: 45 }, 'fr'), paymentTermsText({ rule: 'days_eom', days: 45 }, 'fr'), paymentTermsText({ rule: 'eom_days', days: 30 }, 'fr'),
      paymentTermsText({ rule: 'eom_days', days: 0 }, 'fr'), paymentTermsText({ rule: 'net', days: 1 }, 'fr'),
    ]).toEqual(['Net 45 jours', '45 jours fin de mois', 'Fin de mois + 30 jours', 'Fin de mois', 'Net 1 jour']);
  });

  it('N as typed: whole days 0–180', () => {
    expect([parsePaymentDays('45'), parsePaymentDays(' 0 '), parsePaymentDays(180), parsePaymentDays('180')]).toEqual([45, 0, 180, 180]);
    expect([parsePaymentDays('181'), parsePaymentDays('-1'), parsePaymentDays('4.5'), parsePaymentDays('1000'), parsePaymentDays(''), parsePaymentDays(undefined)])
      .toEqual([null, null, null, null, null, null]);
  });

  it('a stored text migrates to a rule', () => {
    expect(termsOfText('Net 45 days')).toEqual({ rule: 'net', days: 45 });
    expect(termsOfText('Net 30 days')).toEqual({ rule: 'net', days: 30 });
    expect(termsOfText('45 jours fin de mois')).toEqual({ rule: 'days_eom', days: 45 });
    expect(termsOfText('30 days end of month')).toEqual({ rule: 'days_eom', days: 30 });
    expect(termsOfText('Fin de mois + 30 jours')).toEqual({ rule: 'eom_days', days: 30 });
    expect(termsOfText('End of month + 15 days')).toEqual({ rule: 'eom_days', days: 15 });
    expect([termsOfText(''), termsOfText(null), termsOfText('on receipt')]).toEqual([
      { rule: 'net', days: 45 }, { rule: 'net', days: 45 }, { rule: 'net', days: 45 },
    ]);
    expect(termsOfText('Net 365 days')).toEqual({ rule: 'net', days: 180 });
  });
});
