import { describe, expect, it } from 'vitest';
import { dateOf, money, moneyEur, pct, wbsFmtDate, wbsParseDate } from './format';
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

describe('plan form dates (R-013: the business year)', () => {
  it('a year-less date is in the business year; the year is shown outside it', () => {
    const d = wbsParseDate('14 Jan', 2027)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 14]);
    expect([wbsFmtDate(d, 2027), wbsFmtDate(d, 2026), wbsFmtDate(new Date(2026, 2, 12), 2027)]).toEqual(['14 Jan', '14 Jan ’27', '12 Mar ’26']);
    expect(wbsParseDate('5 Oct 2026', 2027)!.getFullYear()).toBe(2026);
  });
});
