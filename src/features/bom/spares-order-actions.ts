'use server';
// "Create spares purchase order" Server Functions (chapter 4; Project BOM › PU/PR list, E-3 — rules in
// src/domain/spares-order.ts): load the candidate lines of the list as displayed (system and PU/PR filter) with their
// preferred supplier, stock, quantity still to receive and suggested quantity; then draft one purchase order per supplier
// in Keystone purchasing (origin 'spares'). Same permission as the button: the viewer may edit the project BOM (screen in
// their workspace, project not read-only). Messages come back translated.
import { revalidatePath } from 'next/cache';
import { screenHref } from '@/config/screens';
import { isPreselected, suggestedSpareQty, validateSparesOrder } from '@/domain/spares-order';
import { partStatus, type WearSpare } from '@/server/db/codes';
import { getProject } from '@/server/dal/projects';
import { createSparesPurchaseOrders, getSparesOrderScope } from '@/server/dal/spares-orders';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { ordersHref } from '../orders/links';
import { dataT } from './i18n';
import { logError } from '@/server/log';

export interface SparesOrderLineView {
  ref: string;
  /** Translated texts. */
  name: string;
  kind: WearSpare;
  supplier: string | null;
  recommendedQty: number;
  inStock: number;
  onOrder: number;
  suggestedQty: number;
  unitPriceEur: number;
  preselected: boolean;
  /** Warnings shown on the line (translated): "Not validated", "Under change", "No preferred supplier". */
  warnings: string[];
}

export interface SparesOrderView {
  /** Translated system name ("Gantry crane 250 t — complete"). */
  systemName: string;
  lines: SparesOrderLineView[];
}

export type SparesOrderResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}
const fail = async (english: string): Promise<{ ok: false; error: string }> => ({ ok: false, error: await tr(english) });

const kindOf = (v: unknown): WearSpare | null => (v === 'PU' || v === 'PR' ? v : null);
const systemOf = (v: unknown): string | null => (typeof v === 'string' && /^[A-Z0-9-]{2,40}$/.test(v) ? v : null);

async function access(code: unknown): Promise<{ code: string; actor: string } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: 'Invalid request' };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'bom');
  if (!ctx.canEdit('bom')) return { error: 'This project BOM is read-only for you' };
  return { code: project.code, actor: ctx.viewer.name };
}

/** The dialog's lines: the PU/PR list of `system` (null = complete system) filtered by `kind`, as displayed. */
export async function loadSparesOrderAction(code: string, system: string | null, kind: string | null): Promise<SparesOrderResult<{ view: SparesOrderView }>> {
  const a = await access(code);
  if ('error' in a) return fail(a.error);
  const scope = await getSparesOrderScope(a.code, systemOf(system), kindOf(kind));
  if (!scope) return fail('This project has no PU/PR list');
  const { t, lang } = await getI18n();
  return {
    ok: true,
    view: {
      systemName: dataT(scope.systemName, lang),
      lines: scope.candidates.map((c) => ({
        ref: c.ref, name: dataT(c.name, lang), kind: c.kind, supplier: c.supplier, recommendedQty: c.recommendedQty, inStock: c.inStock, onOrder: c.onOrder,
        suggestedQty: suggestedSpareQty(c), unitPriceEur: c.unitPriceEur, preselected: isPreselected(c),
        warnings: [
          ...(c.status !== 'validated' ? [t(partStatus.label(c.status))] : []),
          ...(c.underChange ? [t('Under change')] : []),
          ...(c.supplier ? [] : [t('No preferred supplier')]),
        ],
      })),
    },
  };
}

/** Drafts the purchase orders (one per preferred supplier) and returns their numbers and the Orders link of the first. */
export async function createSparesOrderAction(
  code: string,
  input: { system: string | null; kind: string | null; lines: { ref: string; qty: number }[] },
): Promise<SparesOrderResult<{ numbers: string[]; href: string; toast: string }>> {
  const a = await access(code);
  if ('error' in a) return fail(a.error);
  const scope = await getSparesOrderScope(a.code, systemOf(input?.system), kindOf(input?.kind));
  if (!scope) return fail('This project has no PU/PR list');
  const v = validateSparesOrder(input?.lines, scope.candidates);
  if (!v.ok) return fail(v.error);
  let numbers: string[];
  try {
    numbers = await createSparesPurchaseOrders(a.code, v.lines, a.actor, scope.systemName);
  } catch (e) {
    logError('createSparesOrderAction', e);
    return fail('The change could not be saved');
  }
  revalidatePath(`/projects/${a.code}`, 'layout');
  revalidatePath(screenHref('procurement'));
  const toast = `${numbers.join(', ')} · ${await tr(numbers.length > 1 ? 'Draft purchase orders created' : 'Draft purchase order created')}`;
  return { ok: true, numbers, href: ordersHref(a.code, { po: numbers[0] }), toast };
}
