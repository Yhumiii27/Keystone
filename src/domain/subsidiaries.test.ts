// Matrix D21: pure rules of the group's subsidiaries — a row of matrix.pub_filiales checked, the subsidiaries offered (Matrix first,
// the CAPEX mirror as fallback) and the client codes reserved to a subsidiary.
import { describe, expect, it } from 'vitest';
import { parseSubsidiaryRow, reservedCodeHolder, subsidiaryChoices, subsidiarySnapshot, type SubsidiaryRecord } from './subsidiaries';

const sub = (code: string, position: number | null, active = true): SubsidiaryRecord => ({ code, name: `${code} name`, countryIso2: null, zoneCode: null, currency: null, position, active });

describe('subsidiaries (Matrix D21)', () => {
  it('checks a row of pub_filiales: three capitals, a name and the actif flag; extra columns are ignored', () => {
    expect(parseSubsidiaryRow({ code: 'SAI', nom: ' Sahel Agro Industries ', pays_iso2: 'SN', zone_code: 'AFO', devise: 'XOF', ordre: '2', actif: true, nouvelle: 1 })).toEqual({
      code: 'SAI', name: 'Sahel Agro Industries', countryIso2: 'SN', zoneCode: 'AFO', currency: 'XOF', position: 2, active: true,
    });
    expect(parseSubsidiaryRow({ code: 'sai', nom: 'x', actif: true })).toBeNull();
    expect(parseSubsidiaryRow({ code: 'SAI', nom: ' ', actif: true })).toBeNull();
    expect(parseSubsidiaryRow({ code: 'SAI', nom: 'x', actif: 'yes' })).toBeNull();
    expect(subsidiarySnapshot([{ code: 'SAI', nom: 'a', actif: true }, { code: 'SAI', nom: 'b', actif: true }, { code: 'X', nom: 'c', actif: true }])).toEqual({
      subsidiaries: [{ code: 'SAI', name: 'a', countryIso2: null, zoneCode: null, currency: null, position: null, active: true }], skipped: 2,
    });
  });

  it('offers Matrix’s active subsidiaries in Matrix’s order; the CAPEX list only while Matrix publishes none', () => {
    const fallback = [{ code: 'SAI', name: 'Sahel' }, { code: 'APM', name: 'Atlas' }, { code: 'SAI', name: 'Other' }];
    expect(subsidiaryChoices([sub('SAI', 2), sub('OLD', 0, false), sub('APM', 1), sub('ZED', null)], fallback)).toEqual({
      source: 'matrix', list: [{ code: 'APM', name: 'APM name' }, { code: 'SAI', name: 'SAI name' }, { code: 'ZED', name: 'ZED name' }],
    });
    // Inactive subsidiaries only: Matrix still decides — nothing is offered.
    expect(subsidiaryChoices([sub('OLD', 0, false)], fallback)).toEqual({ source: 'matrix', list: [] });
    expect(subsidiaryChoices([], fallback)).toEqual({ source: 'capex', list: [{ code: 'APM', name: 'Atlas' }, { code: 'SAI', name: 'Sahel' }] });
  });

  it('reserves an offered subsidiary’s code to that subsidiary', () => {
    const offered = [{ code: 'SAI', name: 'Sahel' }];
    expect(reservedCodeHolder('SAI', null, offered)).toEqual({ code: 'SAI', name: 'Sahel' });
    expect(reservedCodeHolder('SAI', { subsidiaryCode: null }, offered)).toEqual({ code: 'SAI', name: 'Sahel' });
    expect(reservedCodeHolder('SAI', { subsidiaryCode: 'APM' }, offered)).toEqual({ code: 'SAI', name: 'Sahel' });
    expect(reservedCodeHolder('SAI', { subsidiaryCode: 'SAI' }, offered)).toBeNull();
    expect(reservedCodeHolder('HAV', null, offered)).toBeNull();
  });
});
