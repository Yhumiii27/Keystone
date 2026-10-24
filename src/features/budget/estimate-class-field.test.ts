// R-188: the "Estimate class" field of Set baseline / Re-baseline, its server-side parsing and the Budget screen's range tile.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { money } from '@/lib/format';
import { parseRebaseline, rebaselineForm } from '@/features/schedule/rebaseline';
import { estimateClassField, estimateKpi, parseEstimateClassInput } from './estimate-class-field';

describe('estimate class field', () => {
  it('lists E50, E30, E10 with the stage default preset', () => {
    const f = estimateClassField('E30');
    expect([f.id, f.type, f.defaultValue, f.options?.map((o) => (typeof o === 'string' ? o : o.value))]).toEqual(['estimateClass', 'select', 'E30', ['E50', 'E30', 'E10']]);
    expect(rebaselineForm('E10').fields.at(-1)).toMatchObject({ id: 'estimateClass', defaultValue: 'E10' });
  });

  it('parses untrusted input: blank = stage default, a known class, anything else refused', () => {
    expect(parseEstimateClassInput(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseEstimateClassInput(' E10 ')).toEqual({ ok: true, value: 'E10' });
    expect(parseEstimateClassInput('e10')).toEqual({ ok: false, error: 'Unknown estimate class' });
    expect(parseEstimateClassInput(10)).toEqual({ ok: false, error: 'Unknown estimate class' });
    expect(parseRebaseline({ name: 'BL2', reason: 'x', estimateClass: 'E30' })).toMatchObject({ ok: true, value: { estimateClass: 'E30' } });
    expect(parseRebaseline({ name: 'BL2', reason: 'x', estimateClass: 'X' })).toEqual({ ok: false, error: 'Unknown estimate class' });
  });

  it('renders the range tile in English and French', () => {
    const e = { estimateClass: 'E10' as const, source: 'baseline' as const, baselineCode: 'BL1', range: { low: 4560, high: 5280 } };
    expect(estimateKpi(e, (k) => money(k, 'en'), makeT('en'))).toEqual({ label: 'Estimate range', value: '€4.56M – €5.28M', sub: 'E10 — firm (+10 % / −5 %) · BL1', alert: false });
    expect(estimateKpi({ ...e, estimateClass: 'E50', source: 'stage', baselineCode: null, range: { low: 1100, high: 3300 } }, (k) => money(k, 'fr'), makeT('fr'))).toEqual({
      label: 'Fourchette d’estimation', value: '1,10 M€ – 3,30 M€', sub: 'E50 — ordre de grandeur (±50 %) · Budget de travail', alert: false,
    });
    expect(estimateKpi({ estimateClass: null, source: 'none', baselineCode: null, range: null }, String, makeT('fr'))).toEqual({
      label: 'Fourchette d’estimation', value: '—', sub: 'Non classé', alert: true,
    });
  });
});
