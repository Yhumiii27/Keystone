// Download of a meeting's uploaded transcript file (chapter 4, S-10: the .txt / .vtt / .srt is stored by Keystone) —
// GET /api/meetings/<MTG-nnn>/transcript. Access as the project's Meetings screen (src/features/meetings/transcript-file.ts);
// a pasted transcript, an unknown meeting or a missing file → 404.
import { transcriptFileGate } from '@/features/meetings/transcript-file';
import { getI18n } from '@/server/session';
import { fileResponse, streamStoredFile } from '@/server/storage/files';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ number: string }> }): Promise<Response> {
  const [{ number }, { t }] = await Promise.all([ctx.params, getI18n()]);
  const text = (status: number, english: string) => new Response(t(english), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  const g = await transcriptFileGate(number);
  if (!g.ok) return text(g.status, g.error);
  const f = await streamStoredFile(g.fileId);
  if (!f) return text(404, 'File not found');
  return fileResponse(f.meta, f.stream);
}
