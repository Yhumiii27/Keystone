import { describe, expect, it } from 'vitest';
import { dateOf, money, moneyEur, pct } from './format';
import { trFR } from '@/i18n/translate';

describe('format (prototype golden values, docs/spec/01 §14)', () => {
  it('money in k€', () => {
    expect(money(4800, 'en')).toBe('€4.80M');
    expect(money(4800, 'fr')).toBe('4,80 M€');
    expect(money(-27, 'en', { signed: true })).toBe('−€27k');
    expect(money(-27, 'fr', { signed: true })).toBe('−27 k€');
    expect(money(160, 'en', { signed: true })).toBe('+€160k');
    expect(money(85, 'fr', { signed: true, currency: 'USD' })).toBe('+$85k');
  });
  it('full euros, pct, dateOf', () => {
    expect(moneyEur(4700, 'en')).toBe('€4,700');
    expect(pct(0.6438)).toBe('64.4%');
    expect(dateOf(12.45)).toBe('13 Jan ’27'); // prototype arithmetic (spec example says 14)
  });
  it('FR translation engine', () => {
    expect(trFR('Active projects')).toBe('Projets actifs');
    expect(trFR('14 Jan ’27')).toBe('14 janv. ’27');
    expect(trFR('Status date ·')).toBe('Date d’état ·');
  });
});
