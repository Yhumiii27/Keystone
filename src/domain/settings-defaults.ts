// Stored defaults of Settings › "Reset to defaults" (R-170, A-14, A-15). Pure module (DAL, seed, tests).
//
// What "Reset to defaults" restores is a document of its own in the database (app_settings "settings.defaults"),
// written when the reference data is loaded (the seed; in production the reference data IT loads), never read from
// the prototype data or the seed module at run time:
//   lists      the entries of each Settings list, in order (code + label), restored active at their position;
//   locations  the stock locations and workshops (name + type), restored active in order;
//   health     the project health thresholds;
//   hours      R-088 (R-6b): the hours-variance threshold { pct } — OPTIONAL: documents stored before delivery 8 have none and
//              stay valid (Reset then restores the default 10 %).
// Without the document (a database loaded before Delivery 7 and not yet backfilled), Reset falls back to the list
// entries flagged `is_default` in their current order, the current locations and HEALTH_DEFAULTS.
import { HEALTH_DEFAULTS, REFERENCE_LIST_KEYS, isoOfDisplayDate, locationType, slugOf, type LocationType, type ReferenceListKey } from '@/server/db/codes';
import { HOURS_VARIANCE_DEFAULT, isHoursVariancePct } from './hr';

/** app_settings key of the stored defaults. */
export const APP_SETTING_DEFAULTS = 'settings.defaults';

/** Code of a public holiday entry: "14 Jul · Fête nationale" → 2026-07-14 (the list is "Public holidays 2026 — France"). */
export const holidayCode = (label: string) => isoOfDisplayDate(label.split(' · ')[0]) ?? slugOf(label);

export interface SettingsDefaults {
  lists: { listKey: ReferenceListKey; code: string; label: string }[];
  locations: { name: string; type: LocationType }[];
  health: { risk: number; off: number };
  /** R-088 (R-6b): the hours-variance threshold (% of planned); absent from documents stored before delivery 8. */
  hours?: { pct: number };
}

const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isThreshold = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 2;

/**
 * The stored document checked entry by entry: unknown lists, empty or duplicate codes / names, unknown location types and
 * out-of-range thresholds are refused (null), so a hand-edited document never half-resets the Settings.
 */
export function parseSettingsDefaults(value: unknown): SettingsDefaults | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.lists) || !Array.isArray(v.locations) || !v.health || typeof v.health !== 'object') return null;
  const lists: SettingsDefaults['lists'] = [];
  const seen = new Set<string>();
  for (const e of v.lists as unknown[]) {
    const x = (e ?? {}) as Record<string, unknown>;
    if (!REFERENCE_LIST_KEYS.includes(x.listKey as ReferenceListKey) || !isText(x.code, 120) || !isText(x.label, 120)) return null;
    const key = `${x.listKey}\u0000${x.code}`;
    if (seen.has(key)) return null;
    seen.add(key);
    lists.push({ listKey: x.listKey as ReferenceListKey, code: x.code, label: x.label });
  }
  const locations: SettingsDefaults['locations'] = [];
  const names = new Set<string>();
  for (const e of v.locations as unknown[]) {
    const x = (e ?? {}) as Record<string, unknown>;
    if (!isText(x.name, 120) || typeof x.type !== 'string' || !locationType.isCode(x.type)) return null;
    if (names.has(x.name.toLowerCase())) return null;
    names.add(x.name.toLowerCase());
    locations.push({ name: x.name, type: x.type });
  }
  const h = v.health as Record<string, unknown>;
  if (!isThreshold(h.risk) || !isThreshold(h.off) || h.off >= h.risk) return null;
  // R-088: optional; when present it must be valid (a hand-edited document never half-resets the Settings).
  let hours: SettingsDefaults['hours'];
  if (v.hours !== undefined) {
    const pct = v.hours && typeof v.hours === 'object' ? (v.hours as Record<string, unknown>).pct : undefined;
    if (!isHoursVariancePct(pct)) return null;
    hours = { pct };
  }
  return { lists, locations, health: { risk: h.risk, off: h.off }, ...(hours ? { hours } : {}) };
}

/** The entries of one list with their Settings position (0-based, document order). */
export const defaultsOfList = (d: SettingsDefaults, listKey: ReferenceListKey) =>
  d.lists.filter((e) => e.listKey === listKey).map((e, position) => ({ ...e, position }));

/** Fallback when no document is stored: the entries flagged as defaults, current locations kept, HEALTH_DEFAULTS, 10 % hours variance. */
export function fallbackSettingsDefaults(rows: readonly { listKey: ReferenceListKey; code: string; label: string; position: number; isDefault: boolean }[]): Omit<SettingsDefaults, 'locations'> & { locations: null } {
  const lists = [...rows].filter((r) => r.isDefault).sort((a, b) => a.position - b.position).map(({ listKey, code, label }) => ({ listKey, code, label }));
  return { lists, locations: null, health: { risk: HEALTH_DEFAULTS.risk, off: HEALTH_DEFAULTS.off }, hours: { pct: HOURS_VARIANCE_DEFAULT } };
}

/** R-088: the hours-variance threshold a reset restores (the document's, else the default 10 %). */
export const defaultHoursVariance = (d: Pick<SettingsDefaults, 'hours'>) => d.hours?.pct ?? HOURS_VARIANCE_DEFAULT;
