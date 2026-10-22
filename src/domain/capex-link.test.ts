import { describe, expect, it } from 'vitest';
import { parseCapexLink } from './capex-link';

describe('parseCapexLink (R-190, Arche N-9 formats)', () => {
  it('accepts a CAPEX code and one of its needs, trimmed and upper-cased', () => {
    expect(parseCapexLink({ capexCode: ' cpx-sai-2026-01 ', needRef: 'CPX-SAI-2026-01/b01' })).toEqual({ ok: true, value: { capexCode: 'CPX-SAI-2026-01', needRef: 'CPX-SAI-2026-01/B01' } });
    expect(parseCapexLink({ capexCode: 'CPX-APM-2026-12', needRef: '' })).toEqual({ ok: true, value: { capexCode: 'CPX-APM-2026-12', needRef: null } });
  });
  it('empty clears both', () => {
    expect(parseCapexLink({ capexCode: '', needRef: '  ' })).toEqual({ ok: true, value: { capexCode: null, needRef: null } });
  });
  it('refuses a malformed code, a need without CAPEX or of another CAPEX, and non-string input', () => {
    expect(parseCapexLink({ capexCode: 'CAPEX-1' })).toEqual({ ok: false, error: 'Enter a CAPEX code like CPX-SAI-2026-01' });
    expect(parseCapexLink({ capexCode: 'CPX-SAIX-2026-01' })).toMatchObject({ ok: false });
    expect(parseCapexLink({ capexCode: '', needRef: 'CPX-SAI-2026-01/B01' })).toEqual({ ok: false, error: 'Enter the CAPEX code first' });
    expect(parseCapexLink({ capexCode: 'CPX-SAI-2026-01', needRef: 'B01' })).toEqual({ ok: false, error: 'Enter a need reference like CPX-SAI-2026-01/B01' });
    expect(parseCapexLink({ capexCode: 'CPX-SAI-2026-01', needRef: 'CPX-SAI-2026-02/B01' })).toEqual({ ok: false, error: 'The need belongs to another CAPEX' });
    expect(parseCapexLink({ capexCode: 42 })).toEqual({ ok: false, error: 'Invalid request' });
  });
});
