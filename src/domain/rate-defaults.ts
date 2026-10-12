// R-178 (A-10) and R-083: the reference values of the rate grid shared by the demo seed, the production seed and its backfill.
// Pure module (seeds, DAL, tests).
//
// The five premium multipliers keep the prototype's keys and labels (MULTS); their factors are PLACEHOLDERS for the direction
// to confirm — they are not EPC2i's real coefficients (A-15: nothing fictitious may be presented as EPC2i's data). They are
// seeded as first versions dated RATE_GRID_START and stay editable on Resources › Rate cards (director and Finance).
import type { RateMultiplierKey } from '@/server/db/codes';

/** Effective date of the seeded grid (rates and multipliers) and of the versions the R-083 migration creates. */
export const RATE_GRID_START = '2026-01-01';

/** The premium multipliers (placeholders to confirm — A-10, R-178). The what-if's overtime fallback (×1.25) is the same value. */
export const RATE_MULTIPLIER_DEFAULTS: readonly { key: RateMultiplierKey; label: string; factor: number }[] = [
  { key: 'ot', label: 'Overtime > 8 h/day', factor: 1.25 },
  { key: 'sat', label: 'Saturday', factor: 1.5 },
  { key: 'sun', label: 'Sunday / public holiday', factor: 2 },
  { key: 'night', label: 'Night shift', factor: 1.3 },
  { key: 'oncall', label: 'On-call', factor: 0.35 },
];
