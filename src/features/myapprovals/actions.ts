'use server';
// Server Functions of My approvals (docs/spec/08 §7.5, 00 §7.8 "apply the same server actions as the module
// screens"). The only inline decision persisted today is the change-request step: it goes through the Change
// control writer `decideChangeStep` (status re-derived from the chain, BL2 switch, audit row), after checking that
// the viewer holds that pending step (named approver, or the CCB recorder of Change control). Kinds not modelled yet decide nothing server-side (previews).
// Messages are English source strings (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import { canDecideStep } from '@/domain/approvals';
import { changeStatus, type ChangeStep } from '@/server/db/codes';
import { decideChangeStep, listChangeRequestDetails } from '@/server/dal/changes';
import { getScreenAccess } from '@/server/project-context';

export type DecisionResult = { ok: true; status: string } | { ok: false; error: string };

const STEPS: readonly ChangeStep[] = ['pm', 'director', 'client', 'ccb'];
const NOT_ALLOWED = 'Read-only — you cannot decide from this inbox';
const NOT_YOURS = 'This decision is not waiting for you any more';
const INVALID = 'Invalid request';
const FAILED = 'The decision could not be saved';

/** Approve (ok) or reject a change-request step waiting for the viewer (inline buttons of a "Change request" row). */
export async function decideChangeRequestAction(input: { projectCode: string; number: string; step: string; decision: string }): Promise<DecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const step = input?.step as ChangeStep;
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!/^[A-Z]{3}-\d{3}$/.test(code) || !/^CR-\d{3,}$/.test(number) || !STEPS.includes(step) || !decision) return { ok: false, error: INVALID };
  try {
    const cr = (await listChangeRequestDetails(code)).find((c) => c.id === number);
    // Same routing rule as the inbox: in review, this step pending, and the viewer holds it.
    if (!cr || !canDecideStep(cr, step, viewer)) {
      revalidatePath('/', 'layout'); // the row is stale
      return { ok: false, error: NOT_YOURS };
    }
    const status = await decideChangeStep(code, number, step, decision, viewer.name);
    revalidatePath('/', 'layout');
    return { ok: true, status: changeStatus.label(status) };
  } catch (e) {
    console.error('decideChangeRequestAction', e);
    return { ok: false, error: FAILED };
  }
}
