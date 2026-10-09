// File imports of Activity & integrations (chapter 4, S-9 and the Excel / CSV imports) — POST /api/import (multipart/form-data):
// `file` plus `kind` ('schedule' = MS Project XML or P6 XER detected from the file, or a table kind: budget_lines, bom, parts,
// assignments), `mode` ('new' | 'update'), `code` (target project), and the schedule options `matchOn`, `baselines`,
// `projectName`, `client`, `pm`. The file is checked (size, type, content) and stored by Keystone, the job recorded and the
// file parsed: the answer is the next step (column mapping or preview) as JSON — nothing reaches the business tables before the
// explicit confirmation (Server Function applyImportAction). A Route Handler rather than a Server Function: files up to 20 MB
// (Server Function bodies are capped at 1 MB). The viewer is the "View as" persona; rights are checked in startImport.
// D-7b: refused (403) while IMPORTS_ENABLED is off in src/domain/ch4-defaults.ts — the import cards are hidden then.
import { IMPORTS_ENABLED, IMPORTS_OFF_MESSAGE, MAX_FILE_BYTES } from '@/domain/ch4-defaults';
import { startImport } from '@/server/interchange/jobs';
import { isTableKind } from '@/server/interchange/table';
import { FileRejectedError, checkUpload, readFormDataCapped } from '@/server/storage/files';
import { getViewer } from '@/server/session';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  // Same-origin only (the persona cookie is the credential; Server Functions get this check from Next.js).
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  let crossSite = request.headers.get('sec-fetch-site') === 'cross-site';
  try {
    if (origin === 'null' || (origin && new URL(origin).host !== host)) crossSite = true;
  } catch {
    crossSite = true;
  }
  if (crossSite) return json({ ok: false, error: 'Invalid request' }, 403);
  if (!IMPORTS_ENABLED) return json({ ok: false, error: IMPORTS_OFF_MESSAGE }, 403);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_FILE_BYTES + 512 * 1024) return json({ ok: false, error: 'The file is larger than 20 MB' }, 413);
  let form: FormData;
  try {
    // Read with a byte cap: a chunked body has no Content-Length and would otherwise be buffered whole.
    const capped = await readFormDataCapped(request, MAX_FILE_BYTES + 512 * 1024);
    if (!capped) return json({ ok: false, error: 'The file is larger than 20 MB' }, 413);
    form = capped;
  } catch {
    return json({ ok: false, error: 'Invalid request' }, 400);
  }
  const file = form.get('file');
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;
  };
  const kind = text('kind');
  const mode = text('mode') === 'new' ? 'new' : 'update';
  if (!(file instanceof File) || !kind || (kind !== 'schedule' && !isTableKind(kind))) return json({ ok: false, error: 'Invalid request' }, 400);
  try {
    checkUpload('import', file.name, file.size);
  } catch (e) {
    return json({ ok: false, error: e instanceof FileRejectedError ? e.message : 'Invalid request' }, 400);
  }
  const viewer = await getViewer();
  const step = await startImport(
    {
      kind, mode, projectCode: text('code'), fileName: file.name, data: new Uint8Array(await file.arrayBuffer()), matchOn: text('matchOn') === 'activity_id' ? 'activity_id' : text('matchOn') === 'uid' ? 'uid' : undefined,
      importBaselines: text('baselines') === '0' ? false : text('baselines') === '1' ? true : undefined, projectName: text('projectName'), client: text('client'), pmName: text('pm'),
    },
    { name: viewer.name, short: viewer.short, role: viewer.role },
  );
  return json(step);
}
