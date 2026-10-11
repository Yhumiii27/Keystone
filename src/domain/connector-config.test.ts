// R-020 (D-7a): the connectors file IT maintains — format, validation, changes, server variables.
import { describe, expect, it } from 'vitest';
import { CONNECTOR_ENV, connectorChanges, connectorEnvState, parseConnectorsFile } from './connector-config';

describe('connectors file (R-020)', () => {
  it('accepts the documented settings, trimmed', () => {
    expect(parseConnectorsFile({ connectors: { ' Sage X3 ': { enabled: false, frequency: ' Daily ', direction: 'both', dataScope: 'Stock', owner: ' IT ' }, Teams: {} } })).toEqual({
      ok: true,
      entries: [{ name: 'Sage X3', enabled: false, frequency: 'Daily', direction: 'both', dataScope: 'Stock', owner: 'IT' }, { name: 'Teams' }],
    });
    expect(parseConnectorsFile({ connectors: { X: { owner: '' } } })).toEqual({ ok: true, entries: [{ name: 'X', owner: null }] });
    expect(parseConnectorsFile({ connectors: {} })).toEqual({ ok: true, entries: [] });
  });

  it('refuses credentials, unknown keys, wrong types and duplicates — every error listed, nothing applied', () => {
    const r = parseConnectorsFile({
      connectors: {
        A: { token: 'x', password: 'y', colour: 'red', enabled: 1, frequency: '', direction: 'sideways', dataScope: 'x'.repeat(301), owner: 'x'.repeat(121) },
        a: {},
        B: 'on',
        ['x'.repeat(81)]: {},
      },
      version: 2,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'Unknown setting "version" (only "connectors")',
      'A: "token" looks like a credential — keep addresses, keys and tokens in the server environment',
      'A: "password" looks like a credential — keep addresses, keys and tokens in the server environment',
      'A: unknown setting "colour"',
      'A: "enabled" must be true or false',
      'A: "frequency" must be 1 to 60 characters',
      'A: "direction" must be "import", "export" or "both"',
      'A: "dataScope" must be 1 to 300 characters',
      'A: "owner" must be at most 120 characters',
      'a: listed twice',
      'B: settings must be an object',
      `Connector name "${'x'.repeat(81)}" must be 1 to 80 characters`,
    ]);
    expect(parseConnectorsFile(null)).toMatchObject({ ok: false });
    expect(parseConnectorsFile([])).toMatchObject({ ok: false });
    expect(parseConnectorsFile({ connectors: [] })).toMatchObject({ ok: false, errors: ['"connectors" must be an object keyed by connector name'] });
  });

  it('lists only what changes', () => {
    const row = { enabled: true, frequency: 'Every 2 h', direction: null, dataScope: 'Stock', ownerName: null };
    expect(connectorChanges(row, { name: 'X' })).toEqual({ set: {}, changes: [] });
    expect(connectorChanges(row, { name: 'X', enabled: true, frequency: 'Every 2 h' })).toEqual({ set: {}, changes: [] });
    expect(connectorChanges(row, { name: 'X', enabled: false, frequency: 'Daily', direction: 'import', dataScope: 'All', owner: 'IT' })).toEqual({
      set: { enabled: false, frequency: 'Daily', direction: 'import', dataScope: 'All', ownerName: 'IT' },
      changes: ['disabled', 'frequency: Every 2 h → Daily', 'direction: — → import', 'data scope changed', 'owner: — → IT'],
    });
  });

  it('server variables of the connector layer: set or not, secrets flagged', () => {
    expect(Object.keys(CONNECTOR_ENV)).toEqual(['Vigie', 'Cursus', 'Codex']);
    expect(CONNECTOR_ENV.Cursus.filter((v) => v.secret).map((v) => v.name)).toEqual(['CURSUS_API_KEY']);
    expect(connectorEnvState('Vigie', { VIGIE_API_URL: ' https://vigie.example ', NEXT_PUBLIC_VIGIE_URL: '' }).map((v) => [v.name, v.set])).toEqual([['VIGIE_API_URL', true], ['NEXT_PUBLIC_VIGIE_URL', false]]);
    expect(connectorEnvState('Sage X3', {})).toEqual([]);
  });
});
