// "Export — MS Project XML" (chapter 4, S-9) — GET /api/interchange/mspdi/<project code>: the project's schedule as an MSPDI file
// with its displayed baseline as Baseline 0 (src/server/interchange/schedule-export.ts). Same reading rights as the screens: an
// unknown project or one without planning → 404, a client → 403 (the export carries costs and resources and lives on Activity &
// integrations, outside the client's workspace — P-1). Every export is audited,
// listed in the activity feed and stamped on the "MS Project" connector row ("HLT-026 exported · BL1"). R-008: since it
// writes, a request from another site is refused (403); it counts in the export rate limit (429 with Retry-After).
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { getProject } from '@/server/dal/projects';
import { exportScheduleXml, stampMsProjectConnector } from '@/server/interchange/schedule-export';
import { TOO_MANY_REQUESTS, hitRateLimit, isSameOriginRequest, rateClient, tooManyRequestsResponse } from '@/server/http/request-guard';
import { getI18n, getViewer } from '@/server/session';
import { contentDisposition } from '@/server/storage/files';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }): Promise<Response> {
  const [{ code }, viewer, { t }] = await Promise.all([ctx.params, getViewer(), getI18n()]);
  const text = (status: number, msg: string) => new Response(t(msg), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!isSameOriginRequest(request)) return text(403, 'Invalid request');
  const project = await getProject(code);
  if (!project || !project.hasData) return text(404, 'Unknown project');
  if (viewer.role === 'client') return text(403, 'Outside your workspace');
  const limited = hitRateLimit('export', rateClient(request.headers, viewer.name));
  if (!limited.ok) return tooManyRequestsResponse('text', t(TOO_MANY_REQUESTS), limited.retryAfterSec);
  const now = new Date();
  const out = await exportScheduleXml(project.code, now);
  if (!out) return text(404, 'Unknown project');
  const volume = `${project.code} exported · ${out.baselineCode ?? 'no baseline'}`;
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const p = await requireProject(tx, project.code);
      const actor = await findPerson(tx, viewer.name);
      const who = actor ? nameOf(actor) : viewer.name;
      await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: project.code, change: `MS Project XML exported · ${out.activities} activities · ${out.baselineCode ?? 'no baseline'}`, area: 'Integrations', entityType: 'project', projectId: p.id });
      await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `MS Project · ${volume}`, kind: 'sync', projectId: p.id });
      await stampMsProjectConnector(tx, volume, now);
    });
  } catch (e) {
    console.error('[export] MS Project log failed:', e);
  }
  const body = new TextEncoder().encode(out.xml);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': contentDisposition(out.fileName, 'attachment'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
