// File exports (chapter 4, X-3 / C-5) — GET /api/export/<screen>?format=csv|xlsx|pdf&code=<project>&variant=&id=&<filters>.
// The viewer is the "View as" persona (cookie); the rights are the screen's (src/server/export/run.ts): unknown screen or
// project → 404, a client on another organisation's project → 403, a provider refusal → 403. Every file is logged.
// R-008: the export is written to the export log, so a request from another site is refused (403); at most
// RATE_LIMITS.export files a minute per viewer (429 with Retry-After).
import { isExportFormat } from '@/server/db/codes';
import { contentDisposition } from '@/server/storage/files';
import { logError } from '@/server/log';
import { ExportError, buildExportContext, logExport, runExport } from '@/server/export/run';
import { TOO_MANY_REQUESTS, hitRateLimit, isSameOriginRequest, rateClient, tooManyRequestsResponse } from '@/server/http/request-guard';
import { getI18n, getViewer, getZone } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ screen: string }> }): Promise<Response> {
  const [{ screen }, viewer, { lang, t }, zoneCookie] = await Promise.all([ctx.params, getViewer(), getI18n(), getZone()]);
  const params = new URL(request.url).searchParams;
  const format = params.get('format') ?? 'xlsx';
  const text = (status: number, msg: string) => new Response(t(msg), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!isSameOriginRequest(request)) return text(403, 'Invalid request');
  if (!isExportFormat(format)) return text(400, 'Unknown export format');
  const limited = hitRateLimit('export', rateClient(request.headers, viewer));
  if (!limited.ok) return tooManyRequestsResponse('text', t(TOO_MANY_REQUESTS), limited.retryAfterSec);
  try {
    const ectx = await buildExportContext({ screen, viewer, lang, params, zoneCookie });
    const file = await runExport(ectx, format);
    await logExport(ectx, file).catch((e) => logError('Export log', e, { route: 'api/export', screen }));
    return new Response(file.body as BodyInit, {
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(file.body.byteLength),
        'Content-Disposition': contentDisposition(file.fileName, 'attachment'),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ExportError) return text(e.status, e.message);
    logError('Export', e, { route: 'api/export', screen, format });
    return text(500, 'Export failed');
  }
}
