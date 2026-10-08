'use server';
// Contract & Billing Server Functions (docs/spec/04 §3.5–3.6 contract sheet, AF `amendment`, `bond`, `milestone`;
// §4.5–4.6 AF `billing`, "Mark paid"). Each one checks that the viewer may edit the screen on this project (not
// outside the workspace, not a read-only project — also for the contract sheet, which the prototype left editable
// outside, 04 Q7), that the project has a contract, validates the untrusted input with the domain parsers, writes
// through the Contract DAL with the viewer as the actor, then revalidates the app (Contract, Billing, Budget › Cash
// & recovery, Cash flow, the Billing badge all read the same rows).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseAmendmentForm, parseBondForm, parseInvoiceForm, parseMilestoneForm, parseSheetField } from '@/domain/contract';
import { bondType } from '@/server/db/codes';
import {
  addAmendment, addBond, addPaymentMilestone, getContract, issueInvoice, markInvoicePaid, updateContractSheet, type ProjectContract,
} from '@/server/dal/contract';
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
async function editable(code: unknown, screen: 'contract' | 'billing'): Promise<{ code: string; actor: string; contract: ProjectContract } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, screen);
  if (!ctx.canEdit(screen)) return { error: await tr(screen === 'contract' ? 'This contract is read-only for you' : 'Billing is read-only for you') };
  const contract = await getContract(project.code);
  if (!contract) return { error: await tr('No contract registered for this project') };
  return { code: project.code, actor: ctx.viewer.name, contract };
}

/** Contract sheet: one field saved on blur / Enter / select change (`setCtr`). */
export async function updateContractFieldAction(code: string, key: string, value: string): Promise<ContractEditResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseSheetField(key, value);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await updateContractSheet(ok.code, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** "Add amendment" → "Register amendment" (AF.amendment): toast "{subject} · Amendment registered". */
export async function addAmendmentAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editable(code, 'contract');
  if ('error' in ok) return ok;
  const parsed = parseAmendmentForm(strings(values));
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
  const parsed = parseBondForm(strings(values));
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
  const parsed = parseMilestoneForm(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await addPaymentMilestone(ok.code, parsed.value, ok.actor);
  } catch {
    return { error: await tr('The change could not be saved') };
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
  const planned = ok.contract.milestones.filter((m) => m.status === 'planned').map((m) => m.number);
  const parsed = parseInvoiceForm(strings(values), planned);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  if (ok.contract.invoices.some((i) => i.number === v.invoiceNumber)) return { error: `${v.invoiceNumber} · ${await tr('This invoice number is already used')}` };
  let number: string;
  try {
    number = await issueInvoice(ok.code, { milestone: v.milestone, invoiceNumber: v.invoiceNumber, issuedOn: v.issuedOn, note: v.note }, ok.actor);
  } catch (e) {
    const used = e instanceof Error && /already exists/.test(e.message);
    return { error: used ? `${v.invoiceNumber} · ${await tr('This invoice number is already used')}` : await tr('The change could not be saved') };
  }
  refresh();
  const { t } = await getI18n();
  return { toast: `${number} · ${v.milestone} · ${t(RESULT.billing[0])} · ${t(RESULT.billing[1])}` };
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
