import 'server-only';
// Runs an export (chapter 4): builds the export context of the viewer — the same access rules as the screen — calls the
// provider, writes the file and records it in the export log. The route handler (src/app/api/export/[screen]/route.ts) is a
// thin wrapper; tests call buildExportContext / runExport directly with a persona.
import { SCREEN_BY_ID, type ScreenId } from '@/config/screens';
import { isOutside } from '@/components/app/shell/nav-model';
import { canSeeRates } from '@/domain/hr';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb } from '@/server/db/client';
import { findPerson, requireProject } from '@/server/db/helpers';
import type { ExportFormat } from '@/server/db/codes';
import { exportLog } from '@/server/db/schema';
import { getProject, listProjects } from '@/server/dal/projects';
import { isMineProject } from '@/server/project-context';
import type { Viewer, ZoneKey } from '@/server/session';
import { toCsv } from './csv';
import { renderPdf } from './pdf';
import { formatsOf, getExportProvider } from './registry';
import type { ExportContext, ExportFile, PdfDocument } from './types';
import { toXlsx } from './xlsx';
import './providers';

/** Refusal with the HTTP status the route returns; `message` is an EN source sentence. */
export class ExportError extends Error {
  readonly status: 400 | 403 | 404;
  constructor(status: 400 | 403 | 404, message: string) {
    super(message);
    this.name = 'ExportError';
    this.status = status;
  }
}

const ZONES = new Set(['euna', 'afr', 'apac']);

export interface ExportRequest {
  screen: string;
  viewer: Viewer;
  lang: Lang;
  /** Query string of the export URL (format, code, variant, id and the screen's filters). */
  params: URLSearchParams;
  /** Zone bar cookie (zone screens) — `?zone=` wins. */
  zoneCookie?: ZoneKey | null;
  now?: Date;
}

/**
 * Export context with the screen's access rules: unknown screen → 404; project-scoped screens need `code` (unknown → 404);
 * a client exports only the projects of their organisation (403). Screens outside the viewer's workspace stay exportable
 * read-only, as the screen itself is (`outside`), unless the provider refuses.
 */
export async function buildExportContext(req: ExportRequest): Promise<ExportContext> {
  const def = SCREEN_BY_ID[req.screen as ScreenId];
  if (!def) throw new ExportError(404, 'Unknown screen');
  const screen = def.id;
  const code = req.params.get('code');
  let project = null;
  let readOnly = false;
  if (def.scope === 'project') {
    if (!code) throw new ExportError(400, 'Project code missing');
    project = await getProject(code);
    if (!project) throw new ExportError(404, 'Unknown project');
    if (req.viewer.role === 'client' && !isMineProject(req.viewer, project)) throw new ExportError(403, 'Clients export their own projects only');
    // Same rule as getProjectScope (project read-only, 01 §5.2) for an explicit viewer.
    const pool = (await listProjects()).filter((p) => p.hasData);
    const mine = pool.filter((p) => isMineProject(req.viewer, p)).length;
    readOnly = req.viewer.role !== 'director' && mine > 0 && mine < pool.length && !isMineProject(req.viewer, project);
  }
  const z = req.params.get('zone');
  const zone = (z && ZONES.has(z) ? (z as ZoneKey) : null) ?? req.zoneCookie ?? null;
  const params = new URLSearchParams();
  req.params.forEach((v, k) => {
    if (!['format', 'variant'].includes(k)) params.append(k, v);
  });
  return {
    viewer: req.viewer, lang: req.lang, t: makeT(req.lang), screen, outside: isOutside(req.viewer.role, screen), project, readOnly, params, zone,
    ratesMasked: !canSeeRates(req.viewer.role), variant: req.params.get('variant') || null, now: req.now ?? new Date(),
  };
}

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** "budget-HLT-026-2026-10-09.xlsx" (ASCII, no spaces). */
export function exportFileName(base: string, ctx: Pick<ExportContext, 'project' | 'params' | 'variant' | 'now'>, format: ExportFormat): string {
  const id = ctx.variant ? ctx.params.get('id') : null;
  const parts = [base, ctx.project?.code, id].filter(Boolean).join('-');
  const clean = parts.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${clean || 'export'}-${ctx.now.toISOString().slice(0, 10)}.${format}`;
}

/** Labels of the Excel "Export" sheet. */
const xlsxLabels = (t: (s: string) => string) => ({
  sheet: t('Export'), title: t('Title'), project: t('Project'), filters: t('Filters'), exportedBy: t('Exported by'), exportedOn: t('Exported on'),
});

const pdfRows = (doc: PdfDocument) => doc.blocks.reduce((n, b) => n + (b.kind === 'table' ? b.sheet.rows.length : 0), 0);

/**
 * Produces the file. Throws ExportError (404 no provider / nothing to export, 403 refused, 400 bad format).
 * `compressPdf: false` keeps PDF text readable for tests (src/server/export/test/pdf-text.ts).
 */
export async function runExport(ctx: ExportContext, format: ExportFormat, opts: { compressPdf?: boolean } = {}): Promise<ExportFile> {
  const p = getExportProvider(ctx.screen);
  if (!p) throw new ExportError(404, 'No export for this screen');
  const reason = p.refuse?.(ctx);
  if (reason) throw new ExportError(403, reason);
  const base = p.fileBase?.(ctx) ?? ctx.screen;
  if (format === 'pdf') {
    const make = ctx.variant ? p.documents?.[ctx.variant] : p.pdf;
    if (!make) throw new ExportError(404, ctx.variant ? 'Unknown document' : 'No PDF report for this screen');
    const doc = await make(ctx);
    if (!doc) throw new ExportError(404, 'Nothing to export');
    const body = await renderPdf(doc, ctx.lang, ctx.now, { compress: opts.compressPdf ?? true });
    return { format, fileName: exportFileName(ctx.variant ?? base, ctx, 'pdf'), mime: MIME.pdf, body, rowCount: pdfRows(doc) };
  }
  if (!p.table || !formatsOf(p).includes(format)) throw new ExportError(400, 'Format not available for this screen');
  const wb = await p.table(ctx);
  if (!wb || !wb.sheets.length) throw new ExportError(404, 'Nothing to export');
  if (format === 'csv') {
    const body = new TextEncoder().encode(toCsv(wb.sheets[0], ctx.lang));
    return { format, fileName: exportFileName(base, ctx, 'csv'), mime: MIME.csv, body, rowCount: wb.sheets[0].rows.length };
  }
  const body = await toXlsx(wb, {
    lang: ctx.lang, labels: xlsxLabels(ctx.t), project: ctx.project ? `${ctx.project.code} · ${ctx.t(ctx.project.name)}` : null, exportedBy: ctx.viewer.name,
    exportedOn: ctx.now,
  });
  return { format, fileName: exportFileName(base, ctx, 'xlsx'), mime: MIME.xlsx, body, rowCount: wb.sheets.reduce((n, s) => n + s.rows.length, 0) };
}

/** Records a produced file in the export log (screen, format, variant, project, filters, rows, viewer). */
export async function logExport(ctx: ExportContext, file: ExportFile): Promise<void> {
  const db = await getDb();
  const person = await findPerson(db, ctx.viewer.name);
  const projectId = ctx.project ? (await requireProject(db, ctx.project.code)).id : null;
  const params: Record<string, string> = {};
  ctx.params.forEach((v, k) => (params[k] = v));
  await db.insert(exportLog).values({
    screen: ctx.screen, format: file.format, variant: ctx.variant, projectId, params, rowCount: file.rowCount, fileName: file.fileName,
    byPersonId: person?.id ?? null, byName: ctx.viewer.name, byRole: ctx.viewer.role, at: ctx.now,
  });
}
