// R-204 — activity codes: URL filter and grouping, derived types with several values, export cells, dictionary validation.
import { describe, expect, it } from 'vitest';
import {
  NO_CODE_VALUE, codeCell, codeFilterParam, groupByCode, groupKeyOf, matchesCodeFilter, parseCodeFilter, parseCodeGroup, parseCodeType, parseCodeValue,
  type ActivityCodeMap, type CodeType,
} from './activity-codes';

const zone: CodeType = { key: 't-zone', kind: 'custom', name: 'Zone', derived: false, values: [{ key: 'v1', code: 'Z1', label: 'Hall A' }, { key: 'v2', code: 'Z2', label: 'Hall B' }] };
const pkg: CodeType = { key: 'purchase_package', kind: 'purchase_package', name: 'Purchasing package', derived: true, values: [{ key: 'PO-1', code: 'PO-1', label: 'Steel' }, { key: 'PO-2', code: 'PO-2', label: 'Pumps' }] };
const types = [zone, pkg];
const map: ActivityCodeMap = { A1: { 't-zone': ['v2'], purchase_package: ['PO-2', 'PO-1'] }, A2: { 't-zone': ['v1'] }, A3: {} };
const acts = [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }];

describe('filter', () => {
  it('parses ?code= against the dictionary', () => {
    expect(parseCodeFilter('t-zone~v1', types)).toEqual({ type: 't-zone', value: 'v1' });
    expect(parseCodeFilter('t-zone~-', types)).toEqual({ type: 't-zone', value: NO_CODE_VALUE });
    expect(parseCodeFilter('t-zone~v9', types)).toBeNull();
    expect(parseCodeFilter('nope~v1', types)).toBeNull();
    expect(parseCodeFilter('garbage', types)).toBeNull();
    expect(parseCodeFilter(undefined, types)).toBeNull();
    expect(codeFilterParam({ type: 'purchase_package', value: 'PO-1' })).toBe('purchase_package~PO-1');
  });

  it('matches a value, any of several derived values, or no value', () => {
    expect(acts.filter((a) => matchesCodeFilter(map, a.id, { type: 't-zone', value: 'v1' })).map((a) => a.id)).toEqual(['A2']);
    expect(acts.filter((a) => matchesCodeFilter(map, a.id, { type: 'purchase_package', value: 'PO-1' })).map((a) => a.id)).toEqual(['A1']);
    expect(acts.filter((a) => matchesCodeFilter(map, a.id, { type: 'purchase_package', value: NO_CODE_VALUE })).map((a) => a.id)).toEqual(['A2', 'A3']);
    expect(acts.filter((a) => matchesCodeFilter(map, a.id, null)).length).toBe(3);
  });
});

describe('grouping', () => {
  it('groups in the value order, empty groups out, no value last, each activity once', () => {
    expect(parseCodeGroup('t-zone', types)).toBe(zone);
    expect(parseCodeGroup('x', types)).toBeNull();
    expect(groupByCode(acts, map, zone).map((g) => [g.group.code, g.activities.map((a) => a.id)])).toEqual([['Z1', ['A2']], ['Z2', ['A1']], ['—', ['A3']]]);
    // A1 in PO-1 and PO-2: grouped under the first in the type's order.
    expect(groupKeyOf(map, 'A1', pkg)).toBe('PO-1');
    expect(groupByCode(acts, map, pkg).map((g) => [g.group.key, g.activities.map((a) => a.id)])).toEqual([['PO-1', ['A1']], [NO_CODE_VALUE, ['A2', 'A3']]]);
  });

  it('export cells list the value codes', () => {
    expect(codeCell(map, 'A1', pkg)).toBe('PO-1, PO-2');
    expect(codeCell(map, 'A3', zone)).toBe('');
  });
});

describe('dictionary validation', () => {
  it('types: name, one site type, unique names', () => {
    expect(parseCodeType({ name: '  Zone   A ' }, [])).toEqual({ ok: true, value: { name: 'Zone A', kind: 'custom' } });
    expect(parseCodeType({ name: 'Site', kind: 'site' }, [])).toEqual({ ok: true, value: { name: 'Site', kind: 'site' } });
    expect(parseCodeType({ name: 'Lieu', kind: 'site' }, [{ name: 'Site', kind: 'site' }])).toEqual({ ok: false, error: 'siteTaken' });
    expect(parseCodeType({ name: 'zone' }, [{ name: 'Zone', kind: 'custom' }])).toEqual({ ok: false, error: 'typeTaken' });
    expect(parseCodeType({ name: '' }, [])).toEqual({ ok: false, error: 'typeName' });
    expect(parseCodeType({ name: 'x', kind: 'equipment' }, [])).toEqual({ ok: false, error: 'typeKind' });
  });

  it('values: code pattern, label defaults to the code, unique codes', () => {
    expect(parseCodeValue({ code: 'Z1', label: '' }, [])).toEqual({ ok: true, value: { code: 'Z1', label: 'Z1' } });
    expect(parseCodeValue({ code: 'Z 1' }, [])).toEqual({ ok: false, error: 'valueCode' });
    expect(parseCodeValue({ code: 'z1' }, [{ code: 'Z1' }])).toEqual({ ok: false, error: 'valueTaken' });
    expect(parseCodeValue({ code: 'Z2', label: 'x'.repeat(81) }, [])).toEqual({ ok: false, error: 'valueLabel' });
  });
});
