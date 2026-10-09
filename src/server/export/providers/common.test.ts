// Helpers of the export providers (chapter 4): EN display dates and numbers back into ISO dates / numbers, the export
// header menu file names.
import { describe, expect, it } from 'vitest';
import { fileNameOf } from '@/features/exports/download';
import { isoOf, monthIso, num, pctNum } from './common';

describe('export helpers', () => {
  it('isoOf reads the prototype date strings (year 2026 by default, ’27, actual marker)', () => {
    expect([isoOf('25 Sep 2026'), isoOf('25 Sep'), isoOf('Wed 23 Sep'), isoOf('14 Jan ’27'), isoOf('17 Aug A'), isoOf('2026-09-25')]).toEqual([
      '2026-09-25', '2026-09-25', '2026-09-23', '2027-01-14', '2026-08-17', '2026-09-25',
    ]);
    expect([isoOf('—'), isoOf('TBD'), isoOf(null), isoOf('Q4 2026')]).toEqual([null, null, null, null]);
  });
  it('num / pctNum read display numbers (spaces, minus sign, decimal comma)', () => {
    expect([num('4 800 k€'), num('−27'), num('0,90'), num('—'), num(12)]).toEqual([4800, -27, 0.9, null, 12]);
    expect([pctNum('64%'), pctNum('−3,5 %'), pctNum(null)]).toEqual([0.64, -0.035, null]);
  });
  it('monthIso maps the Gantt month offsets to dates', () => {
    expect([monthIso(0), monthIso(8.8), monthIso(12), monthIso(13.5)]).toEqual(['2026-01-01', '2026-09-23', '2027-01-01', '2027-02-15']);
  });
  it('fileNameOf reads Content-Disposition (RFC 5987 first)', () => {
    expect(fileNameOf(`attachment; filename="po-HLT-026.pdf"; filename*=UTF-8''po-HLT-026-%C3%A9.pdf`)).toBe('po-HLT-026-é.pdf');
    expect(fileNameOf('attachment; filename="budget.xlsx"')).toBe('budget.xlsx');
    expect(fileNameOf(null, 'x')).toBe('x');
  });
});
