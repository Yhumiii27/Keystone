'use server';
// Stock & storages Server Functions (docs/spec/08 §4.4–4.5): "Apply movement" of the stock-line drawer, the header's
// "Import from X3" and the drawer's "Push to X3" (mock Sage X3 connector). Each one checks the viewer may edit the
// screen (roles with Stock & storages in their workspace; outside the workspace it is read-only), validates the raw
// input with the domain parsers, writes through the stock DAL with the viewer as the actor, then revalidates the app
// (stock lines, KPIs, the sidebar badge and the stock figures other screens show).
import { revalidatePath } from 'next/cache';
import { parseMovementInput } from '@/domain/stock';
import { getProject } from '@/server/dal/projects';
import { applyStockMovement, getStockPosition, importStockFromX3, pushStockToX3 } from '@/server/dal/stock';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { importToastText, pushToastText, stockErrorT } from './i18n';

export type StockActionResult = { ok: true; toast?: string } | { error: string };

const refresh = () => revalidatePath('/', 'layout');
/** Stock position ids are UUIDs (anything else is an unknown line, never sent to the database). */
const isPositionId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

/** The viewer may change stock (not outside the workspace); returns the actor's name or an error. */
async function editor(): Promise<{ actor: string } | { error: string }> {
  const access = await getScreenAccess('stock');
  if (!access.canEdit) return { error: await tr('Stock is read-only for you') };
  return { actor: access.viewer.name };
}

/** Rule refusals keep their (translated) message; anything else is a generic failure. */
async function failure(e: unknown): Promise<{ error: string }> {
  const { t, lang } = await getI18n();
  const msg = e instanceof Error ? e.message : '';
  return { error: stockErrorT(msg, t, lang) ?? t('The change could not be saved') };
}

/**
 * "Apply movement": `values` = the drawer's operation, quantity (text) and transfer destination; `projectCode` = the
 * current project (reserve, issue, return).
 */
export async function applyStockMovementAction(positionId: string, values: { op?: unknown; qty?: unknown; target?: unknown }, projectCode: string | null): Promise<StockActionResult> {
  const ok = await editor();
  if ('error' in ok) return ok;
  if (typeof positionId !== 'string' || !positionId || !values || typeof values !== 'object') return { error: await tr('Invalid request') };
  if (!isPositionId(positionId)) return { error: await tr('Unknown stock line') };
  const parsed = parseMovementInput(values);
  if (!parsed.ok) return failure(new Error(parsed.error));
  const { op, qty, target } = parsed.value;
  let project: string | null = null;
  if (op === 'reserve' || op === 'issue' || op === 'return') {
    const p = typeof projectCode === 'string' && projectCode ? await getProject(projectCode) : null;
    if (!p) return { error: await tr('A project is required') };
    project = p.code;
  }
  try {
    await applyStockMovement(positionId, { op, qty, targetLocation: target, projectCode: project }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

/** "Import from X3" (header primary): merges the X3 snapshot, local changes kept. */
export async function importFromX3Action(): Promise<StockActionResult> {
  const ok = await editor();
  if ('error' in ok) return ok;
  try {
    const r = await importStockFromX3(ok.actor);
    refresh();
    const { lang } = await getI18n();
    return { ok: true, toast: importToastText(r.lines, r.keptLocal, lang) };
  } catch (e) {
    return failure(e);
  }
}

/** "Push to X3" of the stock-line drawer: this line and the pending movements that touched it. */
export async function pushStockLineAction(positionId: string): Promise<StockActionResult> {
  const ok = await editor();
  if ('error' in ok) return ok;
  if (typeof positionId !== 'string' || !positionId) return { error: await tr('Invalid request') };
  const line = isPositionId(positionId) ? await getStockPosition(positionId) : null;
  if (!line) return { error: await tr('Unknown stock line') };
  try {
    const r = await pushStockToX3(ok.actor, new Date(), { positionId });
    refresh();
    const { lang } = await getI18n();
    if (!r.lines && !r.movements) return { ok: true, toast: await tr('Nothing to push · this line matches Sage X3') };
    return { ok: true, toast: pushToastText(line.ref, line.location, r.movements, lang) };
  } catch (e) {
    return failure(e);
  }
}
