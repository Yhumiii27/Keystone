// Task attachments (chapter 4, R-8) — POST /api/tasks/<T-nnnn>/files, multipart field `file`: Keystone stores the file
// (src/server/storage, not Codex) and attaches it to the task. A Route Handler rather than a Server Function because Server
// Functions take at most 1 MB per request by default, below the 20 MB file limit. The viewer must be the assignee or the
// portfolio director inside the workspace (src/features/mywork/permissions.ts); the size, type, content and per-task
// count are checked before anything is written. Answers JSON { ok: true, id } or { ok: false, error } (translated).
// R-008: same-origin only, and at most RATE_LIMITS.upload uploads a minute per viewer (429 with Retry-After).
import { revalidatePath } from 'next/cache';
import { MAX_ATTACHMENTS_PER_TASK, MAX_FILE_BYTES, MAX_FILE_TEXT } from '@/domain/ch4-defaults';
import { taskFileGate } from '@/features/mywork/task-access';
import { attachTaskFile, listTaskFiles } from '@/server/dal/task-files';
import { TOO_MANY_REQUESTS, hitRateLimit, isSameOriginRequest, rateClient, tooManyRequestsResponse } from '@/server/http/request-guard';
import { getI18n } from '@/server/session';
import { FileRejectedError, checkUpload, readFormDataCapped } from '@/server/storage/files';
import { logError } from '@/server/log';

export const dynamic = 'force-dynamic';

/** Multipart overhead allowed above the file limit (boundaries, part headers). */
const MULTIPART_SLACK = 256 * 1024;

export async function POST(request: Request, ctx: { params: Promise<{ taskId: string }> }): Promise<Response> {
  const [{ taskId }, { t }] = await Promise.all([ctx.params, getI18n()]);
  const fail = (status: number, english: string) =>
    Response.json({ ok: false, error: english.split(' · ').map(t).join(' · ') }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!isSameOriginRequest(request)) return fail(403, 'Invalid request');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_FILE_BYTES + MULTIPART_SLACK) return fail(413, `The file is larger than ${MAX_FILE_TEXT}`);
  const g = await taskFileGate(taskId, 'edit');
  if (!g.ok) return fail(g.status, g.error);
  const limited = hitRateLimit('upload', rateClient(request.headers, g.viewer));
  if (!limited.ok) return tooManyRequestsResponse('json', t(TOO_MANY_REQUESTS), limited.retryAfterSec);
  let file: FormDataEntryValue | null;
  try {
    // Read with a byte cap: a chunked body has no Content-Length and would otherwise be buffered whole.
    const form = await readFormDataCapped(request, MAX_FILE_BYTES + MULTIPART_SLACK);
    if (!form) return fail(413, `The file is larger than ${MAX_FILE_TEXT}`);
    file = form.get('file');
  } catch {
    return fail(400, 'Invalid request');
  }
  if (!(file instanceof File)) return fail(400, 'Choose a file to attach');
  try {
    checkUpload('attachment', file.name, file.size);
    if ((await listTaskFiles(g.task.id)).length >= MAX_ATTACHMENTS_PER_TASK) return fail(409, `Too many files on this task · max ${MAX_ATTACHMENTS_PER_TASK}`);
    const id = await attachTaskFile(g.task.id, file, g.viewer.name);
    revalidatePath('/', 'layout');
    return Response.json({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof FileRejectedError) return fail(e.code === 'too_large' ? 413 : 415, e.message);
    logError('Task file upload', e, { route: 'api/tasks/files' });
    return fail(500, 'The file could not be saved');
  }
}
