'use server';
// Plan — WBS & activities Server Functions (docs/spec/05 §2.5): inline edits, re-order, removal and the three
// add-forms (AF plan / wp / progress). Each one checks the viewer may edit the project's plan, validates the raw
// input exactly as the prototype parses it, writes through the DAL and revalidates the project's pages.
// P-9a (R-061): the structure — WBS, names, owners, durations, budgets, predecessors, order, additions — is the project's PM
// team's (PM of record, co-PMs, deputies) and the director's; an activity's owner enters only its % complete.
import { revalidatePath } from 'next/cache';
import {
  applyBudget, clampPct, createsCycle, moveWithin, nextActivityCode, nextWorkPackageCode, parseDuration, parsePredecessors,
  predsInput, workingDaysBetween, type PredError,
} from '@/domain/schedule';
import { wbsFmtDate, wbsParseDate } from '@/lib/format';
import {
  getPackageOrder, getPlanData, insertActivity, insertWorkPackage, ownerCodeOfName, ownerCodeOfViewer, renameWorkPackage, reorderActivities, updateActivity,
  type ActivityPatch, type PlanData,
} from '@/server/dal/plan';
import { restorePlanTrash, trashPlanRow } from '@/server/dal/plan-trash';
import { getProject } from '@/server/dal/projects';
import { rescheduleIfAutomatic } from '@/server/dal/schedule';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { removedText, restoreConflictText, restoredText } from './i18n';
import { canEditPlan, canEditProgress, canEditStructure, canSchedulePlan } from './rights';

/** `value`: the normalised value of an edited cell. */
export type PlanActionResult = { ok: true; value?: string } | { error: string };
export type PlanFormResult = { toast?: string; error?: string };
export type ActivityField = 'name' | 'owner' | 'dur' | 'budget' | 'preds' | 'pct';

const FIELDS: readonly ActivityField[] = ['name', 'owner', 'dur', 'budget', 'preds', 'pct'];
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A typed form date ("5 Oct 2026") → Date, or null when it does not parse to a plausible calendar date. */
function formDate(text: string): Date | null {
  const d = wbsParseDate(text);
  return d && d.getFullYear() >= 2000 && d.getFullYear() <= 2100 ? d : null;
}
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type EditablePlan = { data: PlanData; actor: string; ctx: ProjectContext; ownerCode: string | null };

/**
 * Loads the plan after checking the viewer may edit it (not outside, on the project's team, not the client) and, for
 * `structure`, that they are one of its PMs or the director (P-9a). `progress` callers check the activity's owner themselves.
 */
async function editablePlan(code: unknown, need: 'structure' | 'progress' = 'structure'): Promise<EditablePlan | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  if (!(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'plan');
  if (!canEditPlan(ctx)) return { error: t('This plan is read-only for you') };
  if (need === 'structure' && !canEditStructure(ctx)) return { error: t(STRUCTURE_ONLY) };
  const data = await getPlanData(code);
  if (!data) return { error: t('This project has no plan yet') };
  return { data, actor: ctx.viewer.name, ctx, ownerCode: ctx.isLead ? null : await ownerCodeOfViewer(ctx.viewer) };
}

/** P-9a refusal: the structure belongs to the project's PMs and the director. */
const STRUCTURE_ONLY = 'Only the project manager or the director can change the plan structure — you can update the progress of your own activities';
/** P-9a refusal of a progress entry on someone else's activity. */
const OWN_PROGRESS_ONLY = 'You can update the progress of your own activities only';

/** The viewer may enter the % complete of this activity (PM team, director, or its owner). */
const mayEnterProgress = (r: EditablePlan, a: { owner: string | null }) => canEditProgress(r.ctx, !!r.ownerCode && a.owner === r.ownerCode);

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

/** S-1: dates move only at "Reschedule" (manual, the default); in 'automatic' mode a schedule edit reschedules at once. */
async function afterScheduleEdit(code: string, actor: string) {
  await rescheduleIfAutomatic(code, actor);
}

/** Toast text translated per " · " segment, like the prototype's showToast. */
async function toastOf(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

async function predError(e: PredError): Promise<string> {
  const { t } = await getI18n();
  const why = {
    syntax: 'invalid syntax — use “A1010 FS+5”',
    unknown: 'unknown activity',
    self: 'an activity cannot precede itself',
    duplicate: 'listed twice',
    cycle: 'would create a logic loop',
  }[e.reason];
  return `${e.token} — ${t(why)}`;
}

/**
 * Inline edit of one activity field (`setWbs`, logic 3975), with the raw text typed in the cell. Returns the
 * normalised cell value (e.g. "150" % → "100", "" duration → the current duration). Unchanged values are not
 * written, so they do not set the "edited" mark.
 */
export async function editActivity(code: string, actId: string, field: ActivityField, value: string): Promise<PlanActionResult> {
  const r = await editablePlan(code, field === 'pct' ? 'progress' : 'structure');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const a = r.data.activities.find((x) => x.id === actId);
  if (!a || !FIELDS.includes(field)) return { error: t('Invalid request') };
  if (field === 'pct' && !mayEnterProgress(r, a)) return { error: t(OWN_PROGRESS_ONLY) };
  const v = str(value);
  let patch: ActivityPatch | null = null;
  let normalized: string;
  switch (field) {
    case 'name': {
      const name = v.trim();
      if (!name) return { error: t('Enter a name') };
      if (name.length > MAX_NAME) return { error: t('Name is too long') };
      normalized = name;
      if (name !== a.name) patch = { name };
      break;
    }
    case 'owner':
      if (!r.data.owners.some((o) => o.code === v)) return { error: t('Invalid request') };
      normalized = v;
      if (v !== a.owner) patch = { ownerCode: v };
      break;
    case 'dur': {
      const d = parseDuration(v, a.durationDays);
      normalized = String(d);
      if (d !== a.durationDays) patch = { durationDays: d };
      break;
    }
    case 'budget': {
      const b = applyBudget(v, a);
      normalized = String(b.budget);
      if (b.budget !== a.budget || b.eac !== a.eac) patch = { budget: b.budget, eac: b.eac };
      break;
    }
    case 'preds': {
      const ids = new Set(r.data.activities.map((x) => x.id));
      const { links, errors } = parsePredecessors(v, ids, actId);
      if (errors.length) return { error: await predError(errors[0]) };
      const predsOf = (id: string) => r.data.activities.find((x) => x.id === id)?.preds.map((p) => p[0]) ?? [];
      const loop = createsCycle(actId, links.map((l) => l[0]), predsOf);
      if (loop) return { error: await predError({ token: loop, reason: 'cycle' }) };
      normalized = predsInput(links);
      if (normalized !== predsInput(a.preds)) patch = { preds: links };
      break;
    }
    case 'pct': {
      const pc = clampPct(v);
      normalized = String(pc);
      if (pc !== a.pct) patch = { pct: pc };
      break;
    }
  }
  if (patch) {
    if (!(await updateActivity(code, actId, patch))) return { error: t('Invalid request') };
    if (field === 'dur' || field === 'preds' || field === 'pct') await afterScheduleEdit(code, r.actor);
    refresh(code);
  }
  return { ok: true, value: normalized };
}

/** Inline rename of a work package. */
export async function renamePackage(code: string, w: string, name: string): Promise<PlanActionResult> {
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const n = str(name).trim();
  if (!n) return { error: t('Enter a name') };
  if (n.length > MAX_NAME) return { error: t('Name is too long') };
  const wp = r.data.packages.find((p) => p.code === str(w));
  if (!wp) return { error: t('Invalid request') };
  if (n !== wp.name) {
    if (!(await renameWorkPackage(code, wp.code, n))) return { error: t('Invalid request') };
    refresh(code);
  }
  return { ok: true, value: n };
}

/** Move up / down within the work package (`moveAct`). No-op at the ends. */
export async function moveActivity(code: string, actId: string, dir: -1 | 1): Promise<PlanActionResult> {
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const order = await getPackageOrder(code, str(actId));
  const next = order && moveWithin(order.ids, actId, dir === -1 ? -1 : 1);
  if (order && next) {
    await reorderActivities(code, order.wbs, next);
    refresh(code);
  }
  return { ok: true };
}

/** Removal result: the trash entry ("Undo" in the toast) and the translated toast. */
export type RemoveRowResult = { ok: true; trashId: string; toast: string } | { error: string };

/** Removal and restore (S-5): the director or the project's manager, on a plan they may edit (not read-only / outside / client). */
async function trashRights(code: unknown): Promise<{ code: string; actor: string } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || !(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'plan');
  if (!canEditPlan(ctx)) return { error: t('This plan is read-only for you') };
  if (!canSchedulePlan(ctx)) return { error: t('Only the project manager or the director can do this') };
  return { code: ctx.project.code, actor: ctx.viewer.name };
}

/**
 * Remove an activity, or a work package with all its activities (`rmKey`), after the confirmation dialog. The root cannot be
 * removed. S-5: the rows go to the Plan trash in one transaction (links, assignments, to-dos included) — the toast offers
 * "Undo" and the Plan lists them under "Recently deleted" (src/server/dal/plan-trash.ts).
 */
export async function removeRow(code: string, kind: 'wp' | 'act', key: string): Promise<RemoveRowResult> {
  const r = await trashRights(code);
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const k = str(key);
  const trashId = kind === 'wp' || kind === 'act' ? await trashPlanRow(r.code, kind, k, r.actor) : null;
  if (!trashId) return { error: t('Invalid request') };
  await afterScheduleEdit(r.code, r.actor);
  refresh(r.code);
  return { ok: true, trashId, toast: removedText(kind, k, lang) };
}

/** "Undo" (toast) or "Restore" (Recently deleted): puts the removed rows back exactly as they were. */
export async function restoreRow(code: string, trashId: string): Promise<{ ok: true; toast: string } | { error: string }> {
  const r = await trashRights(code);
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const id = str(trashId);
  if (!UUID_RE.test(id)) return { error: t('Invalid request') };
  const res = await restorePlanTrash(r.code, id, r.actor);
  if ('error' in res) {
    if (res.error === 'conflict') return { error: restoreConflictText(res.code ?? '', lang) };
    if (res.error === 'parent') return { error: t('Restore its work package first') };
    return { error: t('This removal can no longer be undone') };
  }
  await afterScheduleEdit(r.code, r.actor);
  refresh(r.code);
  return { ok: true, toast: restoredText(res.kind, res.code, res.activityCount, lang) };
}

/** AF `plan` — "Add activity" (afSubmit, logic 5129). Toast "A1901 · Activity created · 1.1". */
export async function addActivity(code: string, values: Record<string, string>): Promise<PlanFormResult> {
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const { data } = r;
  const name = str(values?.name).trim();
  if (!name) return { error: t('Enter a name') };
  if (name.length > MAX_NAME) return { error: t('Name is too long') };
  const w = str(values?.wp).split(' · ')[0] || '1.1';
  if (!data.packages.some((p) => p.code === w)) return { error: t('Invalid request') };
  const id = nextActivityCode(data.projectIdx, data.activities.filter((a) => a.isAdded).length, new Set(data.activities.map((a) => a.id)));
  const start = str(values?.start).trim().slice(0, 40);
  const finish = str(values?.finish).trim().slice(0, 40);
  const ds = formDate(start);
  const df = formDate(finish);
  const critical = str(values?.critical) === 'Yes';
  const ok = await insertActivity(code, {
    id, wbs: w, name, durationDays: workingDaysBetween(start, finish),
    ownerCode: (await ownerCodeOfName(str(values?.owner))) ?? 'RA',
    start: ds ? wbsFmtDate(ds) : start, startDate: ds ? isoOf(ds) : null,
    finish: df ? wbsFmtDate(df) : finish, finishDate: df ? isoOf(df) : null,
    budget: Math.max(0, parseFloat(str(values?.budget)) || 0), totalFloat: critical ? data.control.floatDays : 10, critical,
    description: str(values?.desc).trim().slice(0, MAX_TEXT),
  });
  if (!ok) return { error: t('Invalid request') };
  refresh(code);
  return { toast: await toastOf(`${id} · Activity created · ${w}`) };
}

/** AF `wp` — "Add work package" (logic 5131). Toast "1.9 · {name} · Work package created". */
export async function addWorkPackage(code: string, values: Record<string, string>): Promise<PlanFormResult> {
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const name = str(values?.name).trim();
  if (!name) return { error: t('Enter a name') };
  if (name.length > MAX_NAME) return { error: t('Name is too long') };
  const w = nextWorkPackageCode(r.data.packages.map((p) => p.code));
  // The budget field has no column on WBS nodes (docs/spec/05 OQ 9): owner and scope are kept, the budget is not.
  const ok = await insertWorkPackage(code, { code: w, name, ownerName: str(values?.owner), scope: str(values?.desc).trim().slice(0, MAX_TEXT) });
  if (!ok) return { error: t('Invalid request') };
  refresh(code);
  return { toast: await toastOf(`${w} · ${name} · Work package created`) };
}

/** AF `progress` — "Update progress" (logic 5132). The note is not kept (as in the prototype). */
export async function saveProgress(code: string, values: Record<string, string>): Promise<PlanFormResult> {
  const r = await editablePlan(code, 'progress');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const id = str(values?.act).split(' · ')[0];
  if (!id) return { toast: await toastOf('Progress saved') };
  const act = r.data.activities.find((a) => a.id === id);
  if (!act) return { error: t('Invalid request') };
  if (!mayEnterProgress(r, act)) return { error: t(OWN_PROGRESS_ONLY) };
  const pc = clampPct(str(values?.pc));
  await updateActivity(code, id, { pct: pc });
  await afterScheduleEdit(code, r.actor);
  refresh(code);
  return { toast: await toastOf(`${id} · ${pc} % · Progress saved`) };
}
