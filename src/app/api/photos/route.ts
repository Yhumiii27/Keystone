// Photos stored by Keystone (R-126, X-15 / SC-4a) — POST /api/photos, multipart fields `kind` (goods_receipt | daily_report |
// punch_item), `code` (project), `ref` (BL-…, DR-…, P-…), `register` (punch items: itp | site) and `file`. A Route Handler
// rather than a Server Function because Server Functions take at most 1 MB per request by default, below the 20 MB file
// limit. The viewer must be able to edit the screen that governs the record (src/features/photos/access.ts); size, type,
// content and the per-record count are checked before anything is written. Answers JSON { ok: true, id } or { ok: false,
// error } (translated). R-008: same-origin only, and at most RATE_LIMITS.upload uploads a minute per viewer (429).
import { revalidatePath } from 'next/cache';
import { MAX_FILE_BYTES, MAX_FILE_TEXT } from '@/domain/ch4-defaults';
import { MAX_PHOTOS_PER_OWNER, parsePhotoOwner } from '@/domain/photos';
import { photoGate } from '@/features/photos/access';
import { addPhoto } from '@/server/dal/photos';
import { TOO_MANY_REQUESTS, hitRateLimit, isSameOriginRequest, rateClient, tooManyRequestsResponse } from '@/server/http/request-guard';
import { logError } from '@/server/log';
import { getI18n } from '@/server/session';
import { FileRejectedError, checkUpload, readFormDataCapped, uploadRefusalStatus } from '@/server/storage/files';

export const dynamic = 'force-dynamic';

/** Multipart overhead allowed above the file limit (boundaries, part headers, the owner fields). */
const MULTIPART_SLACK = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const { t } = await getI18n();
  const fail = (status: number, english: string) =>
    Response.json({ ok: false, error: english.split(' · ').map(t).join(' · ') }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!isSameOriginRequest(request)) return fail(403, 'Invalid request');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_FILE_BYTES + MULTIPART_SLACK) return fail(413, `The file is larger than ${MAX_FILE_TEXT}`);
  let form: FormData | null;
  try {
    form = await readFormDataCapped(request, MAX_FILE_BYTES + MULTIPART_SLACK);
  } catch {
    return fail(400, 'Invalid request');
  }
  if (!form) return fail(413, `The file is larger than ${MAX_FILE_TEXT}`);
  const owner = parsePhotoOwner({ kind: form.get('kind'), code: form.get('code'), ref: form.get('ref'), register: form.get('register') });
  if (!owner) return fail(400, 'Invalid request');
  const g = await photoGate(owner, 'edit');
  if (!g.ok) return fail(g.status, g.error);
  const limited = hitRateLimit('upload', rateClient(request.headers, g.viewer));
  if (!limited.ok) return tooManyRequestsResponse('json', t(TOO_MANY_REQUESTS), limited.retryAfterSec);
  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'Choose a photo to add');
  try {
    checkUpload('photo', file.name, file.size);
    const id = await addPhoto(g.owner, file, g.viewer.name);
    revalidatePath(`/projects/${g.owner.code}`, 'layout');
    return Response.json({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // R-175: infected 422, antivirus unavailable 503 (fail-closed), generic messages.
    if (e instanceof FileRejectedError) return fail(uploadRefusalStatus(e), e.message);
    if (e instanceof Error && /^At most \d+ photos$/.test(e.message)) return fail(409, `Too many photos · max ${MAX_PHOTOS_PER_OWNER}`);
    logError('Photo upload', e, { route: 'api/photos' });
    return fail(500, 'The file could not be saved');
  }
}
