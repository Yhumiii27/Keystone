'use server';
// Server Functions of Lessons learned & closure (docs/spec/07 §2.7, AF `rex`) and of the client portal (03 §8, AF
// `client`). Each one validates the raw input, resolves the project and checks the viewer server-side, writes through
// the data-layer writers with the viewer as the actor (never the prototype's fixed "N. Bensaïd" / "25 Sep" stamps),
// then revalidates.
// - Lessons and closure: viewers who may edit the screen on this project (workspace: director, PM, engineering lead,
//   quality; not on a read-only project).
// - Client decisions (change-request client step, deliverable acceptance with PV) and "Acknowledge receipt": the client
//   contact of the project's client organisation only (the director previews the portal but does not decide for the client).
// - "Raise issue": the project's client contact or the portfolio director.
// - "Download status report": every viewer whose workspace has the portal (recorded as a client status report; the
//   file itself is not produced yet, 03 §8.8 / 04 OQ9).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { canDecideStep } from '@/domain/change-control';
import {
  CLIENT_REPORT_FORMATS, LESSON_RESULT, REPORT_RESULT, parseClientReport, parseIssueText, parseNewLesson,
} from '@/domain/rexclient';
import { closureItemStatus, lessonStatus, type ClosureItemStatus, type LessonStatus } from '@/server/db/codes';
import { decideChangeStep, listChangeRequestDetails } from '@/server/dal/changes';
import { raiseClientIssue } from '@/server/dal/client';
import { acknowledgeDocument, listSharedDocuments } from '@/server/dal/documents';
import { getProject } from '@/server/dal/projects';
import { decideDeliverable, getDeliverable } from '@/server/dal/quality';
import { addLesson, advanceLesson, cycleClosureItem, getRex } from '@/server/dal/rex';
import { recordStatusReport } from '@/server/dal/trends';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { toastText } from './i18n';

export type RexClientResult = { ok: true } | { error: string };
export type IssueResult = { ok: true; number: string } | { error: string };

const LL_RE = /^LL-\d{2,}$/;
const CR_RE = /^CR-\d{3,}$/;
const DLV_RE = /^D-\d{3,}$/;

async function tr(english: string) {
  const { t } = await getI18n();
  return toastText(english, t);
}

/** Resolves the project of the request and the viewer's context on `screen`. */
async function access(code: unknown, screen: 'rex' | 'client'): Promise<{ ctx: ProjectContext } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const p = await getProject(code);
  if (!p) return { error: await tr('Unknown project') };
  return { ctx: await getProjectContext(p.code, screen) };
}

const actorOf = (ctx: ProjectContext) => ({ name: ctx.viewer.name, role: ctx.viewer.role });
/** The viewer is the client contact of this project (`isMineP` for the client role: the project's client organisation). */
const isProjectClient = (ctx: ProjectContext) => ctx.viewer.role === 'client' && ctx.isMine;

// ── Lessons learned & closure ──────────────────────────────────────────────────────────────────────────

async function rexEditable(code: unknown): Promise<{ ctx: ProjectContext } | { error: string }> {
  const a = await access(code, 'rex');
  if ('error' in a) return a;
  if (!a.ctx.canEdit('rex')) return { error: await tr('Lessons learned & closure is read-only for you') };
  return a;
}

const refreshRex = (code: string) => revalidatePath(`/projects/${code}/closure`);

/** "Add lesson learned" (AF.rex): a Proposed lesson LL-10, LL-11…; toast "Lesson recorded · to be validated". */
export async function addLessonAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  const parsed = parseNewLesson(values);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const code0 = a.ctx.project.code;
  try {
    await addLesson(code0, parsed.value, actorOf(a.ctx));
  } catch {
    return { error: await tr('The lesson could not be recorded') };
  }
  refreshRex(code0);
  return { toast: await tr(LESSON_RESULT) };
}

/** "Validate" (Proposed → Validated) / "Mark applied" (Validated → Applied); `from` is the status the viewer saw. */
export async function advanceLessonAction(code: string, number: string, from: LessonStatus): Promise<RexClientResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  if (typeof number !== 'string' || !LL_RE.test(number) || !lessonStatus.isCode(from)) return { error: await tr('Invalid request') };
  const code0 = a.ctx.project.code;
  const lesson = (await getRex(code0)).lessons.find((l) => l.number === number);
  if (!lesson) return { error: await tr('Unknown lesson') };
  if (lesson.status !== from || !lesson.next) return { error: await tr('This lesson has already moved on') };
  try {
    await advanceLesson(code0, number, actorOf(a.ctx));
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refreshRex(code0);
  return { ok: true };
}

/** Closure checklist click: Not started → In progress → Done → Not started; `from` is the status the viewer saw. */
export async function cycleClosureAction(code: string, position: number, from: ClosureItemStatus): Promise<RexClientResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  if (!Number.isInteger(position) || position < 0 || !closureItemStatus.isCode(from)) return { error: await tr('Invalid request') };
  const code0 = a.ctx.project.code;
  const item = (await getRex(code0)).closure.find((c) => c.position === position);
  if (!item) return { error: await tr('Unknown checklist item') };
  if (item.status !== from) return { error: await tr('This checklist item has already changed') };
  try {
    await cycleClosureItem(code0, position, actorOf(a.ctx));
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refreshRex(code0);
  return { ok: true };
}

// ── Client portal ──────────────────────────────────────────────────────────────────────────────────────

async function clientPortal(code: unknown): Promise<{ ctx: ProjectContext } | { error: string }> {
  const a = await access(code, 'client');
  if ('error' in a) return a;
  if (a.ctx.outside) return { error: await tr('The client portal is read-only for you') };
  return a;
}

/** Decisions change the change control, quality, Home, My approvals and the badges: refresh the whole app. */
const refreshAll = () => revalidatePath('/', 'layout');

/** "Approve" / "Reject" of a change request's client step (`setCR(id, {chain:{client}})`). */
export async function decideClientChangeAction(code: string, number: string, decision: 'ok' | 'rejected'): Promise<RexClientResult> {
  const a = await clientPortal(code);
  if ('error' in a) return a;
  if (typeof number !== 'string' || !CR_RE.test(number) || (decision !== 'ok' && decision !== 'rejected')) return { error: await tr('Invalid request') };
  if (!isProjectClient(a.ctx)) return { error: await tr('Only the project’s client decides here') };
  const code0 = a.ctx.project.code;
  const cr = (await listChangeRequestDetails(code0)).find((c) => c.id === number);
  if (!cr) return { error: await tr('Unknown change request') };
  if (!canDecideStep('client', cr, 'client')) return { error: await tr('This decision is no longer pending') };
  try {
    await decideChangeStep(code0, cr.id, 'client', decision, a.ctx.viewer.name);
  } catch {
    return { error: await tr('This decision is no longer pending') };
  }
  refreshAll();
  return { ok: true };
}

/** "Accept (PV)" / "Reject" of a submitted deliverable (stamped with the viewer and the status date by the data layer). */
export async function decideClientDeliverableAction(code: string, number: string, decision: 'accepted' | 'rejected'): Promise<RexClientResult> {
  const a = await clientPortal(code);
  if ('error' in a) return a;
  if (typeof number !== 'string' || !DLV_RE.test(number) || (decision !== 'accepted' && decision !== 'rejected')) return { error: await tr('Invalid request') };
  if (!isProjectClient(a.ctx)) return { error: await tr('Only the project’s client decides here') };
  const code0 = a.ctx.project.code;
  const d = await getDeliverable(code0, number);
  if (!d) return { error: await tr('Unknown deliverable') };
  if (d.status !== 'submitted') return { error: await tr('This decision is no longer pending') };
  try {
    await decideDeliverable(code0, d.number, decision, actorOf(a.ctx));
  } catch {
    return { error: await tr('Only the project’s client decides here') };
  }
  refreshAll();
  return { ok: true };
}

/** "Raise issue": a new Open issue CI-08, CI-09, CI-10… with the standard acknowledgement. */
export async function raiseClientIssueAction(code: string, text: string): Promise<IssueResult> {
  const a = await clientPortal(code);
  if ('error' in a) return a;
  if (a.ctx.viewer.role !== 'director' && !isProjectClient(a.ctx)) return { error: await tr('Only the project’s client raises issues here') };
  const parsed = parseIssueText(text);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const code0 = a.ctx.project.code;
  let number: string;
  try {
    number = await raiseClientIssue(code0, parsed.value, actorOf(a.ctx));
  } catch {
    return { error: await tr('The issue could not be recorded') };
  }
  revalidatePath(`/projects/${code0}/client`);
  return { ok: true, number };
}

/** "Acknowledge receipt" of a shared document's current revision (Codex record; a new release asks again). */
export async function acknowledgeSharedDocumentAction(code: string, number: string): Promise<RexClientResult> {
  const a = await clientPortal(code);
  if ('error' in a) return a;
  if (!isProjectClient(a.ctx)) return { error: await tr('Only the client can acknowledge receipt') };
  if (typeof number !== 'string' || !number) return { error: await tr('Invalid request') };
  const code0 = a.ctx.project.code;
  const doc = (await listSharedDocuments(code0)).find((d) => d.number === number);
  if (!doc) return { error: await tr('Unknown document') };
  if (doc.acknowledged) return { ok: true };
  try {
    await acknowledgeDocument(doc.number, a.ctx.viewer.name);
  } catch {
    return { error: await tr('Unknown document') };
  }
  refreshAll();
  return { ok: true };
}

/** "Download status report" (AF.client): records the request as a client status report; toast "Report downloaded". */
export async function downloadStatusReportAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await clientPortal(code);
  if ('error' in a) return a;
  const parsed = parseClientReport(values);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const format = CLIENT_REPORT_FORMATS.find((f) => f.value === parsed.value.format)!.label;
  await recordStatusReport(a.ctx.project.code, { period: parsed.value.period, audience: 'client', sections: 'full', note: `Format: ${format}` }, a.ctx.viewer.name);
  return { toast: await tr(REPORT_RESULT) };
}
