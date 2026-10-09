import 'server-only';
// Import jobs of Activity & integrations (chapter 4, S-9 and the Excel / CSV imports): upload → parse → (column mapping) →
// preview (dry run: only the staging rows are written) → explicit confirmation → one transaction that re-plans, checks that the
// plan still matches the preview, writes the business rows, marks the job imported and writes audit + activity.
//
// Rights are checked at every step (./rights.ts): the viewer's role, project ownership for the PM, and the job's author (a job
// is continued only by the persona who started it). Messages are EN source sentences (./messages.ts); the screen translates them.
import type { RoleKey } from '@/config/screens';
import { getDb } from '@/server/db/client';
import type { ImportJobStatus, ImportKind, ImportMode, ImportRowAction, ImportRowStatus } from '@/server/db/codes';
import { importKind } from '@/server/db/codes';
import {
  cancelImportJob, createImportJob, getImportJob, getImportJobRows, markImportJobApplied, markImportJobFailed, saveImportPreview, setImportJobMapping, type ImportJobView,
} from '@/server/dal/import-jobs';
import { getProject, listProjects } from '@/server/dal/projects';
import { readXlsx } from '@/server/export/xlsx';
import { FileRejectedError, readStoredFile, setFileOwner, storeFile } from '@/server/storage/files';
import { fmt } from './messages';
import { parseMspdi } from './mspdi';
import { INTERCHANGE_DEFAULTS } from './defaults';
import { canImport } from './rights';
import { planScheduleImport, writeScheduleImport, type MatchOn, type ScheduleImportOptions } from './schedule-import';
import { stampMsProjectConnector } from './schedule-export';
import { TABLE_FIELDS, autoMapping, columnNames, decodeText, detectHeaderRow, detectSeparator, isTableKind, mapRows, mappingError, normaliseRow, parseCsv, type Cell, type TableKind } from './table';
import { planTableImport, writeTableImport } from './table-import';
import { parseXer } from './xer';
import type { ImportedSchedule } from './model';

export interface ImportViewer {
  name: string;
  short: string;
  role: RoleKey;
}

/** One preview row as the dialog shows it. */
export interface PreviewRowView {
  position: number;
  status: ImportRowStatus;
  action: ImportRowAction;
  key: string | null;
  data: Record<string, unknown>;
  /** EN source messages. */
  messages: string[];
}

export interface PreviewView {
  jobId: string;
  kind: ImportKind;
  mode: ImportMode;
  fileName: string;
  projectCode: string | null;
  summary: Record<string, unknown>;
  counts: Record<ImportRowStatus, number>;
  actions: Record<ImportRowAction, number>;
  rows: PreviewRowView[];
  /** Rows not sent to the dialog (beyond PREVIEW_ROWS). */
  more: number;
  blocking: string[];
  canImport: boolean;
}

export interface MappingView {
  jobId: string;
  kind: TableKind;
  fileName: string;
  sheets: string[];
  sheet: string | null;
  columns: string[];
  /** Target field → column (auto-detected). */
  mapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean }[];
  /** First data rows (cell texts), for the mapping step. */
  sample: string[][];
  headerLine: number;
}

export type ImportStep =
  | { ok: true; step: 'mapping'; mapping: MappingView }
  | { ok: true; step: 'preview'; preview: PreviewView }
  | { ok: true; step: 'done'; projectCode: string | null; created: number; updated: number; kind: ImportKind }
  | { ok: false; error: string; stale?: PreviewView };

/** Rows sent to the dialog (the full preview stays in import_job_rows). */
export const PREVIEW_ROWS = 400;

const SCHEDULE_KINDS: readonly ImportKind[] = ['mspdi', 'xer'];
const isScheduleKind = (k: ImportKind) => SCHEDULE_KINDS.includes(k);

export interface StartImportInput {
  /** 'schedule' = MS Project or P6 (detected from the file), else a table kind. */
  kind: 'schedule' | TableKind;
  mode: ImportMode;
  projectCode: string | null;
  fileName: string;
  data: Uint8Array;
  /** Schedule options. */
  matchOn?: MatchOn;
  importBaselines?: boolean;
  projectName?: string | null;
  client?: string | null;
  pmName?: string | null;
}

/** May the viewer import `kind` into `projectCode`? EN refusal or null. */
async function refusal(viewer: ImportViewer, kind: ImportKind, mode: ImportMode, projectCode: string | null): Promise<string | null> {
  let own: boolean | null = null;
  if (projectCode) {
    const p = await getProject(projectCode);
    if (!p) return 'Unknown project';
    own = viewer.role === 'director' || p.pm === viewer.short;
  } else if (!(isScheduleKind(kind) && mode === 'new') && kind !== 'parts') return 'Choose the project to update';
  return canImport(viewer.role, kind, own) ? null : 'You may not import this file into this project';
}

/** Detects MS Project XML vs P6 XER from the content (the drop zone may be the other card's). */
function scheduleKindOf(name: string, text: string): ImportKind | null {
  if (/^﻿?ERMHDR\t/.test(text)) return 'xer';
  if (/<Project[\s>]/.test(text.slice(0, 4096)) || /\.xml$/i.test(name)) return 'mspdi';
  return null;
}

function parseSchedule(kind: ImportKind, text: string): ImportedSchedule {
  return kind === 'xer' ? parseXer(text) : parseMspdi(text);
}

const scheduleOptionsOf = (job: ImportJobView): ScheduleImportOptions => ({
  mode: job.mode, projectCode: job.projectCode, matchOn: job.options.matchOn === 'activity_id' || job.options.matchOn === 'uid' ? job.options.matchOn : INTERCHANGE_DEFAULTS.matchOn,
  importBaselines: typeof job.options.importBaselines === 'boolean' ? job.options.importBaselines : INTERCHANGE_DEFAULTS.importBaselines,
  projectName: typeof job.options.projectName === 'string' ? job.options.projectName : null, client: typeof job.options.client === 'string' ? job.options.client : null,
  pmName: typeof job.options.pmName === 'string' ? job.options.pmName : null,
});

async function previewOf(jobId: string, blocking: string[], summary: Record<string, unknown>): Promise<PreviewView> {
  const job = (await getImportJob(jobId))!;
  const rows = await getImportJobRows(jobId);
  const actions: Record<ImportRowAction, number> = { create: 0, update: 0, skip: 0 };
  for (const r of rows) actions[r.action]++;
  const shown = rows.slice(0, PREVIEW_ROWS).map((r) => ({ position: r.position, status: r.status, action: r.action, key: r.key ?? null, data: r.data, messages: r.messages ?? [] }));
  return {
    jobId, kind: job.kind, mode: job.mode, fileName: job.fileName, projectCode: job.projectCode, summary, counts: job.counts, actions, rows: shown, more: Math.max(0, rows.length - PREVIEW_ROWS),
    blocking, canImport: !blocking.length && rows.some((r) => r.action !== 'skip' && r.status !== 'error'),
  };
}

// ── Table reading ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface ReadTable {
  sheets: string[];
  sheet: string | null;
  rows: Cell[][];
  decimal: ',' | '.' | null;
}

async function readTable(fileName: string, data: Uint8Array, sheet: string | null): Promise<ReadTable> {
  const zip = data[0] === 0x50 && data[1] === 0x4b;
  if (zip || /\.xlsx$/i.test(fileName)) {
    let sheets;
    try {
      sheets = await readXlsx(data);
    } catch {
      throw new Error(fmt('The file could not be read'));
    }
    const pick = sheets.find((s) => s.name === sheet) ?? sheets.find((s) => s.rows.some((r) => r.some((c) => c != null && c !== ''))) ?? sheets[0];
    return { sheets: sheets.map((s) => s.name), sheet: pick?.name ?? null, rows: pick?.rows ?? [], decimal: null };
  }
  const text = decodeText(data);
  const sep = detectSeparator(text);
  return { sheets: [], sheet: null, rows: parseCsv(text, sep), decimal: sep === ';' ? ',' : sep === ',' ? '.' : null };
}

function tableShape(kind: TableKind, t: ReadTable) {
  const headerIndex = detectHeaderRow(t.rows, kind);
  const columns = columnNames(t.rows[headerIndex] ?? []);
  return { headerIndex, columns };
}

const cellText = (c: Cell) => (c == null ? '' : String(c));

async function mappingView(job: ImportJobView, kind: TableKind, t: ReadTable): Promise<MappingView> {
  const { headerIndex, columns } = tableShape(kind, t);
  const saved = job.mapping && Object.keys(job.mapping).length && job.options.sheet === t.sheet ? job.mapping : null;
  return {
    jobId: job.id, kind, fileName: job.fileName, sheets: t.sheets, sheet: t.sheet, columns, mapping: saved ?? autoMapping(columns, kind),
    fields: TABLE_FIELDS[kind].map((f) => ({ key: f.key, label: f.label, required: f.required })),
    sample: t.rows.slice(headerIndex + 1).filter((r) => r.some((c) => cellText(c).trim())).slice(0, 5).map((r) => columns.map((_, i) => cellText(r[i]).slice(0, 80))),
    headerLine: headerIndex + 1,
  };
}

async function fileOf(job: ImportJobView): Promise<Uint8Array> {
  const f = job.fileId ? await readStoredFile(job.fileId) : null;
  if (!f) throw new Error(fmt('The file could not be read'));
  return new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength);
}

// ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const errorOf = (e: unknown) => (e instanceof FileRejectedError || e instanceof Error ? e.message : 'The import failed');

/** Step 1: stores the file, records the job and parses it (schedule → preview; table → column mapping). */
export async function startImport(input: StartImportInput, viewer: ImportViewer): Promise<ImportStep> {
  let kind: ImportKind;
  if (input.kind === 'schedule') {
    const k = scheduleKindOf(input.fileName, decodeText(input.data.subarray(0, 8192)));
    if (!k) return { ok: false, error: 'The file is not an MS Project XML file (MSPDI)' };
    kind = k;
  } else if (isTableKind(input.kind)) kind = input.kind;
  else return { ok: false, error: 'Invalid request' };
  const projectCode = (isScheduleKind(kind) && input.mode === 'new') || kind === 'parts' ? null : input.projectCode;
  const refused = await refusal(viewer, kind, input.mode, projectCode);
  if (refused) return { ok: false, error: refused };
  let fileId: string;
  try {
    const meta = await storeFile({ purpose: 'import', name: input.fileName, data: input.data, actor: { name: viewer.name } });
    fileId = meta.id;
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
  const options: Record<string, unknown> = isScheduleKind(kind)
    ? { matchOn: input.matchOn ?? INTERCHANGE_DEFAULTS.matchOn, importBaselines: input.importBaselines ?? INTERCHANGE_DEFAULTS.importBaselines, projectName: input.projectName ?? null, client: input.client ?? null,
      // A project manager imports a new project for themself (they manage it, so they may edit it).
      pmName: viewer.role === 'pm' ? viewer.short : (input.pmName ?? null) }
    : {};
  const jobId = await createImportJob({ kind, mode: input.mode, projectCode, fileId, fileName: input.fileName, options, actorName: viewer.name });
  await setFileOwner(fileId, { ownerType: 'import_job', ownerId: jobId });
  const job = (await getImportJob(jobId))!;
  if (isScheduleKind(kind)) return previewSchedule(job);
  try {
    return { ok: true, step: 'mapping', mapping: await mappingView(job, kind as TableKind, await readTable(job.fileName, await fileOf(job), null)) };
  } catch (e) {
    await markImportJobFailed(jobId, errorOf(e));
    return { ok: false, error: errorOf(e) };
  }
}

async function previewSchedule(job: ImportJobView): Promise<ImportStep> {
  try {
    const s = parseSchedule(job.kind, decodeText(await fileOf(job)));
    const db = await getDb();
    const plan = await planScheduleImport(s, scheduleOptionsOf(job), db);
    const summary = { ...plan.summary } as unknown as Record<string, unknown>;
    await saveImportPreview(job.id, plan.rows, summary);
    return { ok: true, step: 'preview', preview: await previewOf(job.id, plan.blocking, summary) };
  } catch (e) {
    await markImportJobFailed(job.id, errorOf(e));
    return { ok: false, error: errorOf(e) };
  }
}

/** The job if this viewer may continue it, else an EN refusal. */
async function ownJob(jobId: string, viewer: ImportViewer, statuses: ImportJobStatus[]): Promise<ImportJobView | string> {
  const job = typeof jobId === 'string' ? await getImportJob(jobId) : null;
  if (!job || job.createdByName !== viewer.name) return 'Unknown import';
  if (!statuses.includes(job.status)) return job.status === 'applied' ? 'This import is already imported' : job.status === 'cancelled' ? 'This import is cancelled' : 'Preview the import before confirming it';
  const refused = await refusal(viewer, job.kind, job.mode, job.projectCode);
  return refused ?? job;
}

/** Mapping step of a table import (re-read, e.g. on another sheet). */
export async function tableMapping(jobId: string, sheet: string | null, viewer: ImportViewer): Promise<ImportStep> {
  const job = await ownJob(jobId, viewer, ['uploaded', 'mapped', 'previewed']);
  if (typeof job === 'string') return { ok: false, error: job };
  if (!isTableKind(job.kind)) return { ok: false, error: 'Invalid request' };
  try {
    const t = await readTable(job.fileName, await fileOf(job), sheet);
    return { ok: true, step: 'mapping', mapping: await mappingView(job, job.kind, t) };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

async function planTable(job: ImportJobView & { kind: TableKind }, mapping: Record<string, string | null>, sheet: string | null) {
  const t = await readTable(job.fileName, await fileOf(job), sheet);
  const { headerIndex, columns } = tableShape(job.kind, t);
  const err = mappingError(job.kind, columns, mapping);
  if (err) throw new Error(err);
  const rows = mapRows(columns, t.rows, headerIndex, mapping).map((r) => normaliseRow(job.kind, r, t.decimal));
  return { plan: await planTableImport(job.kind, rows, { mode: job.mode, projectCode: job.projectCode }, await getDb()), sheet: t.sheet };
}

/** Step 2 of a table import: saves the mapping and runs the dry run. */
export async function previewTable(jobId: string, mapping: Record<string, string | null>, sheet: string | null, viewer: ImportViewer): Promise<ImportStep> {
  const job = await ownJob(jobId, viewer, ['uploaded', 'mapped', 'previewed']);
  if (typeof job === 'string') return { ok: false, error: job };
  if (!isTableKind(job.kind)) return { ok: false, error: 'Invalid request' };
  try {
    const clean: Record<string, string | null> = {};
    for (const f of TABLE_FIELDS[job.kind]) clean[f.key] = typeof mapping?.[f.key] === 'string' && mapping[f.key] ? String(mapping[f.key]) : null;
    const { plan, sheet: usedSheet } = await planTable(job as ImportJobView & { kind: TableKind }, clean, sheet);
    await setImportJobMapping(job.id, clean, { sheet: usedSheet });
    const summary = { ...plan.summary } as unknown as Record<string, unknown>;
    await saveImportPreview(job.id, plan.rows, summary);
    return { ok: true, step: 'preview', preview: await previewOf(job.id, plan.blocking, summary) };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

const COUNT_KEYS = ['create', 'update', 'skip', 'error'] as const;
const scheduleCounts = (s: Record<string, unknown>) => {
  const a = (s.activities ?? {}) as Record<string, number>;
  const p = (s.packages ?? {}) as Record<string, number>;
  return [a.create, a.update, a.error, p.create, p.update, s.links, s.kept].map((x) => Number(x ?? 0)).join('/');
};
const tableCounts = (s: Record<string, unknown>) => COUNT_KEYS.map((k) => Number(s[k] ?? 0)).join('/');

/** Step 3: explicit confirmation — re-plans and writes everything in one transaction (refused when the data changed since the preview). */
export async function applyImport(jobId: string, viewer: ImportViewer): Promise<ImportStep> {
  const job = await ownJob(jobId, viewer, ['previewed']);
  if (typeof job === 'string') return { ok: false, error: job };
  const db = await getDb();
  try {
    if (isScheduleKind(job.kind)) {
      const s = parseSchedule(job.kind, decodeText(await fileOf(job)));
      const opts = scheduleOptionsOf(job);
      const result = await db.transaction(async (tx) => {
        const plan = await planScheduleImport(s, opts, tx);
        const summary = plan.summary as unknown as Record<string, unknown>;
        if (scheduleCounts(summary) !== scheduleCounts(job.summary) || plan.blocking.length) return { stale: plan, written: null };
        const w = await writeScheduleImport(s, plan, opts, viewer.name, tx);
        await markImportJobApplied(
          job.id,
          { summary: { ...summary, projectCode: w.projectCode, created: w.created, updated: w.updated }, projectCode: w.projectCode, actorName: viewer.name,
            activityText: `${importKind.label(job.kind)} · ${job.fileName} imported into ${w.projectCode} · ${w.created + w.updated} activities` },
          tx,
        );
        if (job.kind === 'mspdi') await stampMsProjectConnector(tx, `${w.projectCode} imported · ${w.created + w.updated} activities`);
        return { stale: null, written: w };
      });
      if (result.stale) {
        const summary = result.stale.summary as unknown as Record<string, unknown>;
        await saveImportPreview(job.id, result.stale.rows, summary);
        return { ok: false, error: 'The data changed since the preview — check the new preview', stale: await previewOf(job.id, result.stale.blocking, summary) };
      }
      const w = result.written!;
      return { ok: true, step: 'done', projectCode: w.projectCode, created: w.created, updated: w.updated, kind: job.kind };
    }
    const kind = job.kind as TableKind;
    const sheet = typeof job.options.sheet === 'string' ? job.options.sheet : null;
    const { plan } = await planTable(job as ImportJobView & { kind: TableKind }, job.mapping, sheet);
    const summary = plan.summary as unknown as Record<string, unknown>;
    if (tableCounts(summary) !== tableCounts(job.summary) || plan.blocking.length) {
      await saveImportPreview(job.id, plan.rows, summary);
      return { ok: false, error: 'The data changed since the preview — check the new preview', stale: await previewOf(job.id, plan.blocking, summary) };
    }
    const written = await db.transaction(async (tx) => {
      const w = await writeTableImport(kind, plan, job.projectCode, viewer.name, tx);
      await markImportJobApplied(
        job.id,
        { summary: { ...summary, created: w.created, updated: w.updated }, actorName: viewer.name,
          activityText: `${importKind.label(kind)} · ${job.fileName} imported${job.projectCode ? ` into ${job.projectCode}` : ''} · ${w.created} created · ${w.updated} updated` },
        tx,
      );
      return w;
    });
    return { ok: true, step: 'done', projectCode: job.projectCode, created: written.created, updated: written.updated, kind };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

/** Cancels a job that was not imported (the stored file stays with the cancelled job for the audit). */
export async function cancelImport(jobId: string, viewer: ImportViewer): Promise<ImportStep | { ok: true; step: 'cancelled' }> {
  const job = typeof jobId === 'string' ? await getImportJob(jobId) : null;
  if (!job || job.createdByName !== viewer.name) return { ok: false, error: 'Unknown import' };
  if (job.status === 'applied' || job.status === 'cancelled') return { ok: true, step: 'cancelled' };
  await cancelImportJob(job.id, viewer.name);
  return { ok: true, step: 'cancelled' };
}

/** Projects offered by the import dialogs for this viewer and kind (with planning data for schedules / assignments). */
export async function importTargets(viewer: ImportViewer): Promise<Record<ImportKind, { code: string; label: string }[]>> {
  const all = await listProjects();
  const out = {} as Record<ImportKind, { code: string; label: string }[]>;
  for (const kind of importKind.codes) {
    out[kind] = all
      .filter((p) => (kind === 'budget_lines' || kind === 'bom' ? true : p.hasData))
      .filter((p) => canImport(viewer.role, kind, viewer.role === 'director' || p.pm === viewer.short))
      .map((p) => ({ code: p.code, label: `${p.displayId} · ${p.name}` }));
  }
  return out;
}
