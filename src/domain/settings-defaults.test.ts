// R-170: the stored "Reset to defaults" document (validation, per-list order, fallback).
import { describe, expect, it } from 'vitest';
import { APP_SETTING_DEFAULTS, defaultsOfList, fallbackSettingsDefaults, holidayCode, parseSettingsDefaults } from './settings-defaults';

const DOC = {
  lists: [
    { listKey: 'riskCats', code: 'technical', label: 'Technical' },
    { listKey: 'holidays', code: '2026-07-14', label: '14 Jul · Fête nationale' },
    { listKey: 'riskCats', code: 'supplier', label: 'Supplier / delivery' },
  ],
  locations: [{ name: 'Entrepôt central — Lyon', type: 'central_warehouse' }, { name: 'Atelier — Lyon', type: 'workshop' }],
  health: { risk: 0.97, off: 0.9 },
};

describe('stored Settings defaults (R-170)', () => {
  it('has its own app_settings key', () => expect(APP_SETTING_DEFAULTS).toBe('settings.defaults'));

  it('accepts a well-formed document and numbers each list in document order', () => {
    const d = parseSettingsDefaults(DOC)!;
    expect(d).toEqual(DOC);
    expect(defaultsOfList(d, 'riskCats')).toEqual([
      { listKey: 'riskCats', code: 'technical', label: 'Technical', position: 0 },
      { listKey: 'riskCats', code: 'supplier', label: 'Supplier / delivery', position: 1 },
    ]);
    expect(defaultsOfList(d, 'skills')).toEqual([]);
  });

  it.each([
    ['not an object', 'x'],
    ['no lists', { ...DOC, lists: undefined }],
    ['unknown list', { ...DOC, lists: [{ listKey: 'colours', code: 'red', label: 'Red' }] }],
    ['empty code', { ...DOC, lists: [{ listKey: 'riskCats', code: ' ', label: 'Technical' }] }],
    ['duplicate code in a list', { ...DOC, lists: [DOC.lists[0], DOC.lists[0]] }],
    ['unknown location type', { ...DOC, locations: [{ name: 'Yard', type: 'yard' }] }],
    ['duplicate location', { ...DOC, locations: [DOC.locations[0], { ...DOC.locations[0], name: 'entrepôt central — lyon' }] }],
    ['threshold out of range', { ...DOC, health: { risk: 3, off: 0.9 } }],
    ['off track not below at risk', { ...DOC, health: { risk: 0.9, off: 0.95 } }],
  ])('refuses a document with %s', (_, doc) => expect(parseSettingsDefaults(doc)).toBeNull());

  it('falls back to the entries flagged as defaults, in their current order, and the default thresholds', () => {
    const f = fallbackSettingsDefaults([
      { listKey: 'riskCats', code: 'supplier', label: 'Supplier / delivery', position: 3, isDefault: true },
      { listKey: 'riskCats', code: 'cyber', label: 'Cyber', position: 1, isDefault: false },
      { listKey: 'riskCats', code: 'technical', label: 'Technical', position: 0, isDefault: true },
    ]);
    expect(f).toEqual({
      lists: [{ listKey: 'riskCats', code: 'technical', label: 'Technical' }, { listKey: 'riskCats', code: 'supplier', label: 'Supplier / delivery' }],
      locations: null,
      health: { risk: 0.97, off: 0.9 },
      // Delivery 8 (R-069, P-6c): Reset restores the change control board threshold too (50 k€ by default).
      change: { ccbThresholdKeur: 50 },
    });
  });

  // Delivery 8 (R-069, P-6c): the board threshold is optional in the stored document (one stored before it falls back to 50 k€).
  it('reads the optional change control board threshold, refusing an unusable one', () => {
    expect(parseSettingsDefaults(DOC)?.change).toBeUndefined();
    expect(parseSettingsDefaults({ ...DOC, change: { ccbThresholdKeur: 75 } })?.change).toEqual({ ccbThresholdKeur: 75 });
    expect(parseSettingsDefaults({ ...DOC, change: { ccbThresholdKeur: 0 } })?.change).toEqual({ ccbThresholdKeur: 0 });
    for (const bad of [-1, 'x', null, 2_000_000]) expect(parseSettingsDefaults({ ...DOC, change: { ccbThresholdKeur: bad } })).toBeNull();
  });

  it('codes a public holiday by its 2026 date', () => {
    expect(holidayCode('14 Jul · Fête nationale')).toBe('2026-07-14');
    expect(holidayCode('Fête locale')).toBe('fete_locale');
  });
});
