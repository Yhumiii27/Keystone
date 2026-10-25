'use server';
// Administration Server Functions: Settings — personalisable lists (docs/spec/10 §1.5: add / remove entries, location
// type, health thresholds, "Reset to defaults"), Standard machine types (09 §9: identity card, payment pattern, phases,
// ITP systems, cost categories, REX references, "New machine type") and Activity & integrations (10 §2: "Sync now"; the
// connectors themselves are configured by IT outside Keystone — D-7a, R-020: no "Add connector" any more). Each one checks the viewer may edit the screen (roles with the screen in their workspace — the
// "Outside my workspace · Read-only" rule; machine types: `mtCanEdit` = director, PM, engineering lead, quality, the same
// roles), validates the raw input with the domain parsers, writes through the DAL with the viewer as the actor (the DAL
// re-checks the workspace and records the audit row), then revalidates the app (lists used by other screens, badges).
import { revalidatePath } from 'next/cache';
import type { FormValues } from '@/components/app/form-def';
import {
  MT_CALENDAR_OPTIONS, MT_COST_TYPES, MT_FORM_BASES, MT_FORM_CALENDARS, holidayEntry, isSettingsCardKey, normaliseMachineTypeCode, parseBudgetInput,
  parsePercentInput, parseThresholdInput, settingsEntry, thresholdsError,
} from '@/domain/admin';
import { yearOfIso } from '@/domain/clock';
import { businessToday } from '@/server/clock';
import { isoOfDisplayDate, locationType, type CalendarCode, type CostType } from '@/server/db/codes';
import { listAdminConnectors, syncAdminConnector } from '@/server/dal/admin-connectors';
import { ConnectorDisabledError } from '@/server/dal/integrations';
import {
  createMachineType, getMachineType, removeRexReference, setMachineTypeCostCategories, setMachineTypeItpSystems, setMachineTypePack, setMachineTypePhaseScope,
  setMachineTypePhases, updateMachineType,
  type MachineTypePatch,
} from '@/server/dal/mtypes';
import { PACK_FAMILIES, PACK_INVALID_ERROR, isPackFamily, packStandardError, type PackStandardRow } from '@/domain/engineering-pack';
import type { Actor } from '@/server/dal/ops-common';
import {
  CCB_THRESHOLD_ERROR, HOURS_VARIANCE_RANGE, addLocation, addReferenceValue, getHealthThresholds, removeLocation, removeReferenceValue, resetSettings, setCcbThreshold, setHealthThresholds, setHoursVariance,
} from '@/server/dal/settings';
import { isCcbThreshold } from '@/domain/change-control';
import { parseHoursVarianceInput } from '@/domain/hr';
import { translateMessage } from '@/server/interchange/messages';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { canEditSettings, SETTINGS_DIRECTOR_ONLY } from '@/domain/settings-rules';
import { INCOTERM_CODE_RE, normaliseIncotermCode, parseIncoterm } from '@/domain/incoterms';
import { reactivateIncoterm, removeIncoterm, saveIncoterm } from '@/server/dal/incoterms';
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

/** A public holiday's date is a real day of the business year `year` ("14 Jul · Fête nationale"; "31 Feb · …" refused). */
function isRealHoliday(text: string, year: number): boolean {
  const iso = isoOfDisplayDate(text.split(' · ')[0], year);
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
  if (listKey === 'holidays' && !isRealHoliday(entry, yearOfIso(await businessToday()))) return fail('A holiday reads "14 Jul · Fête nationale"');
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

/** R-088 (R-6b): "Hours variance threshold (%)" — an integer 1–50 (the portfolio director, A-14); the Hours screen follows it. */
export async function setHoursVarianceAction(raw: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  const pct = parseHoursVarianceInput(raw);
  if (pct === null) return fail(HOURS_VARIANCE_RANGE);
  try {
    await setHoursVariance(pct, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

/**
 * Delivery 8 (R-069, P-6c): "Change control board above (k€)" — a number of k€, 0 or more; the director only. It applies to the
 * change requests submitted afterwards (the steps are fixed at submission).
 */
export async function setCcbThresholdAction(raw: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  const v = parseThresholdInput(raw);
  if (v === null || !isCcbThreshold(v)) return fail(CCB_THRESHOLD_ERROR);
  try {
    await setCcbThreshold(v, ok.actor);
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

/**
 * R-185 / R-186: a standard phase specific to an equipment (generated once per equipment line) or common to the project — same
 * rights as the rest of the type editor (moved here from the catalogue Server Functions when the catalogue got its own screen).
 */
export async function setMachineTypePhaseScopeAction(code: unknown, position: unknown, perEquipment: unknown): Promise<AdminActionResult> {
  const mt = await knownType(code);
  if (!mt || typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > 200 || typeof perEquipment !== 'boolean') return invalid('mtypes');
  return run('mtypes', (actor) => setMachineTypePhaseScope(mt, position, perEquipment, actor));
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

/** A whole number typed in a field ("20", 20) — null for anything else ("", "12.5", "abc"). */
const wholeNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string' || !/^\s*\d{1,3}\s*$/.test(v)) return null;
  return Number(v.trim());
};

/**
 * R-191: the standard list of the engineering pack — `{ family, weight, minExpected }[]` (the five families, weights and minimums
 * as typed). Same rights as the rest of the type editor; refused unless the weights total 100 %.
 */
export async function setMachineTypePackAction(code: unknown, rows: unknown): Promise<AdminActionResult> {
  const ok = await editor('mtypes');
  if ('error' in ok) return ok;
  const mt = await knownType(code);
  if (!mt || !Array.isArray(rows) || rows.length > PACK_FAMILIES.length) return fail('Invalid request');
  const parsed: PackStandardRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !isPackFamily(r.family)) return fail('Invalid request');
    const weight = wholeNumber(r.weight);
    const minExpected = wholeNumber(r.minExpected);
    if (weight === null || minExpected === null) return fail(PACK_INVALID_ERROR);
    parsed.push({ family: r.family, weight, minExpected });
  }
  const error = packStandardError(parsed);
  if (error) return fail(error);
  try {
    await setMachineTypePack(mt, parsed, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, toast: await tr('Engineering pack saved') };
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

// ── R-158 lot A (owner's decision 9): Settings › Incoterms ─────────────────────────────────────────────────────────────

const INCOTERM_ERRORS = ['This Incoterm already exists', 'Unknown Incoterm', 'An Incoterm code is three letters', 'Enter the Incoterm’s name', 'Text too long'];

async function incotermFailure(e: unknown): Promise<{ error: string }> {
  const msg = e instanceof Error ? e.message : '';
  return INCOTERM_ERRORS.includes(msg) ? fail(msg) : failure(e);
}

/** "Add Incoterm" (`mode` create) or "Edit" (update: the code is the row's) — the Settings editors (the portfolio director). */
export async function saveIncotermAction(mode: unknown, values: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  if ((mode !== 'create' && mode !== 'update') || !values || typeof values !== 'object') return fail('Invalid request');
  const parsed = parseIncoterm(values as Record<string, unknown>);
  if (!parsed.ok) return fail(parsed.error);
  try {
    await saveIncoterm(parsed.value, mode, ok.actor);
  } catch (e) {
    return incotermFailure(e);
  }
  refresh();
  return { ok: true, toast: await tr(mode === 'create' ? 'Incoterm added' : 'Incoterm saved') };
}

/** "Remove": deleted when unused and added in Keystone, else deactivated (a standard or used Incoterm is kept). */
export async function removeIncotermAction(code: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  const c = normaliseIncotermCode(code);
  if (!INCOTERM_CODE_RE.test(c)) return fail('Invalid request');
  let mode: 'deleted' | 'deactivated';
  try {
    mode = await removeIncoterm(c, ok.actor);
  } catch (e) {
    return incotermFailure(e);
  }
  refresh();
  return { ok: true, toast: await tr(mode === 'deleted' ? 'Incoterm deleted' : 'Incoterm deactivated') };
}

/** "Reactivate" a deactivated Incoterm. */
export async function reactivateIncotermAction(code: unknown): Promise<AdminActionResult> {
  const ok = await settingsEditor();
  if ('error' in ok) return ok;
  const c = normaliseIncotermCode(code);
  if (!INCOTERM_CODE_RE.test(c)) return fail('Invalid request');
  try {
    await reactivateIncoterm(c, ok.actor);
  } catch (e) {
    return incotermFailure(e);
  }
  refresh();
  return { ok: true, toast: await tr('Incoterm reactivated') };
}
