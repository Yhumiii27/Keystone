import 'server-only';
// Settings DAL — personalisable lists and project health rules (docs/spec/10 §1). Lists live in reference_values
// (skills, cost categories, project statuses, risk categories, deliverable types, public holidays, location types);
// stock locations are the storage locations (suppliers.ts), so receipts, transfers and reservations use them at once;
// thresholds are app_settings "health.thresholds". "Reset to defaults" restores the stored defaults (R-170:
// app_settings "settings.defaults", src/domain/settings-defaults.ts — the lists, the default locations and the thresholds).
// Chapter 4 (A-13, A-14 — rules in src/domain/settings-rules.ts): only the portfolio director edits; "Remove" deactivates
// a value still in use (or a default) and deletes an unused custom one; the lists drive the modules through
// src/server/dal/settings-lists.ts; the thresholds drive the one health rule (src/server/dal/health-thresholds.ts).
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  APP_SETTING_CCB, APP_SETTING_HEALTH, REFERENCE_LIST_KEYS, locationType, slugOf,
  type LocationType, type ReferenceListKey,
} from '@/server/db/codes';
import { SETTINGS_CARDS } from '@/domain/admin';
import { DEFAULT_CCB_THRESHOLD_KEUR, isCcbThreshold } from '@/domain/change-control';
import {
  APP_SETTING_DEFAULTS, defaultsOfList, fallbackSettingsDefaults, holidayCode, parseSettingsDefaults, type SettingsDefaults,
} from '@/domain/settings-defaults';
import {
  CUSTOM_STATUSES_ALLOWED, CUSTOM_STATUS_REFUSED, HOLIDAY_DATE_TAKEN, REQUIRED_STAGES, REQUIRED_STAGE_REFUSED, SETTINGS_DIRECTOR_ONLY, canEditSettings, removalModeOf,
  type RemovalMode,
} from '@/domain/settings-rules';
import { appSettings, referenceValues, skills, storageLocations } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { readCcbThreshold } from './change-settings';
import { readHealthThresholds } from './health-thresholds';
import { requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { referenceUsage } from './settings-lists';

export {
  activeOptions, costCategoryOptions, hiddenSkillNames, inactiveStageCodes, riskCategoryOptions, settingsEntries, settingsHolidayRows,
} from './settings-lists';

export type { Actor };

export interface ReferenceValueRow { code: string; label: string }
export interface LocationRow { name: string; type: LocationType; typeLabel: string }
export interface HealthThresholds { risk: number; off: number }

export interface SettingsData {
  lists: Record<ReferenceListKey, ReferenceValueRow[]>;
  locations: LocationRow[];
  health: HealthThresholds;
  /** Delivery 8 (R-069, P-6c): change control board threshold, k€ (optional for callers building the data by hand). */
  ccbThresholdKeur?: number;
}

/** Active values of one list, in order. */
export async function listReferenceValues(listKey: ReferenceListKey): Promise<ReferenceValueRow[]> {
  const db = await getDb();
  return db.select({ code: referenceValues.code, label: referenceValues.label }).from(referenceValues)
    .where(and(eq(referenceValues.listKey, listKey), eq(referenceValues.active, true))).orderBy(asc(referenceValues.position));
}

/** Project health thresholds (On track ≥ risk, At risk below risk, Off track below off) — uncached, for writers and tests. */
export async function getHealthThresholds(): Promise<HealthThresholds> {
  return readHealthThresholds();
}

/** Everything the Settings screen shows. */
export async function getSettings(): Promise<SettingsData> {
  const db = await getDb();
  const [values, locs, health, ccbThresholdKeur] = await Promise.all([
    db.select().from(referenceValues).where(eq(referenceValues.active, true)).orderBy(asc(referenceValues.position)),
    db.select().from(storageLocations).where(eq(storageLocations.active, true)).orderBy(asc(storageLocations.position)),
    getHealthThresholds(),
    readCcbThreshold(),
  ]);
  const lists = Object.fromEntries(REFERENCE_LIST_KEYS.map((k) => [k, values.filter((v) => v.listKey === k).map((v) => ({ code: v.code, label: v.label }))])) as Record<ReferenceListKey, ReferenceValueRow[]>;
  return { lists, locations: locs.map((l) => ({ name: l.name, type: l.type, typeLabel: locationType.label(l.type) })), health, ccbThresholdKeur };
}

/** Writers: the Settings workspace, and only the roles that edit Settings (A-14: the portfolio director). */
function ST(actor: Actor): void {
  requireWorkspace('settings', actor, 'Settings');
  if (!canEditSettings(actor.role)) throw new Error(SETTINGS_DIRECTOR_ONLY);
}

/** Audit object of a list: "Settings · Risk categories" (the card title, not the internal list key). */
const listRef = (listKey: string) => `Settings · ${SETTINGS_CARDS.find((c) => c.key === listKey)?.title ?? listKey}`;

/**
 * "Add" an entry to a list (appended; a removed entry with the same label is reactivated; duplicates refused).
 * Holidays take the form "14 Jul · Fête nationale" (the code is the 2026 date).
 */
export async function addReferenceValue(listKey: ReferenceListKey, label: string, actor: Actor): Promise<string> {
  ST(actor);
  if (!REFERENCE_LIST_KEYS.includes(listKey) || listKey === 'locTypes') throw new Error('Unknown list');
  const text = requiredText(label, 'Entry', 120);
  if (listKey === 'holidays' && !/^\d{4}-\d{2}-\d{2}$/.test(holidayCode(text))) throw new Error('A holiday reads "14 Jul · Fête nationale"');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(referenceValues).where(eq(referenceValues.listKey, listKey));
    const same = rows.find((r) => r.label.toLowerCase() === text.toLowerCase());
    if (same?.active) throw new Error(`"${text}" is already in the list`);
    // A-14: project statuses are the lifecycle stages; only a deactivated stage can come back.
    if (listKey === 'statuses' && !same && !CUSTOM_STATUSES_ALLOWED) throw new Error(CUSTOM_STATUS_REFUSED);
    // Holidays are keyed by date (calendars, leave calendar): an active entry on that date refuses a second label.
    if (listKey === 'holidays' && !same && rows.some((r) => r.active && r.code === holidayCode(text))) throw new Error(HOLIDAY_DATE_TAKEN);
    const position = rows.reduce((m, r) => Math.max(m, r.position + 1), 0);
    let code: string;
    if (same) {
      code = same.code;
      await tx.update(referenceValues).set({ active: true, position, updatedAt: new Date() }).where(eq(referenceValues.id, same.id));
    } else {
      const base = listKey === 'holidays' ? holidayCode(text) : slugOf(text);
      code = base;
      for (let i = 2; rows.some((r) => r.code === code); i++) code = `${base}_${i}`;
      await tx.insert(referenceValues).values({ listKey, code, label: text, position, active: true, isDefault: false });
    }
    // A-14: a skill family is a column of the skills matrix (all levels 0 until rated).
    if (listKey === 'skills') {
      const [known] = await tx.select({ id: skills.id }).from(skills).where(sql`lower(${skills.name}) = ${text.toLowerCase()}`);
      if (!known) {
        const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${skills.position}), 0)::int` }).from(skills);
        await tx.insert(skills).values({ name: same?.label ?? text, category: null, position: pos + 1 });
      }
    }
    await trace(tx, await whoIs(tx, actor), { objectRef: listRef(listKey), change: `added "${text}"`, area: 'Settings', entityType: 'reference_value' });
    return code;
  });
}

/** Outcome of "Remove": deleted (unused custom value) or deactivated (in use, or a default), with the usage count. */
export interface RemovedEntry {
  label: string;
  mode: RemovalMode;
  /** Records still using the value. */
  inUse: number;
}

/**
 * "Remove" an entry (A-14): a value still used by records — or a SETTINGS0 default, restored by "Reset to defaults" —
 * is deactivated (no longer offered; records keep it); an unused custom value is deleted. Lifecycle stages required by
 * the workflow (Initiative, Clos, Annulé) cannot be removed.
 */
export async function removeReferenceValue(listKey: ReferenceListKey, code: string, actor: Actor): Promise<RemovedEntry> {
  ST(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(referenceValues).where(and(eq(referenceValues.listKey, listKey), eq(referenceValues.code, code), eq(referenceValues.active, true)));
    if (!r) throw new Error('Unknown entry');
    if (listKey === 'statuses' && (REQUIRED_STAGES as readonly string[]).includes(r.code)) throw new Error(REQUIRED_STAGE_REFUSED);
    const inUse = await referenceUsage(tx, listKey, r.code, r.label);
    const mode = removalModeOf({ inUse, isDefault: r.isDefault });
    if (mode === 'deleted') await tx.delete(referenceValues).where(eq(referenceValues.id, r.id));
    else await tx.update(referenceValues).set({ active: false, updatedAt: new Date() }).where(eq(referenceValues.id, r.id));
    const change = mode === 'deleted' ? `removed "${r.label}"` : `deactivated "${r.label}"${inUse ? ` · still used by ${inUse}` : ''}`;
    await trace(tx, await whoIs(tx, actor), { objectRef: listRef(listKey), change, area: 'Settings', entityType: 'reference_value', entityId: r.id });
    return { label: r.label, mode, inUse };
  });
}

/** "Add" a stock location or workshop with the selected type (a removed location of that name is reactivated). */
export async function addLocation(name: string, type: LocationType, actor: Actor): Promise<void> {
  ST(actor);
  const text = requiredText(name, 'Location', 120);
  if (!locationType.isCode(type)) throw new Error('Invalid location type');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const all = await tx.select().from(storageLocations);
    const same = all.find((l) => l.name.toLowerCase() === text.toLowerCase());
    if (same?.active) throw new Error(`"${text}" is already a location`);
    const position = all.reduce((m, l) => Math.max(m, l.position + 1), 0);
    if (same) await tx.update(storageLocations).set({ active: true, type, position, updatedAt: new Date() }).where(eq(storageLocations.id, same.id));
    else await tx.insert(storageLocations).values({ name: text, type, position, active: true });
    await trace(tx, await whoIs(tx, actor), { objectRef: listRef('locations'), change: `added "${text}" (${locationType.label(type)})`, area: 'Settings', entityType: 'storage_location' });
  });
}

/** "Remove" a location: no longer offered (stock positions keep it). */
export async function removeLocation(name: string, actor: Actor): Promise<void> {
  ST(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(storageLocations).where(and(eq(storageLocations.name, name), eq(storageLocations.active, true)));
    if (!l) throw new Error(`Unknown location ${name}`);
    await tx.update(storageLocations).set({ active: false, updatedAt: new Date() }).where(eq(storageLocations.id, l.id));
    await trace(tx, await whoIs(tx, actor), { objectRef: listRef('locations'), change: `removed "${name}"`, area: 'Settings', entityType: 'storage_location', entityId: l.id });
  });
}

/** Health thresholds: numbers in ]0, 2], off track strictly below at risk (11 §3.1 AppSetting). */
export async function setHealthThresholds(input: Partial<HealthThresholds>, actor: Actor): Promise<HealthThresholds> {
  ST(actor);
  const cur = await getHealthThresholds();
  const next = { risk: input.risk ?? cur.risk, off: input.off ?? cur.off };
  for (const [k, v] of Object.entries(next)) if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 2) throw new Error(`Invalid threshold ${k}`);
  if (next.off >= next.risk) throw new Error('"Off track below" must be lower than "At risk below"');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const who = await whoIs(tx, actor);
    await tx.insert(appSettings).values({ key: APP_SETTING_HEALTH, value: next, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId } });
    await trace(tx, who, { objectRef: 'Health rules', change: `at risk below ${cur.risk} → ${next.risk} · off track below ${cur.off} → ${next.off}`, area: 'Settings', entityType: 'app_setting' });
  });
  return next;
}

/** Refusal of a board threshold that is not a number of k€ in [0, 1 000 000]. */
export const CCB_THRESHOLD_ERROR = 'Enter a threshold in k€ (0 or more)';

/**
 * Delivery 8 (R-069, P-6c): the change control board threshold, k€ — a number in [0, 1 000 000] (0 = the board decides every
 * request with an amount). Applies to change requests submitted afterwards: the steps of a request are fixed at submission.
 * Director only (Settings, A-14); audited and written to the activity feed. Returns the new value.
 */
export async function setCcbThreshold(keur: number, actor: Actor): Promise<number> {
  ST(actor);
  if (!isCcbThreshold(keur)) throw new Error(CCB_THRESHOLD_ERROR);
  const value = Math.round(keur * 100) / 100;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const cur = await readCcbThreshold(tx);
    const who = await whoIs(tx, actor);
    await tx.insert(appSettings).values({ key: APP_SETTING_CCB, value: { keur: value }, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { keur: value }, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId } });
    if (cur !== value) {
      await trace(tx, who, {
        objectRef: 'Change control board', change: `threshold ${cur} → ${value} k€`, area: 'Settings', entityType: 'app_setting',
        activity: { text: `Change control board threshold · ${cur} → ${value} k€`, kind: 'change' },
      });
    }
    return value;
  });
}

/**
 * The stored "Reset to defaults" document (R-170: app_settings "settings.defaults", written with the reference data);
 * null when none is stored or it does not validate.
 */
export async function readSettingsDefaults(tx?: Tx): Promise<SettingsDefaults | null> {
  const q = tx ?? (await getDb());
  const [row] = await q.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
  return row ? parseSettingsDefaults(row.value) : null;
}

/**
 * "Reset to defaults" (R-170: from the stored defaults, never from the seed module or the prototype data): each list's
 * default entries active at their default position (custom entries deactivated), the default locations active in order
 * (the others deactivated), the default thresholds. Without a stored document: the entries flagged default in their
 * current order, the locations untouched, HEALTH_DEFAULTS.
 */
export async function resetSettings(actor: Actor): Promise<void> {
  ST(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const stored = await readSettingsDefaults(tx);
    const defaults = stored ?? fallbackSettingsDefaults(await tx.select({
      listKey: referenceValues.listKey, code: referenceValues.code, label: referenceValues.label, position: referenceValues.position, isDefault: referenceValues.isDefault,
    }).from(referenceValues));
    const doc = { lists: defaults.lists, locations: [], health: defaults.health } satisfies SettingsDefaults;
    // R-069: a document stored before delivery 8 has no board threshold — the default (50 k€).
    const ccb = defaults.change?.ccbThresholdKeur ?? DEFAULT_CCB_THRESHOLD_KEUR;
    for (const listKey of REFERENCE_LIST_KEYS) {
      const own = defaultsOfList(doc, listKey);
      // A list without defaults is left as it is (a reset never empties a list, e.g. the lifecycle stages).
      if (!own.length) continue;
      await tx.update(referenceValues).set({ active: false, updatedAt: new Date() })
        .where(and(eq(referenceValues.listKey, listKey), notInArray(referenceValues.code, own.map((d) => d.code))));
      for (const d of own) {
        await tx.insert(referenceValues).values({ ...d, active: true, isDefault: true })
          .onConflictDoUpdate({ target: [referenceValues.listKey, referenceValues.code], set: { label: d.label, position: d.position, active: true, isDefault: true, updatedAt: new Date() } });
      }
    }
    if (defaults.locations?.length) {
      const locs = defaults.locations.map((l, position) => ({ ...l, position }));
      await tx.update(storageLocations).set({ active: false, updatedAt: new Date() }).where(notInArray(storageLocations.name, locs.map((l) => l.name)));
      for (const l of locs) {
        await tx.insert(storageLocations).values({ ...l, active: true })
          .onConflictDoUpdate({ target: storageLocations.name, set: { type: l.type, position: l.position, active: true, updatedAt: new Date() } });
      }
    }
    const who = await whoIs(tx, actor);
    const health = { ...defaults.health };
    await tx.insert(appSettings).values({ key: APP_SETTING_HEALTH, value: health, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: health, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId } });
    await tx.insert(appSettings).values({ key: APP_SETTING_CCB, value: { keur: ccb }, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { keur: ccb }, updatedAt: new Date(), updatedByName: who.who, updatedByPersonId: who.personId } });
    await trace(tx, who, { objectRef: 'Settings', change: 'reset to defaults', area: 'Settings', activity: { text: 'Reset the settings lists to their defaults', kind: 'change' } });
  });
}

/** Labels of several lists at once (forms: risk categories, deliverable types, cost categories). */
export async function referenceLists(keys: ReferenceListKey[]): Promise<Record<string, ReferenceValueRow[]>> {
  const db = await getDb();
  const rows = await db.select().from(referenceValues).where(and(inArray(referenceValues.listKey, keys), eq(referenceValues.active, true))).orderBy(asc(referenceValues.position));
  return Object.fromEntries(keys.map((k) => [k, rows.filter((r) => r.listKey === k).map((r) => ({ code: r.code, label: r.label }))]));
}
