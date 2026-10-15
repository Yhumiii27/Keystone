// A photo stored by Keystone (R-126) — GET /api/photos/<file id>: shown inline (thumbnails and the full image), or as a
// download with `?download=1`. Whoever may see the record's screen may see its photos (src/features/photos/access.ts: the
// client only the ITP punch list's of their own project). Unknown id, not a photo, or missing on disk → 404; a photo the
// antivirus flagged (R-175) → 410.
import { photoGate } from '@/features/photos/access';
import { photoOwnerOf, readPhoto } from '@/server/dal/photos';
import { getI18n } from '@/server/session';
import { fileResponse } from '@/server/storage/files';
import { SCAN_MESSAGES } from '@/server/storage/scan';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, { t }] = await Promise.all([ctx.params, getI18n()]);
  const text = (status: number, english: string) => new Response(t(english), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  const fileId = decodeURIComponent(id);
  const owner = await photoOwnerOf(fileId);
  if (!owner) return text(404, 'File not found');
  const g = await photoGate(owner, 'view');
  if (!g.ok) return text(g.status, g.error);
  const f = await readPhoto(fileId);
  if (!f) return text(404, 'File not found');
  if (f.blocked) return text(410, SCAN_MESSAGES.blocked);
  const download = new URL(request.url).searchParams.get('download') === '1';
  return fileResponse(f.meta, new Uint8Array(f.data), { inline: !download });
}
