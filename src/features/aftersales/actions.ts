'use server';
// Warranty & after-sales Server Functions (docs/spec/07 §3 AF `fleet` "Add machine" and AF `sav` "New warranty claim").
// Each one checks the viewer's workspace includes the screen (director, pm, quality, procurement — the others reach the
// screens "outside my workspace", read-only), validates the raw form values with the domain parsers against the
// current options, writes through the data-layer writers with the viewer as the actor (audit trail, activity), then
// revalidates every page (the sidebar badge, the zone bar counts, the part record's installed base and both screens).
// Messages are English source strings translated per " · " segment.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseNewClaim, parseNewMachine } from '@/domain/aftersales';
import { yearOfIso } from '@/domain/clock';
import { parseClaimUpdate, parseDiagnosis, parseInterventionDone, parsePlanIntervention, parseRegisterMachines } from '@/domain/claims';
import { businessToday } from '@/server/clock';
import { claimFormOptions, machineTypeOptions } from '@/server/dal/aftersales';
import {
  CLAIM_OWNERS, advanceClaim, completeIntervention, getClaim, interventionPartOptions, listInterventions, openClaim, planIntervention, updateClaim,
} from '@/server/dal/claims';
import { addMachine, listDeliveryCandidates, listMachineOptions, registerDeliveredMachines } from '@/server/dal/fleet';
import { getProject } from '@/server/dal/projects';
import { claimStatus } from '@/server/db/codes';
import { getScreenAccess, projectAccessResolver } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { CLAIM_RESULT, MACHINE_RESULT } from './forms';
import { messageText } from './i18n';
import { logError } from '@/server/log';

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

const refreshAll = () => revalidatePath('/', 'layout');

/** "Add machine": MCH-050, MCH-051…, no delivering project, In warranty; toast "Machine added to the installed base". */
export async function addMachineAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('fleet')]);
  if (!access.canEdit) return { error: messageText('The installed base is read-only for you', t) };
  const parsed = parseNewMachine(strings(values), (await machineTypeOptions()).map((m) => m.code), yearOfIso(await businessToday()));
  if (!parsed.ok) return { error: messageText(parsed.error, t) };
  const v = parsed.value;
  try {
    await addMachine(
      { name: v.name, machineType: v.machineType, client: v.client, site: v.site, deliveredOn: v.deliveredOn, warrantyEndOn: v.warrantyEndOn },
      { name: access.viewer.name, role: access.viewer.role },
    );
  } catch (e) {
    logError('addMachineAction', e);
    return { error: messageText('The change could not be saved', t) };
  }
  refreshAll();
  return { toast: messageText(MACHINE_RESULT, t) };
}

/**
 * "New warranty claim" → "Open claim": WC-020, WC-021…, Open, reported on the business date (R-013), cost 0;
 * toast "Warranty claim opened".
 */
export async function openClaimAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('sav')]);
  if (!access.canEdit) return { error: messageText('Warranty claims are read-only for you', t) };
  const opts = await claimFormOptions();
  const parsed = parseNewClaim(strings(values), opts.machines.map((m) => m.number), opts.owners);
  if (!parsed.ok) return { error: messageText(parsed.error, t) };
  try {
    await openClaim(parsed.value, { name: access.viewer.name, role: access.viewer.role });
  } catch (e) {
    logError('openClaimAction', e);
    return { error: messageText('The change could not be saved', t) };
  }
  refreshAll();
  return { toast: messageText(CLAIM_RESULT, t) };
}

// ── R-143 (Q-8): claims followed end to end, interventions planned and closed ─────────────────────────────

export type ClaimStepResult = { ok: true; toast: string } | { ok: false; error: string };

const CLAIM_RE = /^WC-\d{2,}$/;
const IV_RE = /^IV-\d{2,}$/;
const READ_ONLY_SAV = 'Warranty claims are read-only for you';
const CLAIM_MOVED = 'This claim has changed since you opened it';

/** The viewer may edit Warranty claims (workspace: director, pm, quality, procurement); else the refusal. */
async function savEditor() {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('sav')]);
  return { t, ok: access.canEdit, actor: { name: access.viewer.name, role: access.viewer.role } };
}

/** "Edit claim": coverage, owner, cost (k€), next step, diagnosis, design ECO. */
export async function updateClaimAction(number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const e = await savEditor();
  if (!e.ok) return { error: messageText(READ_ONLY_SAV, e.t) };
  if (typeof number !== 'string' || !CLAIM_RE.test(number)) return { error: messageText('Invalid request', e.t) };
  const claim = await getClaim(number);
  if (!claim) return { error: messageText('Unknown claim', e.t) };
  if (claim.status === 'closed') return { error: messageText('This claim is closed', e.t) };
  const parsed = parseClaimUpdate(strings(values), CLAIM_OWNERS);
  if (!parsed.ok) return { error: messageText(parsed.error, e.t) };
  if (claim.status !== 'open' && !parsed.value.diagnosis) return { error: messageText('Enter the diagnosis', e.t) };
  try {
    await updateClaim(claim.number, parsed.value, e.actor);
  } catch (err) {
    console.error('updateClaimAction', err);
    return { error: messageText('The change could not be saved', e.t) };
  }
  refreshAll();
  return { toast: messageText(`${claim.number} · Claim updated`, e.t) };
}

/** "Mark diagnosed" (Open → Diagnosed) with the diagnosis; `from` = the status the viewer saw. */
export async function diagnoseClaimAction(number: string, from: string, values: Record<string, string>): Promise<FormDialogResult> {
  const e = await savEditor();
  if (!e.ok) return { error: messageText(READ_ONLY_SAV, e.t) };
  if (typeof number !== 'string' || !CLAIM_RE.test(number) || !claimStatus.isCode(from)) return { error: messageText('Invalid request', e.t) };
  const parsed = parseDiagnosis(strings(values));
  if (!parsed.ok) return { error: messageText(parsed.error, e.t) };
  return claimStep(number, 'diagnose', from, e, parsed.value);
}

/** "Close claim" (Diagnosed / Intervention planned → Closed, nothing still planned); `from` = the status the viewer saw. */
export async function closeClaimAction(number: string, from: string): Promise<ClaimStepResult> {
  const e = await savEditor();
  if (!e.ok) return { ok: false, error: messageText(READ_ONLY_SAV, e.t) };
  if (typeof number !== 'string' || !CLAIM_RE.test(number) || !claimStatus.isCode(from)) return { ok: false, error: messageText('Invalid request', e.t) };
  const r = await claimStep(number, 'close', from, e, null);
  return r.error ? { ok: false, error: r.error } : { ok: true, toast: r.toast! };
}

async function claimStep(number: string, step: 'diagnose' | 'close', from: string, e: Awaited<ReturnType<typeof savEditor>>, diagnosis: string | null): Promise<{ toast?: string; error?: string }> {
  const claim = await getClaim(number);
  if (!claim) return { error: messageText('Unknown claim', e.t) };
  if (claim.status !== from || !claim.steps.includes(step)) {
    refreshAll();
    return { error: messageText(claim.status !== from ? CLAIM_MOVED : step === 'close' ? 'This claim cannot be closed yet' : CLAIM_MOVED, e.t) };
  }
  try {
    const to = await advanceClaim(claim.number, step, e.actor, { diagnosis, expected: claim.status });
    refreshAll();
    return { toast: messageText(`${claim.number} · ${claimStatus.label(to)}`, e.t) };
  } catch (err) {
    if (err instanceof Error && / has moved on$| cannot take this step /.test(err.message)) {
      refreshAll();
      return { error: messageText(CLAIM_MOVED, e.t) };
    }
    console.error('claimStep', err);
    return { error: messageText('The change could not be saved', e.t) };
  }
}

/** "Plan intervention": on a claim's machine (claim drawer) or a machine chosen (Interventions view, preventive visit). */
export async function planInterventionAction(claimNumber: string | null, values: Record<string, string>): Promise<FormDialogResult> {
  const e = await savEditor();
  if (!e.ok) return { error: messageText(READ_ONLY_SAV, e.t) };
  let claim = null;
  if (claimNumber != null) {
    if (typeof claimNumber !== 'string' || !CLAIM_RE.test(claimNumber)) return { error: messageText('Invalid request', e.t) };
    claim = await getClaim(claimNumber);
    if (!claim) return { error: messageText('Unknown claim', e.t) };
    if (claim.status === 'closed') return { error: messageText('This claim is closed', e.t) };
  }
  const machines = (await listMachineOptions()).map((m) => m.number);
  const parsed = parsePlanIntervention(strings(values), { machines, claimMachine: claim?.machineNumber ?? null, year: yearOfIso(await businessToday()) });
  if (!parsed.ok) return { error: messageText(parsed.error, e.t) };
  try {
    const number = await planIntervention({ ...parsed.value, claimNumber: claim?.number ?? null }, e.actor);
    refreshAll();
    return { toast: messageText(`${number} · Intervention planned`, e.t) };
  } catch (err) {
    console.error('planInterventionAction', err);
    return { error: messageText('The change could not be saved', e.t) };
  }
}

/** "Mark done" (Planned → Done) with the report and, optionally, the part replaced and its revision (configuration, E-8). */
export async function completeInterventionAction(number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const e = await savEditor();
  if (!e.ok) return { error: messageText(READ_ONLY_SAV, e.t) };
  if (typeof number !== 'string' || !IV_RE.test(number)) return { error: messageText('Invalid request', e.t) };
  const iv = (await listInterventions()).find((i) => i.number === number);
  if (!iv) return { error: messageText('Unknown intervention', e.t) };
  if (iv.status !== 'planned') {
    refreshAll();
    return { error: messageText('This intervention is already done', e.t) };
  }
  const parsed = parseInterventionDone(strings(values), await interventionPartOptions(iv.machineNumber), await businessToday());
  if (!parsed.ok) return { error: messageText(parsed.error, e.t) };
  try {
    await completeIntervention(iv.number, parsed.value, e.actor);
  } catch (err) {
    if (err instanceof Error && / has moved on$/.test(err.message)) {
      refreshAll();
      return { error: messageText('This intervention is already done', e.t) };
    }
    console.error('completeInterventionAction', err);
    return { error: messageText('The change could not be saved', e.t) };
  }
  refreshAll();
  return { toast: messageText(`${iv.number} · Intervention done${parsed.value.partRef ? ' · Configuration updated' : ''}`, e.t) };
}

// ── R-144 (E-8): machines and their as-built configuration registered at the project's delivery ─────────────

/**
 * "Register delivered machines": a project with a bill of materials, the number of machines, base name, site, delivery
 * date and warranty end. Fleet editors (director, quality, procurement; a project manager for their own projects).
 */
export async function registerMachinesAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('fleet')]);
  if (!access.canEdit) return { error: messageText('The installed base is read-only for you', t) };
  const candidates = await listDeliveryCandidates();
  const parsed = parseRegisterMachines(strings(values), candidates.map((c) => c.projectCode), await businessToday());
  if (!parsed.ok) return { error: messageText(parsed.error, t) };
  const v = parsed.value;
  if (access.viewer.role === 'pm') {
    const project = await getProject(v.projectCode);
    if (!project || !(await projectAccessResolver(access.viewer))(project).lead) return { error: messageText('Only the project manager of this project registers its machines', t) };
  }
  try {
    const numbers = await registerDeliveredMachines(v.projectCode, { count: v.count, name: v.name, site: v.site, deliveredOn: v.deliveredOn, warrantyEndOn: v.warrantyEndOn }, {
      name: access.viewer.name, role: access.viewer.role,
    });
    refreshAll();
    return { toast: messageText(`${numbers.join(', ')} · Machines registered with their as-built configuration`, t) };
  } catch (err) {
    console.error('registerMachinesAction', err);
    return { error: messageText('The change could not be saved', t) };
  }
}
