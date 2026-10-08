'use server';
// Plan — WBS & activities Server Functions (docs/spec/05 §2.5): inline edits, re-order, removal and the three
// add-forms (AF plan / wp / progress). Each one checks the viewer may edit the project's plan, validates the raw
// input exactly as the prototype parses it, writes through the DAL and revalidates the project's pages.
import { revalidatePath } from 'next/cache';
import {
  applyBudget, clampPct, createsCycle, moveWithin, nextActivityCode, nextWorkPackageCode, parseDuration, parsePredecessors,
  predsInput, workingDaysBetween, type PredError,
} from '@/domain/schedule';
import { wbsFmtDate, wbsParseDate } from '@/lib/format';
import {
  deleteActivity, deleteWorkPackage, getPackageOrder, getPlanData, insertActivity, insertWorkPackage, ownerCodeOfName,
  renameWorkPackage, reorderActivities, updateActivity, type ActivityPatch, type PlanData,
} from '@/server/dal/plan';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

/** `value`: the normalised value of an edited cell. */
export type PlanActionResult = { ok: true; value?: string } | { error: string };
export type PlanFormResult = { toast?: string; error?: string };
export type ActivityField = 'name' | 'owner' | 'dur' | 'budget' | 'preds' | 'pct';

const FIELDS: readonly ActivityField[] = ['name', 'owner', 'dur', 'budget', 'preds', 'pct'];
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const MAX_NAME = 200;
const MAX_TEXT = 2000;

/** A typed form date ("5 Oct 2026") → Date, or null when it does not parse to a plausible calendar date. */
function formDate(text: string): Date | null {
  const d = wbsParseDate(text);
  return d && d.getFullYear() >= 2000 && d.getFullYear() <= 2100 ? d : null;
}
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Loads the plan after checking the viewer may edit it (not outside, not read-only, not the client). */
async function editablePlan(code: unknown): Promise<{ data: PlanData } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code) return { error: t('Invalid request') };
  if (!(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'plan');
  if (!ctx.canEdit('plan') || ctx.viewer.role === 'client') return { error: t('This plan is read-only for you') };
  const data = await getPlanData(code);
  if (!data) return { error: t('This project has no plan yet') };
  return { data };
}

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

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
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const a = r.data.activities.find((x) => x.id === actId);
  if (!a || !FIELDS.includes(field)) return { error: t('Invalid request') };
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

/** Remove an activity, or a work package with all its activities (`rmKey`). The root cannot be removed. */
export async function removeRow(code: string, kind: 'wp' | 'act', key: string): Promise<PlanActionResult> {
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const done = kind === 'wp' ? await deleteWorkPackage(code, str(key)) : kind === 'act' ? await deleteActivity(code, str(key)) : false;
  if (!done) return { error: t('Invalid request') };
  refresh(code);
  return { ok: true };
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
  const r = await editablePlan(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const id = str(values?.act).split(' · ')[0];
  if (!id) return { toast: await toastOf('Progress saved') };
  if (!r.data.activities.some((a) => a.id === id)) return { error: t('Invalid request') };
  const pc = clampPct(str(values?.pc));
  await updateActivity(code, id, { pct: pc });
  refresh(code);
  return { toast: await toastOf(`${id} · ${pc} % · Progress saved`) };
}
