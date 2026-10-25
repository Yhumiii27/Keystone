'use server';
// R-158 lot A — Shipments Server Functions (Shipments screen, docs/delivery-9/notes-r158-shipments.md). Each one checks that
// the viewer may edit the project's shipments (`getProjectContext(code, 'shipments').canEdit('shipments')` = `canEditShipments`:
// the director, Logistics, the project's leads; the client is sent home), validates the untrusted input with the domain parsers
// (src/domain/shipment-input.ts), writes through the Shipments DAL with the viewer as the actor (the DAL re-checks the right and
// the shipment's status, records the audit row and the activity event), then revalidates the app (the Shipments screen, the
// lifecycle deliverable of the register).
import { revalidatePath } from 'next/cache';
import {
  isGapKey, isUuid, parseGapReason, parseItemForm, parseLoadForm, parseShipmentForm, parseStepForm,
} from '@/domain/shipment-input';
import { SHIPMENT_REF_RE, isShipmentStatus } from '@/domain/shipments';
import {
  SHIPMENT_ERRORS, addItem, addLoad, advanceShipment, createShipment, justifyGap, removeItem, removeLoad, removeShipment, reopenPacking, setShipmentStep,
  updateItem, updateLoad, updateShipment, validatePacking,
} from '@/server/dal/shipments';
import type { Actor } from '@/server/dal/ops-common';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type ShipmentActionResult = { ok: true; toast?: string; ref?: string } | { error: string };

const READ_ONLY = 'The shipments are read-only for you';
const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

/** Form values as sent by the client, keeping string entries only. */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** The project and the viewer as actor, after checking the viewer may edit the project's shipments. */
async function editor(code: unknown): Promise<{ code: string; actor: Actor } | { error: string }> {
  if (typeof code !== 'string' || !code || code.length > 40) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'shipments');
  if (!ctx.canEdit('shipments')) return { error: await tr(READ_ONLY) };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

const isRef = (v: unknown): v is string => typeof v === 'string' && SHIPMENT_REF_RE.test(v);
const isLoadNumber = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999;

async function failure(e: unknown): Promise<{ error: string }> {
  const msg = e instanceof Error ? e.message : '';
  return { error: await tr((SHIPMENT_ERRORS as readonly string[]).includes(msg) ? msg : 'The change could not be saved') };
}

/** Rights first (a viewer who may not edit learns nothing more), then the input, then the write. */
async function run(code: unknown, valid: boolean, write: (code: string, actor: Actor) => Promise<unknown>, toast?: string): Promise<ShipmentActionResult> {
  const ok = await editor(code);
  if ('error' in ok) return ok;
  if (!valid) return { error: await tr('Invalid request') };
  try {
    await write(ok.code, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return toast ? { ok: true, toast: await tr(toast) } : { ok: true };
}

/** A form's parse error after the rights check. */
async function parsed<T>(code: unknown, p: { ok: true; value: T } | { ok: false; error: string }): Promise<{ code: string; actor: Actor; value: T } | { error: string }> {
  const ok = await editor(code);
  if ('error' in ok) return ok;
  if (!p.ok) return { error: await tr(p.error) };
  return { ...ok, value: p.value };
}

/** "New shipment" → EXP-nn (draft). */
export async function createShipmentAction(code: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseShipmentForm(strings(values)));
  if ('error' in r) return r;
  let ref: string;
  try {
    ref = await createShipment(r.code, r.value, r.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, ref, toast: `${ref} · ${await tr('Shipment created')}` };
}

/** "Edit shipment". */
export async function updateShipmentAction(code: unknown, ref: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseShipmentForm(strings(values)));
  if ('error' in r) return r;
  if (!isRef(ref)) return { error: await tr('Invalid request') };
  return run(r.code, true, (c, a) => updateShipment(c, ref, r.value, a), 'Shipment saved');
}

/** "Remove" a draft shipment. */
export async function removeShipmentAction(code: unknown, ref: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref), (c, a) => removeShipment(c, ref as string, a), 'Shipment removed');
}

/** "Add load". */
export async function addLoadAction(code: unknown, ref: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseLoadForm(strings(values)));
  if ('error' in r) return r;
  return run(r.code, isRef(ref), (c, a) => addLoad(c, ref as string, r.value, a), 'Load added');
}

/** "Edit load". */
export async function updateLoadAction(code: unknown, ref: unknown, number: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseLoadForm(strings(values)));
  if ('error' in r) return r;
  return run(r.code, isRef(ref) && isLoadNumber(number), (c, a) => updateLoad(c, ref as string, number as number, r.value, a), 'Load saved');
}

/** "Remove load" and its content. */
export async function removeLoadAction(code: unknown, ref: unknown, number: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref) && isLoadNumber(number), (c, a) => removeLoad(c, ref as string, number as number, a), 'Load removed');
}

/** "Add content" — `values.load` is the load's number. */
export async function addItemAction(code: unknown, ref: unknown, values: unknown): Promise<ShipmentActionResult> {
  const v = strings(values);
  const r = await parsed(code, parseItemForm(v));
  if ('error' in r) return r;
  const load = Number(v.load);
  return run(r.code, isRef(ref) && isLoadNumber(load), (c, a) => addItem(c, ref as string, load, r.value, a), 'Content added');
}

/** "Edit content" (`values.load` may move it to another load). */
export async function updateItemAction(code: unknown, ref: unknown, id: unknown, values: unknown): Promise<ShipmentActionResult> {
  const v = strings(values);
  const r = await parsed(code, parseItemForm(v));
  if ('error' in r) return r;
  const load = Number(v.load);
  return run(r.code, isRef(ref) && isUuid(id) && isLoadNumber(load), (c, a) => updateItem(c, ref as string, id as string, load, r.value, a), 'Content saved');
}

/** "Remove content". */
export async function removeItemAction(code: unknown, ref: unknown, id: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref) && isUuid(id), (c, a) => removeItem(c, ref as string, id as string, a), 'Content removed');
}

/** "Justify" a gap of the packing control (decision 4). */
export async function justifyGapAction(code: unknown, ref: unknown, key: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseGapReason(strings(values).reason));
  if ('error' in r) return r;
  return run(r.code, isRef(ref) && isGapKey(key), (c, a) => justifyGap(c, ref as string, key as string, r.value, a), 'Gap justified');
}

/** "Validate packing list" → prepared (control cleared, decision 4). */
export async function validatePackingAction(code: unknown, ref: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref), (c, a) => validatePacking(c, ref as string, a), 'Packing list validated');
}

/** "Reopen packing list" → draft. */
export async function reopenPackingAction(code: unknown, ref: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref), (c, a) => reopenPacking(c, ref as string, a), 'Packing list reopened');
}

/** "Mark picked up" … "Close shipment": one status forward from `from` (the status the viewer saw). */
export async function advanceShipmentAction(code: unknown, ref: unknown, from: unknown): Promise<ShipmentActionResult> {
  return run(code, isRef(ref) && isShipmentStatus(from), (c, a) => advanceShipment(c, ref as string, from as never, a), 'Shipment status updated');
}

/** "Edit step" of a step EPC2i organises. */
export async function setShipmentStepAction(code: unknown, ref: unknown, step: unknown, values: unknown): Promise<ShipmentActionResult> {
  const r = await parsed(code, parseStepForm(step, strings(values)));
  if ('error' in r) return r;
  return run(r.code, isRef(ref), (c, a) => setShipmentStep(c, ref as string, r.value, a), 'Step saved');
}
