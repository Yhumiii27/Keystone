'use server';
// Contract & Billing Server Functions (docs/spec/04 §3.5–3.6 contract sheet, AF `amendment`, `bond`, `milestone`;
// §4.5–4.6 AF `billing`, "Mark paid"). Each one checks that the viewer may edit the screen on this project (not
// outside the workspace, not a read-only project — also for the contract sheet, which the prototype left editable
// outside, 04 Q7), that the project has a contract, validates the untrusted input with the domain parsers, writes
// through the Contract DAL with the viewer as the actor, then revalidates the app (Contract, Billing, Budget › Cash
// & recovery, Cash flow, the Billing badge all read the same rows).
// Delivery 7: the amendment signature cycle and the release of a guarantee (R-079), the payment rule and the currency in the
// sheet (R-076, R-075), and the project's budget rate — the portfolio director and Finance (C-9, R-044).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import {
  INVOICE_BLOCKED_MESSAGE, parseAmendmentForm, parseBondForm, parseInvoiceForm, parseMilestoneForm, parseReleaseBondForm, parseSheetField, parseSignAmendmentForm,
} from '@/domain/contract';
import { yearOfIso } from '@/domain/clock';
import { businessToday } from '@/server/clock';
import { bondType } from '@/server/db/codes';
import {
  MilestoneEditError, addAmendment, addBond, addPaymentMilestone, getContract, issueInvoice, markInvoicePaid, releaseBond, removePaymentMilestone,
  sendAmendmentForSignature, signAmendment, updateContractSheet, updatePaymentMilestone, type ProjectContract,
} from '@/server/dal/contract';
import { canSetBudgetRate, canSetCapexLink, canSetProjectEquipment } from '@/domain/rights';
import { parseCapexLink } from '@/domain/capex-link';
import { setCapexLink } from '@/server/dal/capex-link';
import { addProjectEquipment, removeProjectEquipment, updateProjectEquipment } from '@/server/dal/project-equipment';
import { setProjectBudgetRate } from '@/server/dal/currency';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { RESULT } from './model';

export type ContractEditResult = { ok: true } | { error: string };

const refresh = () => revalidatePath('/', 'layout');

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** English message → render language, per " · " segment like the prototype's showToast. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** Resolves the project and its contract after checking the viewer may edit `screen` on it. */
async function editable(
  code: unknown, screen: 'contract' | 'billing',
): Promise<{ code: string; actor: string; viewer: { name: string; role: string }; contract: ProjectContract; year: number } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen)) return { error: await tr(screen === 'contract' ? 'This contract is read-only for you' : 'Billing is read-only for you') };
  const contract = await getContract(project.code);
  if (!contract) return { error: await tr('No contract registered for this project') };
  // R-013: a date typed without a year is in the business year.
  return { code: project.code, actor: ctx.viewer.name, viewer: { name: ctx.viewer.name, role: ctx.viewer.role }, contract, year: yearOfIso(await businessToday()) };
}

/** Contract sheet: one field saved on blur / Enter / select change (`setCtr`). */
export async function updateContractFieldAction(code: string, key: string, value: string): Promise<ContractEditResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseSheetField(key, value, ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  // C-9: the currency is EUR or the project currency with a budget rate, and fixed once an invoice is issued.
  if ('currency' in parsed.value && parsed.value.currency !== ok.contract.sheet.currency) {
    if (ok.contract.hasInvoices) return { error: await tr('The currency cannot change once an invoice is issued') };
  }
  try {
    await updateContractSheet(ok.code, parsed.value, ok.actor);
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** Messages of the DAL rules worth showing as they are (EN source, translated by `tr`). */
const KNOWN_ERRORS = [
  'The currency cannot change once an invoice is issued', 'A document is in euros or in the project currency',
  'Ask the portfolio director to set the project’s budget rate first', 'Documents of this project are in its currency: it cannot change',
  'Only a draft amendment can be sent for signature', 'Only an amendment sent for signature can be signed', 'This guarantee is already released',
  'Unknown amendment', 'Unknown guarantee', 'Enter a budget rate in euros per unit', 'Unknown currency',
  // The DAL's re-check of the budget-rate rule (defense in depth; R-044: the director and Finance).
  'Only the portfolio director and Finance set the budget rate',
];
const knownError = (e: unknown) => (e instanceof Error && KNOWN_ERRORS.includes(e.message) ? e.message : null);
const position = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000 ? v : null);

/** "Add amendment" → "Register amendment" (AF.amendment): toast "{subject} · Amendment registered". */
export async function addAmendmentAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseAmendmentForm(strings(values), ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await addAmendment(ok.code, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${parsed.value.subject} · ${t(RESULT.amendment)}` };
}

/** "Add guarantee" → "Register guarantee" (AF.bond): toast "{type} · Guarantee registered". */
export async function addBondAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseBondForm(strings(values), ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await addBond(ok.code, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${t(bondType.label(parsed.value.type))} · ${t(RESULT.bond)}` };
}

/** "Add payment milestone" → "Add milestone" (AF.milestone): M6, M7… Planned; toast "Payment milestone added". */
export async function addPaymentMilestoneAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseMilestoneForm(strings(values), ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  // NEW-D3-3: a milestone of an amendment of this contract.
  if (parsed.value.amendment != null && !ok.contract.amendments.some((a) => a.position === parsed.value.amendment)) return { error: await tr('Unknown amendment') };
  try {
    await addPaymentMilestone(ok.code, parsed.value, ok.actor);
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  return { toast: await tr(RESULT.milestone) };
}

/**
 * "Issue invoice" (AF.billing, header primary or a "To invoice" row): a planned milestone becomes Invoiced with its
 * invoice; toast "{no} · {M} · Invoice issued · sent to the client". Invoice numbers are unique.
 */
export async function issueInvoiceAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'billing');
  if ('error' in ok) return ok;
  // Planned milestones of the base contract and of the signed amendments (NEW-D3-3: an unsigned amendment's are not billable).
  const billable = ok.contract.milestones.filter((m) => m.status === 'planned' && m.billable);
  // R-077 (C-7): a milestone whose group exceeds 100 % is refused with the reason — checked before the form is parsed, else it
  // would read "Choose a milestone still to invoice".
  const asked = strings(values).ms?.split(' · ')[0]?.trim() || billable.find((m) => !m.blocked)?.number || billable[0]?.number;
  if (asked && billable.some((m) => m.number === asked && m.blocked)) return { error: await tr(INVOICE_BLOCKED_MESSAGE) };
  const planned = billable.filter((m) => !m.blocked).map((m) => m.number);
  const parsed = parseInvoiceForm(strings(values), planned, ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  if (ok.contract.invoices.some((i) => i.number === v.invoiceNumber)) return { error: `${v.invoiceNumber} · ${await tr('This invoice number is already used')}` };
  let number: string;
  try {
    number = await issueInvoice(ok.code, { milestone: v.milestone, invoiceNumber: v.invoiceNumber, issuedOn: v.issuedOn, note: v.note }, ok.actor);
  } catch (e) {
    const used = e instanceof Error && /already exists/.test(e.message);
    if (e instanceof Error && e.message === INVOICE_BLOCKED_MESSAGE) return { error: await tr(INVOICE_BLOCKED_MESSAGE) };
    return { error: used ? `${v.invoiceNumber} · ${await tr('This invoice number is already used')}` : await tr('The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${number} · ${v.milestone} · ${t(RESULT.billing[0])} · ${t(RESULT.billing[1])}` };
}

// ── Delivery 8 (R-077, C-7a): correcting the schedule ──────────────────────────────────────────────────────────────────

const MILESTONE_RE = /^M\d{1,4}$/;

/** A planned milestone of the contract (the row the viewer saw); else the refusal. */
async function plannedMilestone(ok: { contract: ProjectContract }, number: unknown): Promise<{ number: string } | { error: string }> {
  if (typeof number !== 'string' || !MILESTONE_RE.test(number)) return { error: await tr('Invalid request') };
  const m = ok.contract.milestones.find((x) => x.number === number);
  if (!m) return { error: await tr('Unknown milestone') };
  if (m.status !== 'planned') return { error: await tr('Only a planned milestone can be changed') };
  return { number };
}

const milestoneError = async (e: unknown) =>
  e instanceof MilestoneEditError ? { error: await tr(e.message) } : { error: await tr(knownError(e) ?? 'The change could not be saved') };

/**
 * "Edit" of a planned payment milestone (row action, AF.milestone without "Applies to"): label, share, contractual date, condition
 * — the basis stays. Toast "M5 · Payment milestone updated".
 */
export async function updatePaymentMilestoneAction(code: string, number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const m = await plannedMilestone(ok, number);
  if ('error' in m) return m;
  const v = strings(values);
  delete v.basis; // the basis of a milestone does not change
  const parsed = parseMilestoneForm(v, ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await updatePaymentMilestone(ok.code, m.number, { label: parsed.value.label, sharePct: parsed.value.sharePct, contractualDue: parsed.value.contractualDue, condition: parsed.value.condition }, ok.viewer);
  } catch (e) {
    return milestoneError(e);
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${m.number} · ${t(RESULT.milestoneUpdated)}` };
}

/** "Remove" of a planned payment milestone (after the confirmation; its number is never reused). Toast "M5 · Payment milestone removed". */
export async function removePaymentMilestoneAction(code: string, number: string): Promise<{ toast: string } | { error: string }> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const m = await plannedMilestone(ok, number);
  if ('error' in m) return m;
  try {
    await removePaymentMilestone(ok.code, m.number, ok.viewer);
  } catch (e) {
    return milestoneError(e);
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${m.number} · ${t(RESULT.milestoneRemoved)}` };
}

/** "Mark paid": an invoice awaiting payment is paid on the prototype's date (30 Sep); no toast, as in the prototype. */
export async function markInvoicePaidAction(code: string, milestone: string): Promise<ContractEditResult> {
  const ok = await editable(code, 'billing');
  if ('error' in ok) return ok;
  if (typeof milestone !== 'string' || !ok.contract.milestones.some((m) => m.number === milestone && m.status === 'invoiced'))
    return { error: await tr('This invoice is not awaiting payment') };
  try {
    await markInvoicePaid(ok.code, milestone, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** "Send for signature" (R-079): a draft amendment goes to the client for signature; toast "{label} · Sent for signature". */
export async function sendAmendmentAction(code: string, pos: number): Promise<{ toast: string } | { error: string }> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const p = position(pos);
  const a = p == null ? null : ok.contract.amendments.find((x) => x.position === p);
  if (!a) return { error: await tr('Unknown amendment') };
  if (!a.canSend) return { error: await tr('Only a draft amendment can be sent for signature') };
  let label: string;
  try {
    label = await sendAmendmentForSignature(ok.code, a.position, ok.actor);
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${label} · ${t(RESULT.sent)}` };
}

/**
 * "Mark signed" (R-079): signature date and the signed document's reference; the amendment adds its amount to the contract
 * value and its own milestones become billable (NEW-D3-3). Toast "{label} · Amendment signed".
 */
export async function signAmendmentAction(code: string, pos: number, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const p = position(pos);
  const a = p == null ? null : ok.contract.amendments.find((x) => x.position === p);
  if (!a) return { error: await tr('Unknown amendment') };
  if (!a.canSign) return { error: await tr('Only an amendment sent for signature can be signed') };
  const parsed = parseSignAmendmentForm(strings(values), ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  let label: string;
  try {
    label = await signAmendment(ok.code, a.position, parsed.value, ok.actor);
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${label} · ${t(RESULT.signed)}` };
}

/** "Release" a guarantee in force (R-079): release date; toast "{label} · Guarantee released". */
export async function releaseBondAction(code: string, pos: number, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const p = position(pos);
  const b = p == null ? null : ok.contract.bonds.find((x) => x.position === p);
  if (!b) return { error: await tr('Unknown guarantee') };
  if (!b.inForce) return { error: await tr('This guarantee is already released') };
  const parsed = parseReleaseBondForm(strings(values), ok.year);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await releaseBond(ok.code, b.position, parsed.value.releasedOn, ok.actor);
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${t(bondType.label(b.type))}${b.issuer ? ` · ${b.issuer}` : ''} · ${t(RESULT.released)}` };
}

/**
 * Project currency and budget rate (C-9, R-075): the portfolio director and Finance (R-044 — a delivery-8 default, DELIVERY-7
 * §8 open question). EUR clears the rate; another currency needs a rate in euros per unit. Budget, Cash flow and portfolio
 * finance consolidate the project's amounts at this rate.
 */
export async function setBudgetRateAction(code: string, currency: string, rate: string): Promise<ContractEditResult> {
  if (typeof code !== 'string' || !code || typeof currency !== 'string' || (rate != null && typeof rate !== 'string')) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'contract');
  if (!canSetBudgetRate(ctx.viewer.role)) return { error: await tr('Only the portfolio director and Finance set the budget rate') };
  if (!ctx.canEdit('contract')) return { error: await tr('This contract is read-only for you') };
  try {
    await setProjectBudgetRate(project.code, { currency, rate }, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    return { error: await tr(knownError(e) ?? 'The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/**
 * R-190 (Arche K-05): the project's CAPEX link — the subsidiary CAPEX code and the first machine need at its origin, published at
 * the end of pub_projets for Arche. The director and the project's leads (`canSetCapexLink`), on a project they may edit; Arche's
 * formats (CPX-SAI-2026-01, CPX-SAI-2026-01/B01); empty clears.
 */
export async function setCapexLinkAction(code: string, capexCode: string, needRef: string): Promise<ContractEditResult> {
  if (typeof code !== 'string' || !code || typeof capexCode !== 'string' || typeof needRef !== 'string') return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'contract');
  if (!canSetCapexLink(ctx.viewer.role, ctx.access) || !ctx.canEdit('contract')) return { error: await tr('Only the project’s leads and the director set the CAPEX link') };
  const parsed = parseCapexLink({ capexCode, needRef });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await setCapexLink(project.code, parsed.value, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** Fields of an equipment line as the "Equipment" card sends them (strings; the DAL parses them again). */
export interface EquipmentLineDraft {
  machineTypeCode: string;
  quantity: string;
  label: string;
  capacityValue: string;
  capacityUnit: string;
  /** Comma-separated. */
  options: string;
  besoinRef: string;
}

/** Checks the viewer may edit the project's equipment lines (R-185): the director and the leads, on a project they may edit. */
async function equipmentEditable(code: unknown): Promise<{ code: string; actor: { name: string; role: string } } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'contract');
  if (!canSetProjectEquipment(ctx.viewer.role, ctx.access) || !ctx.canEdit('contract')) return { error: await tr('Only the project’s leads and the director change its equipment') };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } };
}

const EQUIPMENT_ERRORS = [
  'Choose the machine type among the proposed types', 'The equipment label is too long', 'The target capacity is a positive number', 'The capacity unit is too long',
  'Enter the unit of the target capacity', 'Invalid options', 'Too many or too long options', 'The machine need follows the CAPEX application’s format (CPX-SAI-2026-01/B01)',
  'A project keeps at least one equipment line', 'Unknown equipment line', 'This equipment line has inspections in its inspection plan',
];
const equipmentError = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  return EQUIPMENT_ERRORS.includes(m) || /^The quantity is a whole number from 1 to \d+$/.test(m) || /^A project has at most \d+ equipment lines$/.test(m) ? m : 'The change could not be saved';
};

/** Only string fields of the card's draft reach the DAL. */
const lineFields = (v: unknown) => {
  const d = strings(v);
  return {
    machineTypeCode: d.machineTypeCode, quantity: d.quantity, label: d.label ?? '', capacityValue: d.capacityValue ?? '', capacityUnit: d.capacityUnit ?? '',
    options: d.options ?? '', besoinRef: d.besoinRef ?? '',
  };
};

/** R-185: adds an equipment line (type × quantity, optional label, capacity, options, machine need) to the project. */
export async function addEquipmentAction(code: string, line: EquipmentLineDraft): Promise<ContractEditResult> {
  const ok = await equipmentEditable(code);
  if ('error' in ok) return ok;
  try {
    await addProjectEquipment(ok.code, lineFields(line), ok.actor);
  } catch (e) {
    return { error: await tr(equipmentError(e)) };
  }
  refresh();
  return { ok: true };
}

/** R-185: edits an equipment line; the first line's type is the project's main type. */
export async function updateEquipmentAction(code: string, ref: string, line: EquipmentLineDraft): Promise<ContractEditResult> {
  const ok = await equipmentEditable(code);
  if ('error' in ok) return ok;
  if (typeof ref !== 'string' || !/^EQ-\d{2,}$/.test(ref)) return { error: await tr('Invalid request') };
  try {
    await updateProjectEquipment(ok.code, ref, lineFields(line), ok.actor);
  } catch (e) {
    return { error: await tr(equipmentError(e)) };
  }
  refresh();
  return { ok: true };
}

/**
 * R-185: removes an equipment line (never the last one, nor one whose ITP plan has inspections — part 2); its planning lots,
 * punch items, commissioning systems, BOM lines and machines stay, common to the project.
 */
export async function removeEquipmentAction(code: string, ref: string): Promise<ContractEditResult> {
  const ok = await equipmentEditable(code);
  if ('error' in ok) return ok;
  if (typeof ref !== 'string' || !/^EQ-\d{2,}$/.test(ref)) return { error: await tr('Invalid request') };
  try {
    await removeProjectEquipment(ok.code, ref, ok.actor);
  } catch (e) {
    return { error: await tr(equipmentError(e)) };
  }
  refresh();
  return { ok: true };
}
