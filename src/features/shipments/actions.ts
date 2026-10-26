'use server';
// R-158 lot A — Shipments Server Functions (Shipments screen, docs/delivery-9/notes-r158-shipments.md). Each one checks that
// the viewer may edit the project's shipments (`getProjectContext(code, 'shipments').canEdit('shipments')` = `canEditShipments`:
// the director, Logistics, the project's leads; the client is sent home), validates the untrusted input with the domain parsers
// (src/domain/shipment-input.ts), writes through the Shipments DAL with the viewer as the actor (the DAL re-checks the right and
// the shipment's status, records the audit row and the activity event), then revalidates the app (the Shipments screen, the
// lifecycle deliverable of the register). Lot B: the site reception (the shipment editors and the site team, `canRecordReception`),
// the manual closure, the filing of the shipping documents in Codex and the freight-delay risk (a lead who edits the risks).
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
import { canRecordReception } from '@/domain/rights';
import { FORM_CATEGORIES, parseNewRisk } from '@/domain/risk';
import { orderedOptions } from '@/domain/settings-rules';
import {
  CLOSE_REASON_MAX, FREIGHT_RISK_LEADS_ONLY, FREIGHT_RISK_NOT_LATE, freightDelayDays, freightRiskTrigger, parseItemReception, parseLoadReception,
} from '@/domain/shipment-reception';
import { isShippingDocKind } from '@/domain/shipping-documents';
import { displayOfIso } from '@/server/db/codes';
import { riskOwnerOptions } from '@/server/dal/risks-screen';
import { riskCategoryOptions } from '@/server/dal/settings-lists';
import { RECEPTION_ERRORS, closeShipment, completeReception, pointItem, pointLoad, raiseFreightRisk } from '@/server/dal/shipment-reception';
import { FILING_ERRORS, fileShippingDocument } from '@/server/dal/shipment-documents';
import { getProjectShipments } from '@/server/dal/shipments';
import { RISK_RESULT } from '@/features/risks/forms';

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

// ── Lot B: site reception, documents filed in Codex, freight-delay risk ────────────────────────────────────────────

/** The project and the viewer as actor, after checking the viewer may point the reception (`canRecordReception`). */
async function receiver(code: unknown): Promise<{ code: string; actor: Actor } | { error: string }> {
  if (typeof code !== 'string' || !code || code.length > 40) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'shipments');
  if (!canRecordReception(ctx.viewer.role, ctx.access)) return { error: await tr('The reception is read-only for you') };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

async function receptionFailure(e: unknown): Promise<{ error: string }> {
  const msg = e instanceof Error ? e.message : '';
  const known = [...RECEPTION_ERRORS, ...SHIPMENT_ERRORS, ...FILING_ERRORS] as readonly string[];
  return { error: await tr(known.includes(msg) ? msg : 'The change could not be saved') };
}

async function receptionRun(code: string, write: (code: string, actor: Actor) => Promise<unknown>, toast: string, actor: Actor): Promise<ShipmentActionResult> {
  try {
    await write(code, actor);
  } catch (e) {
    return receptionFailure(e);
  }
  refresh();
  return { ok: true, toast: await tr(toast) };
}

/** "Point the load" (received, missing, damaged) once the shipment has arrived. */
export async function pointLoadAction(code: unknown, ref: unknown, number: unknown, values: unknown): Promise<ShipmentActionResult> {
  const ok = await receiver(code);
  if ('error' in ok) return ok;
  const p = parseLoadReception(strings(values));
  if (!p.ok) return { error: await tr(p.error) };
  if (!isRef(ref) || !isLoadNumber(number)) return { error: await tr('Invalid request') };
  const { t } = await getI18n();
  return receptionRun(ok.code, (c, a) => pointLoad(c, ref, number, p.value, a, t), 'Reception recorded', ok.actor);
}

/** "Point the content line": quantities received, missing, damaged (their sum = the quantity shipped). */
export async function pointItemAction(code: unknown, ref: unknown, id: unknown, values: unknown): Promise<ShipmentActionResult> {
  const ok = await receiver(code);
  if ('error' in ok) return ok;
  if (!isRef(ref) || !isUuid(id)) return { error: await tr('Invalid request') };
  const data = await getProjectShipments(ok.code);
  const item = data?.shipments.find((s) => s.ref === ref)?.loads.flatMap((l) => l.items).find((i) => i.id === id);
  if (!item) return { error: await tr('Unknown item') };
  const p = parseItemReception(strings(values), item.quantity);
  if (!p.ok) return { error: await tr(p.error) };
  const { t } = await getI18n();
  return receptionRun(ok.code, (c, a) => pointItem(c, ref, id, p.value, a, t), 'Reception recorded', ok.actor);
}

/** "Complete the reception" → received on site. */
export async function completeReceptionAction(code: unknown, ref: unknown): Promise<ShipmentActionResult> {
  const ok = await receiver(code);
  if ('error' in ok) return ok;
  if (!isRef(ref)) return { error: await tr('Invalid request') };
  return receptionRun(ok.code, (c, a) => completeReception(c, ref, a), 'Reception completed', ok.actor);
}

/** "Close shipment" by hand (a shipment editor), with a reason while punch items are open. */
export async function closeShipmentAction(code: unknown, ref: unknown, values: unknown): Promise<ShipmentActionResult> {
  const ok = await editor(code);
  if ('error' in ok) return ok;
  if (!isRef(ref)) return { error: await tr('Invalid request') };
  const reason = (strings(values).reason ?? '').trim();
  if (reason.length > CLOSE_REASON_MAX) return { error: await tr('Text is too long') };
  return receptionRun(ok.code, (c, a) => closeShipment(c, ref, reason || null, a), 'Shipment closed', ok.actor);
}

/** "File in Codex": the shipping document generated and deposited (a shipment editor). */
export async function fileShippingDocumentAction(code: unknown, ref: unknown, kind: unknown): Promise<ShipmentActionResult> {
  const ok = await editor(code);
  if ('error' in ok) return ok;
  if (!isRef(ref) || !isShippingDocKind(kind)) return { error: await tr('Invalid request') };
  const i18n = await getI18n();
  let filed: { number: string; revision: string };
  try {
    filed = await fileShippingDocument(ok.code, ref, kind, ok.actor, i18n);
  } catch (e) {
    return receptionFailure(e);
  }
  refresh();
  return { ok: true, toast: `${filed.number} · ${i18n.t('rev')} ${filed.revision} · ${i18n.t('Filed in Codex')}` };
}

/** "Create a risk" from the freight-delay warning (a lead of the project who edits the risk register; never automatic). */
export async function raiseFreightRiskAction(code: unknown, ref: unknown, values: unknown): Promise<ShipmentActionResult> {
  if (typeof code !== 'string' || !code || code.length > 40 || !isRef(ref)) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'shipments');
  if (!ctx.isLead || !ctx.canEdit('risks')) return { error: await tr(FREIGHT_RISK_LEADS_ONLY) };
  const data = await getProjectShipments(project.code);
  const s = data?.shipments.find((x) => x.ref === ref);
  if (!data || !s) return { error: await tr('Unknown shipment') };
  if (!data.need || freightDelayDays(s, data.need) == null) return { error: await tr(FREIGHT_RISK_NOT_LATE) };
  const [team, cats] = await Promise.all([riskOwnerOptions(project.code), riskCategoryOptions()]);
  const parsed = parseNewRisk(strings(values), team, orderedOptions(cats.active, FORM_CATEGORIES).map((c) => c.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const { t } = await getI18n();
  const trigger = freightRiskTrigger(ref, t(displayOfIso(s.eta!)), data.need, t(displayOfIso(data.need.date)), t);
  let number: string;
  try {
    number = await raiseFreightRisk(project.code, ref, parsed.value, trigger, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    return receptionFailure(e);
  }
  refresh();
  return { ok: true, toast: `${number} · ${await tr(RISK_RESULT)}` };
}
