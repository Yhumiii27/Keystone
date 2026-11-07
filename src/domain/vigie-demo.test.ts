// D13 (CV-07): the demo NCRs numbered as Vigie numbers them.
import { describe, expect, it } from 'vitest';
import { demoNcrDeep, demoNcrNumber, demoNcrText } from './vigie-demo';

describe('demo NCR numbers (D13, CV-07)', () => {
  it('Harbor Line keeps the prototype’s digits; the generated pair is unique per project', () => {
    expect(demoNcrNumber('NCR-029')).toBe('EV-2026-029');
    expect(demoNcrNumber('NCR-026', 'HLT-026')).toBe('EV-2026-026');
    expect(['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'].map((c) => [demoNcrNumber('NCR-040', c), demoNcrNumber('NCR-041', c)])).toEqual([
      ['EV-2026-040', 'EV-2026-041'], ['EV-2026-042', 'EV-2026-043'], ['EV-2026-044', 'EV-2026-045'], ['EV-2026-046', 'EV-2026-047'], ['EV-2026-048', 'EV-2026-049'],
    ]);
    expect(demoNcrNumber('EV-2026-130')).toBe('EV-2026-130');
    expect(demoNcrNumber('CR-004')).toBe('CR-004');
  });

  it('texts, values and keys', () => {
    expect(demoNcrText('Anchor bolt layout — post 7 (NCR-029)')).toBe('Anchor bolt layout — post 7 (EV-2026-029)');
    expect(demoNcrText('NCR-041 · Survey', 'RCF-019')).toBe('EV-2026-043 · Survey');
    expect(demoNcrText(42)).toBe(42);
    expect(demoNcrDeep({ 'NCR-029 raised — Critical': ['NCR-028', { ncr: 'NCR-029' }], n: 1 })).toEqual({ 'EV-2026-029 raised — Critical': ['EV-2026-028', { ncr: 'EV-2026-029' }], n: 1 });
  });
});
