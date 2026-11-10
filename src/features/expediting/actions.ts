'use server';
// R-159 (P1, D9-31) — Server Functions of the expediting section (Purchase orders screen, order drawer). Rights (src/domain/rights.ts):
// - fabrication progress and inspections (plan, edit, remove a planned one, record the result and the NCR number): the portfolio
//   director, procurement and quality, on every project (`canEditExpediting`), the Purchase orders screen in their workspace;
// - the release note (issue, withdraw with a reason): quality and the director (`canIssueRelease`).
// The project's PMs and the other roles read; the client is refused (getProjectContext). The writers (src/server/dal/expediting.ts)
// validate with the pure rules and re-check the rights inside their transaction.
import { revalidatePath } from 'next/cache';
import { EXPEDITING_ERRORS } from '@/domain/expediting';
import { canEditExpediting, canIssueRelease } from '@/domain/rights';
import { businessToday } from '@/server/clock';
import {
  ExpeditingWriteError, issueReleaseNote, recordInspectionResult, removeInspection, saveInspection, setFabricationProgress, withdrawReleaseNote,
} from '@/server/dal/expediting';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type ExpeditingActionResult = { ok: true } | { error: string };

const PO_RE = /^[A-Z0-9][A-Z0-9-]{0,30}$/;
const NUM_RE = /^I-\d{1,4}$/;
const RN_RE = /^[A-Z0-9][A-Z0-9-]{0,40}$/;
const EDIT_ONLY = 'Only procurement, quality or the director can follow the order’s fabrication and inspections';
const RELEASE_ONLY = 'Only quality or the director can issue or withdraw a release note';
const OTHER_ERRORS = {
  unknownOrder: 'Unknown purchase order',
  unknownInspection: 'Unknown inspection',
  unknownRelease: 'Unknown release note',
  closedOrder: 'A draft or cancelled order has no inspection follow-up',
  rights: EDIT_ONLY,
  releaseRights: RELEASE_ONLY,
  itp: 'Choose an FAT point of the project’s inspection & test plan',
  recorded: 'A recorded inspection is kept: record a re-inspection instead',
  withdrawn: 'This release note is already withdrawn',
} as const;

type Right = 'edit' | 'release';

async function run(code: unknown, po: unknown, right: Right, write: (project: string, po: string, actor: { name: string; role: string }) => Promise<unknown>): Promise<ExpeditingActionResult> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || typeof po !== 'string' || !PO_RE.test(po)) return { error: t('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: t('Unknown project') };
  const ctx = await getProjectContext(project.code, 'orders');
  const role = ctx.viewer.role;
  const ok = !ctx.isOutside('orders') && (right === 'release' ? canIssueRelease(role) : canEditExpediting(role));
  if (!ok) return { error: t(right === 'release' ? RELEASE_ONLY : EDIT_ONLY) };
  try {
    await write(project.code, po, { name: ctx.viewer.name, role });
  } catch (e) {
    if (!(e instanceof ExpeditingWriteError)) throw e;
    if (e.code === 'blocked' && e.detail?.length) return { error: `${t(EXPEDITING_ERRORS.blocked)} · ${e.detail.map((b) => (b.kind === 'fat' ? t('The FAT has not passed yet') : `${t('Failed inspection without a passing re-inspection')}: ${b.numbers.join(', ')}`)).join(' · ')}` };
    return { error: t(e.code in OTHER_ERRORS ? OTHER_ERRORS[e.code as keyof typeof OTHER_ERRORS] : EXPEDITING_ERRORS[e.code as keyof typeof EXPEDITING_ERRORS]) };
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { ok: true };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** The supplier's fabrication progress (% complete, reported date, note). */
export async function setFabricationProgressAction(code: string, po: string, values: Record<string, string>): Promise<ExpeditingActionResult> {
  const today = await businessToday();
  return run(code, po, 'edit', (p, n, actor) => setFabricationProgress(p, n, rec(values), today, actor));
}

/** Plans an inspection (`existing` '') or edits a planned one. */
export async function saveInspectionAction(code: string, po: string, existing: string, values: Record<string, string>): Promise<ExpeditingActionResult> {
  if (typeof existing !== 'string' || (existing !== '' && !NUM_RE.test(existing))) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'edit', (p, n, actor) => saveInspection(p, n, existing || null, rec(values), actor));
}

export async function removeInspectionAction(code: string, po: string, number: string): Promise<ExpeditingActionResult> {
  if (typeof number !== 'string' || !NUM_RE.test(number)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'edit', (p, n, actor) => removeInspection(p, n, number, actor));
}

/** Records the result of an inspection (and the NCR number Vigie gave when it failed). */
export async function recordInspectionResultAction(code: string, po: string, number: string, values: Record<string, string>): Promise<ExpeditingActionResult> {
  if (typeof number !== 'string' || !NUM_RE.test(number)) return { error: (await getI18n()).t('Invalid request') };
  const today = await businessToday();
  return run(code, po, 'edit', (p, n, actor) => recordInspectionResult(p, n, number, rec(values), today, actor));
}

/** Issues the order's release note (quality). */
export async function issueReleaseNoteAction(code: string, po: string, values: Record<string, string>): Promise<ExpeditingActionResult> {
  const today = await businessToday();
  return run(code, po, 'release', (p, n, actor) => issueReleaseNote(p, n, rec(values), today, actor));
}

/** Withdraws the release note in force, with a reason. */
export async function withdrawReleaseNoteAction(code: string, po: string, number: string, values: Record<string, string>): Promise<ExpeditingActionResult> {
  if (typeof number !== 'string' || !RN_RE.test(number)) return { error: (await getI18n()).t('Invalid request') };
  return run(code, po, 'release', (p, n, actor) => withdrawReleaseNote(p, n, number, rec(values).reason, actor));
}
