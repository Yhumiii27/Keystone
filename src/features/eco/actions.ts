'use server';
// Server Functions of the Change orders and Drawings screens (docs/spec/09 §4.7–4.8, §5.8). Vigie owns the ECOs: the
// only ECO writes Keystone makes are the viewer's progress — the decision on their own approval key (englead, quality,
// pm) and the step advancements the prototype offered ("Start impact analysis", "Submit for approval") — recorded
// through the Vigie connector (src/server/dal/eco.ts → integrations/vigie), "pending sync with Vigie" until Vigie
// takes them. Each function validates the raw input, checks the viewer server-side with the same rules as the screen
// (src/domain/eco.ts), writes with the viewer as the actor, then revalidates (screen, sidebar badge, My approvals).
// ECO messages are English source strings: the client shows them with toast `showEn` (as My approvals does).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { canActOnKey, nextStepOf, requestedStepText } from '@/domain/eco';
import { ECO_APPROVER_KEYS, vaultSyncScope, vaultSyncSource, vigieSyncStatus, type EcoApproverKey, type EcoStatus } from '@/server/db/codes';
import { syncPdmVault } from '@/server/dal/drawings';
import { getEco, recordEcoProgress } from '@/server/dal/eco';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { vaultSyncedText } from './i18n';
import { logError } from '@/server/log';

export type EcoProgressResult = { ok: true; toast: string } | { ok: false; error: string };

const NOT_ALLOWED = 'Change orders are outside your workspace';
const INVALID = 'Invalid request';
const UNKNOWN = 'Unknown ECO';
const NOT_YOURS = 'This decision is not waiting for you any more';
const STEP_GONE = 'This step is not available any more';
const FAILED = 'The progress could not be recorded';

const ECO_NUMBER = /^ECO-\d{4}-\d{3,}$/;
const STEPS: readonly EcoStatus[] = ['impact_analysis', 'in_approval'];

/** Sidebar badge, My approvals, Home and the screen change together. */
const refreshAll = () => revalidatePath('/', 'layout');

const syncText = (status: 'pending' | 'sent' | 'failed') => vigieSyncStatus.label(status);

/**
 * Approve (ok) or reject on the viewer's approval key — from the ECO drawer or the My approvals inbox. Allowed when
 * the ECO is in approval in Vigie, the key is the viewer's and still pending (for the PM key: a PM of an impacted
 * project), and no decision already waits for Vigie.
 */
export async function decideEcoApprovalAction(input: { number: string; key: string; decision: string }): Promise<EcoProgressResult> {
  const { canEdit, viewer } = await getScreenAccess('eco');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const key = input?.key as EcoApproverKey;
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!ECO_NUMBER.test(number) || !ECO_APPROVER_KEYS.includes(key) || !decision) return { ok: false, error: INVALID };
  try {
    const [eco, identity] = await Promise.all([getEco(number), getApproverIdentity(viewer)]);
    if (!eco) return { ok: false, error: UNKNOWN };
    if (!canActOnKey(eco, key, { role: viewer.role, managedProjects: identity.managedProjects })) {
      refreshAll(); // the row or the drawer is stale
      return { ok: false, error: NOT_YOURS };
    }
    const receipt = await recordEcoProgress(number, { key, decision }, { name: viewer.name, role: viewer.role });
    refreshAll();
    return { ok: true, toast: `${number} · ${decision === 'ok' ? 'Approved' : 'Rejected'} · ${syncText(receipt.syncStatus)}` };
  } catch (e) {
    logError('decideEcoApprovalAction', e);
    return { ok: false, error: FAILED };
  }
}

/**
 * "Start impact analysis" (Draft) or "Submit for approval" (Impact analysis, interchangeability decided in Vigie):
 * a step request sent to Vigie, one at a time, by a viewer whose workspace includes Change orders.
 */
export async function requestEcoStepAction(input: { number: string; step: string }): Promise<EcoProgressResult> {
  const { canEdit, viewer } = await getScreenAccess('eco');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const step = input?.step as EcoStatus;
  if (!ECO_NUMBER.test(number) || !STEPS.includes(step)) return { ok: false, error: INVALID };
  try {
    const eco = await getEco(number);
    if (!eco) return { ok: false, error: UNKNOWN };
    if (nextStepOf(eco) !== step) {
      refreshAll();
      return { ok: false, error: STEP_GONE };
    }
    const receipt = await recordEcoProgress(number, { step }, { name: viewer.name, role: viewer.role });
    refreshAll();
    return { ok: true, toast: `${number} · ${requestedStepText(step)} · ${syncText(receipt.syncStatus)}` };
  } catch (e) {
    logError('requestEcoStepAction', e);
    return { ok: false, error: FAILED };
  }
}

/**
 * "Synchronise" (Sync vault, AF `drawings`): records a PDM vault sync (simulated connector: no drawing changes,
 * OPEN QUESTION E-7); "Current project" is the viewer's last project. Toast "Vault synchronised · 0 drawings updated".
 */
export async function syncVaultAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t, lang }, access] = await Promise.all([getI18n(), getScreenAccess('drawings')]);
  if (!access.canEdit) return { error: t('The PDM vault is read-only for you') };
  const source = values?.source;
  const scope = values?.scope;
  if (!vaultSyncSource.isCode(source) || !vaultSyncScope.isCode(scope)) return { error: t(INVALID) };
  try {
    const projectCode = scope === 'current_project' ? await getLastProject() : null;
    const state = await syncPdmVault({ source, scope, projectCode }, access.viewer.name);
    revalidatePath('/reference/drawings');
    return { toast: vaultSyncedText(state.drawingsUpdated, lang) };
  } catch (e) {
    logError('syncVaultAction', e);
    return { error: t('The change could not be saved') };
  }
}
