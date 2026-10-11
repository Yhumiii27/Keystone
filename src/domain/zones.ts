// Zone bar of the zone-scoped screens (prototype ZONES 3170, zone bar 4995 / 5211; docs/spec/01 §7.2).
// R-170: the zones and their managers come from the `zones` table (manager = a person of the organisation), not from
// the prototype constant ZONES, so a renamed zone or a new manager shows at once and production shows no demo names.
import { shortName } from '@/lib/format';

export interface ZoneEntry<K extends string = string> {
  key: K;
  /** EN source label ("Europe & North America"). */
  label: string;
  /** Manager's full name; null when the zone has no manager. */
  manager: string | null;
}

/** Label of a zone ('' for "All zones" or an unknown key). */
export const zoneLabelOf = <K extends string>(zones: readonly ZoneEntry<K>[], key: K | null) => (key ? zones.find((z) => z.key === key)?.label ?? '' : '');

/**
 * "Zone manager" line: the selected zone's manager in full ("Olivier Castel", "—" without one); with every zone
 * selected, the managers in short form ("O. Castel · A. Diallo · S. Nguyen"), zones without a manager left out.
 */
export function zoneManagerLine<K extends string>(zones: readonly ZoneEntry<K>[], key: K | null): { ownerLabel: string; ownerName: string } {
  const cur = key ? zones.find((z) => z.key === key) : undefined;
  if (cur) return { ownerLabel: 'Zone manager', ownerName: cur.manager ?? '—' };
  const names = zones.map((z) => z.manager).filter((m): m is string => !!m).map(shortName);
  return { ownerLabel: 'Zone managers', ownerName: names.length ? names.join(' · ') : '—' };
}
