// R-170: zone bar labels and managers from the zones table (pure part).
import { describe, expect, it } from 'vitest';
import { zoneLabelOf, zoneManagerLine, type ZoneEntry } from './zones';

const ZONES: ZoneEntry[] = [
  { key: 'euna', label: 'Europe & North America', manager: 'Olivier Castel' },
  { key: 'afr', label: 'Africa', manager: 'Aïcha Diallo' },
  { key: 'apac', label: 'Asia Pacific', manager: 'Sophie Nguyen' },
];

describe('zone bar (R-170)', () => {
  it('labels a zone, nothing for all zones or an unknown key', () => {
    expect(zoneLabelOf(ZONES, 'afr')).toBe('Africa');
    expect(zoneLabelOf(ZONES, null)).toBe('');
    expect(zoneLabelOf(ZONES, 'mars')).toBe('');
  });

  it('names the selected zone manager in full, every manager in short form otherwise (as the prototype)', () => {
    expect(zoneManagerLine(ZONES, 'euna')).toEqual({ ownerLabel: 'Zone manager', ownerName: 'Olivier Castel' });
    expect(zoneManagerLine(ZONES, null)).toEqual({ ownerLabel: 'Zone managers', ownerName: 'O. Castel · A. Diallo · S. Nguyen' });
  });

  it('a zone without a manager reads "—" and is left out of the list', () => {
    const z = ZONES.map((x) => (x.key === 'afr' ? { ...x, manager: null } : x));
    expect(zoneManagerLine(z, 'afr')).toEqual({ ownerLabel: 'Zone manager', ownerName: '—' });
    expect(zoneManagerLine(z, null).ownerName).toBe('O. Castel · S. Nguyen');
    expect(zoneManagerLine([], null)).toEqual({ ownerLabel: 'Zone managers', ownerName: '—' });
  });
});
