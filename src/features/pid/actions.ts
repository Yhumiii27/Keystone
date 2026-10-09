'use server';
// P&ID Server Functions (docs/spec/09 §6.10–6.11). Each one validates its raw input, checks that the viewer may edit
// this project's P&ID (screen in their workspace — director, engineering lead, quality — and project not read-only
// for them; the DAL writers re-check the workspace), writes through the P&ID data layer with the viewer as the actor
// (audit row), then revalidates the project's pages (the P&ID screen and the nav badge).
// - mapPidTagAction / unlinkPidTagAction: the tag drawer's candidate pick and "Unlink" (`pidOv` of the prototype).
// - stagePidImportAction: "Import P&ID tags" step 1 → the staged plan (no write).
// - applyPidImportAction: step 2 → the import, re-planned on the server; toast "27 tags · rev E imported · 3 new · 1 updated".
import { revalidatePath } from 'next/cache';
import { isPidImportMode, isPidImportSource, normaliseRevision, parseDelimited, PID_IMPORT_LIMITS, type PidImportMode, type PidImportSource } from '@/domain/pid-import';
import { getProject } from '@/server/dal/projects';
import { mapPidTag, pidCandidates } from '@/server/dal/pid';
import { applyPidImport, stagePidImport } from '@/server/dal/pid-import';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { importToastT, linkedToastT, messageT, unlinkedToastT } from './i18n';
import { pidStageView, type PidStageView } from './import-model';
import { isZip, readXlsxFirstSheet } from './xlsx';

export interface PidActionResult {
  toast?: string;
  error?: string;
}

/** Messages of the data layer and the import that may be shown as they are (translated); anything else is generic. */
const KNOWN = [
  /is not a BOM article of a compatible type$/, /is not mapped$/, / is already linked to \S+$/, /^Unknown tag /, /^Client-supplied equipment: no BOM reference expected$/, /is outside your workspace$/,
  /^No valid tag in the file$/, /^Nothing to import: every tag is unchanged$/, /^The file is empty$/, /^No "Tag" column/, /^No "Description" column/, /^The file lists no tag$/,
  /^Too many lines/, /^The file is not an Excel workbook/, /^The workbook /,
];
const SAVE_FAILED = 'The change could not be saved';

async function tr(english: string) {
  const { t, lang } = await getI18n();
  return messageT(english, t, lang);
}
const errorText = async (e: unknown) => tr(e instanceof Error && KNOWN.some((re) => re.test(e.message)) ? e.message : SAVE_FAILED);

/** The project and the viewer allowed to edit its P&ID, or an error message. */
async function guard(code: unknown) {
  if (typeof code !== 'string' || !code || code.length > 40) return { error: await tr('Invalid request') } as const;
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') } as const;
  const ctx = await getProjectContext(project.code, 'pid');
  if (!ctx.canEdit('pid')) return { error: await tr('This P&ID is read-only for you') } as const;
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role } } as const;
}

const ident = (v: unknown, max = 60): string | null => (typeof v === 'string' && /^[A-Za-z0-9][\w ./#×-]*$/.test(v.trim()) && v.trim().length <= max ? v.trim() : null);

function revalidate(code: string) {
  revalidatePath(`/projects/${code}`, 'layout');
}

/** Candidate pick: the tag is linked to a BOM article of a compatible type. */
export async function mapPidTagAction(code: unknown, tag: unknown, ref: unknown): Promise<PidActionResult> {
  const g = await guard(code);
  if ('error' in g) return { error: g.error };
  const tg = ident(tag);
  const rf = ident(ref);
  if (!tg || !rf) return { error: await tr('Invalid request') };
  const candidates = await pidCandidates(g.code, tg);
  const cand = candidates.find((c) => c.ref.toUpperCase() === rf.toUpperCase());
  if (!cand) return { error: await tr(`${rf} is not a BOM article of a compatible type`) };
  try {
    await mapPidTag(g.code, tg, cand.ref, g.actor);
  } catch (e) {
    return { error: await errorText(e) };
  }
  revalidate(g.code);
  const { t } = await getI18n();
  return { toast: linkedToastT(tg, cand.ref, t) };
}

/** "Unlink": the tag loses its BOM reference. */
export async function unlinkPidTagAction(code: unknown, tag: unknown): Promise<PidActionResult> {
  const g = await guard(code);
  if ('error' in g) return { error: g.error };
  const tg = ident(tag);
  if (!tg) return { error: await tr('Invalid request') };
  try {
    await mapPidTag(g.code, tg, null, g.actor);
  } catch (e) {
    return { error: await errorText(e) };
  }
  revalidate(g.code);
  const { t } = await getI18n();
  return { toast: unlinkedToastT(tg, t) };
}

/** Raw import input as the dialog sends it. */
export interface PidImportRequest {
  /** File name ("PID-HLT-026_revE_tags.xlsx"); '' for pasted cells. */
  fileName: string;
  /** `text`: CSV / TSV / pasted cells; `xlsx`: the workbook, base64. */
  kind: 'text' | 'xlsx';
  data: string;
  rev: string;
  source: PidImportSource;
  mode: PidImportMode;
}

type ParsedRequest = { ok: true; fileName: string; table: string[][]; revision: string; source: PidImportSource; mode: PidImportMode } | { ok: false; error: string };

function readRequest(raw: unknown): ParsedRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid request' };
  const r = raw as Record<string, unknown>;
  if (!isPidImportSource(r.source) || !isPidImportMode(r.mode) || (r.kind !== 'text' && r.kind !== 'xlsx') || typeof r.data !== 'string') return { ok: false, error: 'Invalid request' };
  if (typeof r.rev !== 'string' || !r.rev.trim()) return { ok: false, error: 'The revision is required' };
  const revision = normaliseRevision(r.rev);
  if (!revision) return { ok: false, error: 'Invalid revision (1 to 6 letters or digits, e.g. E)' };
  const fileName = typeof r.fileName === 'string' ? r.fileName.replace(/[\u0000-\u001f]/g, '').split(/[\\/]/).pop()!.slice(0, 200) : '';
  if (!r.data.trim()) return { ok: false, error: 'Choose a file or paste the tag list' };
  if (r.data.length > PID_IMPORT_LIMITS.chars * (r.kind === 'xlsx' ? 2 : 1)) return { ok: false, error: 'The file is too large' };
  let table: string[][];
  if (r.kind === 'xlsx') {
    const buf = Buffer.from(r.data, 'base64');
    if (!isZip(buf)) return { ok: false, error: 'The file is not an Excel workbook (.xlsx)' };
    try {
      table = readXlsxFirstSheet(buf);
    } catch (e) {
      return { ok: false, error: e instanceof Error && /^The (file|workbook) /.test(e.message) ? e.message : 'The file could not be read' };
    }
  } else table = parseDelimited(r.data);
  return { ok: true, fileName, table, revision, source: r.source, mode: r.mode };
}

/** Step 1 → 2: the staged plan of the import (nothing is written). */
export async function stagePidImportAction(code: unknown, raw: unknown): Promise<{ stage?: PidStageView; error?: string }> {
  const g = await guard(code);
  if ('error' in g) return { error: g.error };
  const req = readRequest(raw);
  if (!req.ok) return { error: await tr(req.error) };
  try {
    const st = await stagePidImport(g.code, { mode: req.mode, table: req.table }, g.actor);
    const { t, lang } = await getI18n();
    return {
      stage: pidStageView(
        { plan: st.plan, revision: req.revision, currentRevision: st.currentRevision, documentNumber: st.documentNumber, source: req.source, mode: req.mode, fileName: req.fileName, projectCode: g.code },
        t,
        lang,
      ),
    };
  } catch (e) {
    return { error: await errorText(e) };
  }
}

/** Step 2 → done: the import is re-planned and applied; toast "27 tags · rev E imported · 3 new · 1 updated". */
export async function applyPidImportAction(code: unknown, raw: unknown): Promise<PidActionResult> {
  const g = await guard(code);
  if ('error' in g) return { error: g.error };
  const req = readRequest(raw);
  if (!req.ok) return { error: await tr(req.error) };
  let result;
  try {
    result = await applyPidImport(g.code, { fileName: req.fileName, revision: req.revision, source: req.source, mode: req.mode, table: req.table }, g.actor);
  } catch (e) {
    return { error: await errorText(e) };
  }
  revalidate(g.code);
  const { lang } = await getI18n();
  return { toast: importToastT(result.plan.counts, result.revision, lang) };
}
