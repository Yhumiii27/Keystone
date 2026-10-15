// Download of a task attachment stored by Keystone (chapter 4, R-8) — GET /api/tasks/<T-nnnn>/files/<attachment id>.
// Whoever may open the task sheet may download its files, except a client contact on another organisation's project
// (src/features/mywork/permissions.ts). Unknown task / attachment, or a seed file without content → 404; a file the antivirus
// flagged (R-175) → 410.
import { taskFileGate } from '@/features/mywork/task-access';
import { getTaskFile } from '@/server/dal/task-files';
import { getI18n } from '@/server/session';
import { fileResponse } from '@/server/storage/files';
import { SCAN_MESSAGES } from '@/server/storage/scan';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ taskId: string; fileId: string }> }): Promise<Response> {
  const [{ taskId, fileId }, { t }] = await Promise.all([ctx.params, getI18n()]);
  const text = (status: number, english: string) => new Response(t(english), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  const g = await taskFileGate(taskId, 'view');
  if (!g.ok) return text(g.status, g.error);
  const f = await getTaskFile(g.task.id, decodeURIComponent(fileId));
  if (!f) return text(404, 'File not found');
  if (f.blocked) return text(410, SCAN_MESSAGES.blocked);
  return fileResponse(f.meta, new Uint8Array(f.data));
}
