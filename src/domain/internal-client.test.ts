// R-190: the internal-client rules (flag and subsidiary code, who sets it, the subsidiary of a need).
import { describe, expect, it } from 'vitest';
import { canSetInternalClient, isSubsidiaryClient, parseInternalClient } from './internal-client';

describe('parseInternalClient (R-190)', () => {
  it('an internal client with or without its code; the code trimmed and upper-cased', () => {
    expect(parseInternalClient({ isInternal: true, subsidiaryCode: ' sai ' })).toEqual({ ok: true, value: { isInternal: true, subsidiaryCode: 'SAI' } });
    expect(parseInternalClient({ isInternal: true, subsidiaryCode: '' })).toEqual({ ok: true, value: { isInternal: true, subsidiaryCode: null } });
    expect(parseInternalClient({ isInternal: true })).toEqual({ ok: true, value: { isInternal: true, subsidiaryCode: null } });
  });

  it('an external client carries no code; malformed input refused', () => {
    expect(parseInternalClient({ isInternal: false, subsidiaryCode: '' })).toEqual({ ok: true, value: { isInternal: false, subsidiaryCode: null } });
    expect(parseInternalClient({ isInternal: false, subsidiaryCode: 'SAI' })).toEqual({ ok: false, error: 'Only an internal client has a subsidiary code' });
    expect(parseInternalClient({ isInternal: true, subsidiaryCode: 'SA1' })).toEqual({ ok: false, error: 'Choose a subsidiary code of three capital letters' });
    expect(parseInternalClient({ isInternal: true, subsidiaryCode: 'SAIX' })).toMatchObject({ ok: false });
    expect(parseInternalClient({ isInternal: 'yes' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(parseInternalClient({ isInternal: true, subsidiaryCode: 3 })).toEqual({ ok: false, error: 'Invalid request' });
  });

  it('the director only', () => {
    expect(canSetInternalClient('director')).toBe(true);
    for (const r of ['pm', 'finance', 'client', 'member'] as const) expect(canSetInternalClient(r), r).toBe(false);
  });

  it('the client of a need is the subsidiary by its code or by Arche’s name', () => {
    const sub = { code: 'SAI', name: 'Sahel Agro Industries' };
    expect(isSubsidiaryClient({ name: 'SAI Sénégal', subsidiaryCode: 'SAI' }, sub)).toBe(true);
    expect(isSubsidiaryClient({ name: '  sahel agro   Industries', subsidiaryCode: null }, sub)).toBe(true);
    expect(isSubsidiaryClient({ name: 'Health trust', subsidiaryCode: null }, sub)).toBe(false);
    expect(isSubsidiaryClient({ name: 'Other', subsidiaryCode: 'APM' }, sub)).toBe(false);
    expect(isSubsidiaryClient({ name: 'Sahel Agro Industries', subsidiaryCode: null }, { code: null, name: null })).toBe(false);
  });
});
