'use server';
// Administration Server Functions: Settings — personalisable lists (docs/spec/10 §1.5: add / remove entries, location
// type, health thresholds, "Reset to defaults"), Standard machine types (09 §9: identity card, payment pattern, phases,
// ITP systems, cost categories, REX references, "New machine type") and Activity & integrations (10 §2: "Sync now",
// "Add connector"). Each one checks the viewer may edit the screen (roles with the screen in their workspace — the
// "Outside my workspace · Read-only" rule; machine types: `mtCanEdit` = director, PM, engineering lead, quality, the same
// roles), validates the raw input with the domain parsers, writes through the DAL with the viewer as the actor (the DAL
// re-checks the workspace and records the audit row), then revalidates the app (lists used by other screens, badges).
import { revalidatePath } from 'next/cache';
import type { FormValues } from '@/components/app/form-def';
import {
  MT_CALENDAR_OPTIONS, MT_COST_TYPES, MT_FORM_BASES, MT_FORM_CALENDARS, holidayEntry, isSettingsCardKey, normaliseMachineTypeCode, parseBudgetInput,
  parsePercentInput, parseThresholdInput, settingsEntry, thresholdsError,
} from '@/domain/admin';
import { isoOfDisplayDate, locationType, type CalendarCode, type CostType } from '@/server/db/codes';
import { listAdminConnectors, syncAdminConnector } from '@/server/dal/admin-connectors';
import { ADDABLE_SYSTEMS, CONNECTOR_FREQUENCIES, ConnectorDisabledError, addConnector } from '@/server/dal/integrations';
import {
  createMachineType, getMachineType, removeRexReference, setMachineTypeCostCategories, setMachineTypeItpSystems, setMachineTypePhases, updateMachineType,
  type MachineTypePatch,
} from '@/server/dal/mtypes';
import type { Actor } from '@/server/dal/ops-common';
import { addLocation, addReferenceValue, getHealthThresholds, removeLocation, removeReferenceValue, resetSettings, setHealthThresholds } from '@/server/dal/settings';
import { translateMessage } from '@/server/interchange/messages';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { canEditSettings, SETTINGS_DIRECTOR_ONLY } from '@/domain/settings-rules';
import { adminErrorT, machineTypeCreatedT, syncToastT } from './i18n';
import { removedEntryToastT, settingsErrorT } from './settings-i18n';

export type AdminActionResult = { ok: true; toast?: string; code?: string } | { error: string };

type AdminScreen = 'settings' | 'mtypes' | 'plumbing';
const READ_ONLY: Record<AdminScreen, string> = {
  settings: 'Settings are read-only for you',
  mtypes: 'Machine types are read-only for you',
  plumbing: 'Activity & integrations is read-only for you',
};

const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

/** The viewer may edit `screen` (not outside the workspace); returns the DAL actor or a (translated) refusal. */
async function editor(screen: AdminScreen): Promise<{ actor: Actor } | { error: string }> {
  const access = await getScreenAccess(screen);
  if (!access.canEdit) return { error: await tr(READ_ONLY[screen]) };
  return { actor: { name: access.viewer.name, role: access.viewer.role } };
}

/** Rule refusals keep their (translated) message; anything else is a generic failure. */
async function failure(e: unknown): Promise<{ error: string }> {
  const { t, lang } = await getI18n();
  const msg = e instanceof Error ? e.message : '';
  return { error: settingsErrorT(msg, t) ?? adminErrorT(msg, t, lang) ?? t('The change could not be saved') };
}

const fail = async (english: string) => ({ error: await tr(english) });
/** Invalid input: the read-only refusal first (a viewer outside the workspace learns nothing more), else `english`. */
async function invalid(screen: AdminScreen, english = 'Invalid request'): Promise<{ error: string }> {
  const r = await editor(screen);
  return 'error' in r ? r : fail(english);
}

async function run(screen: AdminScreen, write: (actor: Actor) => Promise<unknown>): Promise<AdminActionResult> {
  const ok = await editor(screen);
  if ('error' in ok) return ok;
  try {
    await write(ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

// ── Settings ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Settings editor (A-14, src/domain/settings-rules.ts): the Settings workspace (others get the read-only refusal), and
 * among its roles only the portfolio director edits.
 */
async function settingsEditor(): Promise<{ actor: Actor } | { error: string }> {
  const r = await editor('settings');
  if ('error' in r) return r;
  return canEditSettings(r.actor.role) ? r : { error: await tr(SETTINGS_DIRECTOR_ONLY) };
}

/** A public holiday's date is a real 2026 day ("14 Jul · Fête nationale"; "31 Feb · …" refused). */
function isRealHoliday(text: string): boolean {
  const iso = isoOfDisplayDate(text.split(' · ')[0]);
  if (!iso || !text.includes(' · ')) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** "Add" on a list card: `listKey` = the card, `raw` = the draft, `locType` = the selected location type (Locations). */
export async function addSettingsEntryAction(listKey: unknown, raw: unknown, locType?: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  if (!isSettingsCardKey(listKey) || !isText(raw, 200)) return fail('Invalid request');
  const entry = listKey === 'holidays' ? holidayEntry(raw) : settingsEntry(raw);
  if (!entry) return fail(listKey === 'locations' ? 'Location is required' : 'Entry is required');
  if (entry.length > 120) return fail('Invalid request');
  if (listKey === 'holidays' && !isRealHoliday(entry)) return fail('A holiday reads "14 Jul · Fête nationale"');
  try {
    if (listKey === 'locations') {
      const type = locType ?? 'central_warehouse';
      if (!locationType.isCode(type)) return fail('Invalid location type');
      await addLocation(entry, type, ok.actor);
    } else await addReferenceValue(listKey, entry, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

/**
 * "Remove" (×) on a list entry: `id` = the location name or the reference value code. A value still in use (or a
 * default) is deactivated, an unused custom value deleted (A-14) — the toast says which.
 */
export async function removeSettingsEntryAction(listKey: unknown, id: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  if (!isSettingsCardKey(listKey) || !isText(id, 200) || !id) return fail('Invalid request');
  let toast: string | undefined;
  try {
    if (listKey === 'locations') await removeLocation(id, ok.actor);
    else {
      const r = await removeReferenceValue(listKey, id, ok.actor);
      const { t, lang } = await getI18n();
      toast = removedEntryToastT(r, t, lang);
    }
  } catch (e) {
    return failure(e);
  }
  refresh();
  return toast ? { ok: true, toast } : { ok: true };
}

/** "At risk below" / "Off track below": a number; off track stays strictly under at risk. */
export async function setHealthThresholdAction(which: unknown, raw: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  if (which !== 'risk' && which !== 'off') return fail('Invalid request');
  const v = parseThresholdInput(raw);
  if (v === null) return fail('Enter a threshold between 0 and 2');
  const next = { ...(await getHealthThresholds()), [which]: v };
  const err = thresholdsError(next);
  if (err) return fail(err);
  try {
    await setHealthThresholds({ [which]: v }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

/** Header primary "Reset to defaults": SETTINGS0 lists, the six default locations, default thresholds. */
export async function resetSettingsAction(): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  try {
    await resetSettings(ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, toast: await tr('Settings reset to defaults') };
}

// ── Machine types ──────────────────────────────────────────────────────────────────────────────────────

async function knownType(code: unknown): Promise<string | null> {
  if (!isText(code, 40) || !code) return null;
  return (await getMachineType(code))?.code ?? null;
}

/**
 * Identity card and payment pattern: `label`, `description`, `calendar` (code), `active`, and the shares `depositPct`,
 * `deliveryPct`, `acceptancePct` as typed (parseInt || 0, 0–100; a total other than 100 % is saved and flagged).
 */
export async function updateMachineTypeAction(code: unknown, patch: Record<string, unknown>): Promise<AdminActionResult> {
  const ok = await editor('mtypes');
  if ('error' in ok) return ok;
  const mt = await knownType(code);
  if (!mt || !patch || typeof patch !== 'object') return fail('Invalid request');
  const p: MachineTypePatch = {};
  if ('label' in patch) {
    if (!isText(patch.label, 200)) return fail('Invalid request');
    if (!patch.label.trim()) return fail('Label is required');
    p.label = patch.label;
  }
  if ('description' in patch) {
    if (!isText(patch.description, 2000)) return fail('Invalid request');
    p.description = patch.description;
  }
  if ('calendar' in patch) {
    if (!MT_CALENDAR_OPTIONS.some((o) => o.value === patch.calendar)) return fail('Invalid calendar');
    p.calendar = patch.calendar as CalendarCode;
  }
  if ('active' in patch) {
    if (typeof patch.active !== 'boolean') return fail('Invalid request');
    p.active = patch.active;
  }
  for (const k of ['depositPct', 'deliveryPct', 'acceptancePct'] as const) {
    if (!(k in patch)) continue;
    if (typeof patch[k] !== 'string' && typeof patch[k] !== 'number') return fail('Invalid request');
    p[k] = parsePercentInput(patch[k]);
  }
  try {
    await updateMachineType(mt, p, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

const textList = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= 60 && v.every((x) => isText(x, 200)) ? (v as string[]) : null);

/** Standard phases ("Add phase" appends "New phase"; rename; remove): the whole list in order. */
export async function setMachineTypePhasesAction(code: unknown, phases: unknown): Promise<AdminActionResult> {
  const mt = await knownType(code);
  const list = textList(phases);
  if (!mt || !list) return invalid('mtypes');
  return run('mtypes', (actor) => setMachineTypePhases(mt, list, actor));
}

/** ITP systems ("Add system" appends "New system"; rename; remove): the whole list in order. */
export async function setMachineTypeItpSystemsAction(code: unknown, systems: unknown): Promise<AdminActionResult> {
  const mt = await knownType(code);
  const list = textList(systems);
  if (!mt || !list) return invalid('mtypes');
  return run('mtypes', (actor) => setMachineTypeItpSystems(mt, list, actor));
}

/** Cost categories (reference budget, k€): `{ name, type (code), budget (as typed) }[]` in order. */
export async function setMachineTypeCostCategoriesAction(code: unknown, cats: unknown): Promise<AdminActionResult> {
  const ok = await editor('mtypes');
  if ('error' in ok) return ok;
  const mt = await knownType(code);
  if (!mt || !Array.isArray(cats) || cats.length > 60) return fail('Invalid request');
  const rows: { name: string; type: CostType; budgetKeur: number }[] = [];
  for (const [i, c] of cats.entries()) {
    if (!c || typeof c !== 'object' || !isText(c.name, 200)) return fail('Invalid request');
    if (!MT_COST_TYPES.includes(c.type)) return failure(new Error(`Category ${i + 1}: invalid type`));
    const b = parseBudgetInput(c.budget);
    if (b === null || b < 0) return failure(new Error(`Category ${i + 1}: invalid budget`));
    rows.push({ name: c.name, type: c.type, budgetKeur: b });
  }
  try {
    await setMachineTypeCostCategories(mt, rows, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

/** Removes a reference project from the financial REX. */
export async function removeRexReferenceAction(code: unknown, analyticCode: unknown): Promise<AdminActionResult> {
  const mt = await knownType(code);
  if (!mt || !isText(analyticCode, 40) || !analyticCode) return invalid('mtypes');
  return run('mtypes', (actor) => removeRexReference(mt, analyticCode, actor));
}

/**
 * Header primary "New machine type" (AF.mtype): `code` (upper-cased, spaces → "-"), `label`, `base` (a template code or
 * 'blank'), `cal` (calendar code), `desc`. Returns the new code (the screen selects it) and the toast.
 */
export async function createMachineTypeAction(values: FormValues): Promise<AdminActionResult> {
  const ok = await editor('mtypes');
  if ('error' in ok) return ok;
  if (!values || typeof values !== 'object') return fail('Invalid request');
  const { code, label, base, cal, desc } = values;
  if (!isText(code, 40) || !isText(label, 200) || !isText(desc ?? '', 2000)) return fail('Invalid request');
  if (!normaliseMachineTypeCode(code)) return fail('Code is required');
  if (!label.trim()) return fail('Label is required');
  const b = MT_FORM_BASES.find((o) => o.value === base || o.label === base);
  if (!b) return fail('Invalid request');
  const c = MT_FORM_CALENDARS.find((o) => o.value === cal || o.label === cal);
  if (!c) return fail('Invalid calendar');
  let created: string;
  try {
    created = await createMachineType({ code, label, base: b.value, calendar: c.value, description: desc ?? '' }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  const { t } = await getI18n();
  return { ok: true, code: created, toast: machineTypeCreatedT(created, t) };
}

// ── Activity & integrations ────────────────────────────────────────────────────────────────────────────

/** "Sync now" of a connector row (Codex index, Vigie and Cursus connectors for real; the others simulated; refused when disabled). */
export async function syncConnectorAction(name: unknown): Promise<AdminActionResult> {
  const ok = await editor('plumbing');
  if ('error' in ok) return ok;
  if (!isText(name, 80) || !(await listAdminConnectors()).some((c) => c.name === name)) return fail('Invalid request');
  try {
    const r = await syncAdminConnector(name, ok.actor);
    refresh();
    const { t, lang } = await getI18n();
    return r.ok ? { ok: true, toast: syncToastT(name, r, t, lang) } : { error: syncToastT(name, r, t, lang) };
  } catch (e) {
    // D-7a: a connector disabled by IT is not synchronised (checked in the DAL `syncConnector`).
    if (e instanceof ConnectorDisabledError) return { error: translateMessage(e.message, (await getI18n()).t) };
    return failure(e);
  }
}

/** Header primary "Add connector" (AF.plumbing): `system`, `direction` (code), `freq`, `owner`. */
export async function addConnectorAction(values: FormValues): Promise<AdminActionResult> {
  const ok = await editor('plumbing');
  if ('error' in ok) return ok;
  if (!values || typeof values !== 'object') return fail('Invalid request');
  const { system, direction, freq, owner } = values;
  if (!isText(system, 80) || !ADDABLE_SYSTEMS.includes(system)) return fail('Invalid request');
  if (direction !== 'import' && direction !== 'export' && direction !== 'both') return fail('Invalid direction');
  if (!isText(freq, 40) || !CONNECTOR_FREQUENCIES.includes(freq)) return fail('Invalid frequency');
  if (!isText(owner ?? '', 120)) return fail('Invalid request');
  try {
    await addConnector({ system, direction, frequency: freq, owner: owner ?? null }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, toast: await tr('Connector added · not connected until IT sets it up') };
}
