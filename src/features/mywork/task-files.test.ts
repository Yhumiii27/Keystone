// Chapter 4 (R-8) — task attachments stored by Keystone: the upload / download Route Handlers (rights, size / type /
// content / count limits, CSRF guard), the remove Server Function and the task sheet's Files card. In-memory seeded
// database, files in a temporary folder, mocked session and screen access.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/my/tasks/T-2314',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }), getViewer: async () => PERSONA_BY_ROLE[state.role] };
});
vi.mock('@/server/project-context', async (orig) => {
  const actual = await orig<typeof import('@/server/project-context')>();
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    ...actual,
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});
vi.mock('@/components/app/shell/page-header', async () => {
  const { createElement } = await import('react');
  return { PageHeader: ({ primary }: { primary?: unknown }) => createElement('header', null, primary as never) };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskPage from '@/app/(app)/my/tasks/[taskId]/page';
import { GET } from '@/app/api/tasks/[taskId]/files/[fileId]/route';
import { POST } from '@/app/api/tasks/[taskId]/files/route';
import { MAX_ATTACHMENTS_PER_TASK } from '@/domain/ch4-defaults';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { listTaskFiles } from '@/server/dal/task-files';
import { listTasks } from '@/server/dal/tasks';
import { setFilesRoot } from '@/server/storage/files';
import { removeTaskFileAction } from './actions';

let dir: string;
const PDF = new TextEncoder().encode('%PDF-1.4 torque report');

function upload(taskId: string, file: File | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  if (file) body.set('file', file);
  const req = new Request(`http://127.0.0.1:3310/api/tasks/${taskId}/files`, { method: 'POST', body, headers: { host: '127.0.0.1:3310', ...headers } });
  return POST(req, { params: Promise.resolve({ taskId }) });
}
const download = (taskId: string, fileId: string) => GET(new Request(`http://127.0.0.1:3310/api/tasks/${taskId}/files/${fileId}`), { params: Promise.resolve({ taskId, fileId }) });
const pdf = (name = 'Torque report.pdf') => new File([PDF], name, { type: 'application/pdf' });
const page = async (id: string) => renderToStaticMarkup(h(I18nProvider, { lang: state.lang, children: (await TaskPage({ params: Promise.resolve({ taskId: id }) })) as never }));

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-ch4-misc-'));
  setFilesRoot(dir);
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  state.role = 'director';
  state.lang = 'en';
});

describe('task attachments (R-8)', () => {
  it('the director attaches a PDF: stored, listed, audited, downloadable', async () => {
    const res = await upload('T-2314', pdf());
    expect(res.status).toBe(200);
    const { ok, id } = (await res.json()) as { ok: boolean; id: string };
    expect(ok).toBe(true);
    const files = await listTaskFiles('T-2314');
    expect(files.at(-1)).toMatchObject({ id, name: 'Torque report.pdf', kind: 'pdf', uploadedBy: 'M. Lefebvre', hasFile: true });
    const [audit] = await listAudit({ limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Marie Lefebvre', 'T-2314', 'file attached: Torque report.pdf']);
    const got = await download('T-2314', id);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(got.headers.get('content-disposition')).toBe(`attachment; filename="Torque report.pdf"; filename*=UTF-8''Torque%20report.pdf`);
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe('%PDF-1.4 torque report');
    // The task sheet: the stored file downloads, the seed's files (no content) have no link.
    const html = await page('T-2314');
    expect(html).toContain(`href="/api/tasks/T-2314/files/${id}"`);
    expect(html).toContain('aria-label="Remove Torque report.pdf"');
    expect(html).toContain('verticality-survey-bay3.xlsx');
    expect(html).not.toContain('Attach — coming soon');
    expect(html).toMatch(/accept="\.pdf,\.png,[^"]*"/);
  });

  it('refuses wrong types, mismatched content, oversize, empty requests and cross-site posts (translated)', async () => {
    let r = await upload('T-2314', new File([PDF], 'virus.exe'));
    expect([r.status, await r.json()]).toEqual([415, { ok: false, error: 'File type not accepted' }]);
    r = await upload('T-2314', new File(['not a pdf'], 'fake.pdf'));
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([415, 'The file content does not match its extension']);
    r = await upload('T-2314', pdf(), { 'content-length': String(30 * 1024 * 1024) });
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([413, 'The file is larger than 20 MB']);
    r = await upload('T-2314', null);
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([400, 'Choose a file to attach']);
    r = await upload('T-2314', pdf(), { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    r = await upload('T-2314', pdf(), { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
    state.lang = 'fr';
    r = await upload('T-2314', new File([PDF], 'virus.exe'));
    expect(((await r.json()) as { error: string }).error).not.toBe('File type not accepted');
    expect((await listTaskFiles('T-2314')).filter((f) => f.hasFile)).toHaveLength(1);
  });

  it('rights: the assignee or the director; outside roles and other members are refused; unknown task → 404', async () => {
    state.role = 'member'; // Julien Wagner
    let r = await upload('T-2314', pdf());
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([403, 'Read-only — only the assignee or the portfolio director can update this task']);
    r = await upload('T-2305', pdf('Bolt torque.pdf')); // their own task
    expect(r.status).toBe(200);
    state.role = 'quality';
    r = await upload('T-2305', pdf());
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([403, 'Read-only — outside my workspace']);
    r = await upload('T-99999', pdf());
    expect(r.status).toBe(404);
  });

  it('downloads: everyone who opens the sheet, a client only on their own organisation’s projects; seed files have no content', async () => {
    const stored = (await listTaskFiles('T-2314')).find((f) => f.hasFile)!;
    const seed = (await listTaskFiles('T-2314')).find((f) => !f.hasFile)!;
    state.role = 'quality';
    expect((await download('T-2314', stored.id)).status).toBe(200);
    state.role = 'client';
    expect((await download('T-2314', stored.id)).status).toBe(200); // Harbor Line is the client's project
    const other = (await listTasks()).find((t) => !['HLT-026', 'PRS-038', 'QFR-015'].includes(t.project.code))!;
    expect(other).toBeDefined();
    state.role = 'director';
    const res = await upload(other.id, pdf('Other.pdf'));
    const { id } = (await res.json()) as { id: string };
    state.role = 'client';
    const r = await download(other.id, id);
    expect([r.status, await r.text()]).toEqual([403, 'You cannot open this file']);
    state.role = 'director';
    expect((await download('T-2314', seed.id)).status).toBe(404);
    expect((await download('T-2314', 'not-an-id')).status).toBe(404);
    expect((await download('T-2318', stored.id)).status).toBe(404); // another task's attachment
  });

  it('remove: confirmation-side Server Function, rights checked, file gone', async () => {
    const stored = (await listTaskFiles('T-2314')).find((f) => f.hasFile)!;
    state.role = 'member';
    expect(await removeTaskFileAction({ taskId: 'T-2314', attachmentId: stored.id })).toEqual({
      ok: false, error: 'Read-only — only the assignee or the portfolio director can update this task',
    });
    state.role = 'director';
    expect(await removeTaskFileAction({ taskId: 'T-2314', attachmentId: 'x' })).toEqual({ ok: false, error: 'This file is no longer attached' });
    expect(await removeTaskFileAction({ taskId: 'T-2314', attachmentId: stored.id })).toEqual({ ok: true });
    expect((await listTaskFiles('T-2314')).some((f) => f.id === stored.id)).toBe(false);
    expect((await download('T-2314', stored.id)).status).toBe(404);
    expect(await removeTaskFileAction({ taskId: 'T-2314', attachmentId: stored.id })).toEqual({ ok: false, error: 'This file is no longer attached' });
  });

  it(`at most ${MAX_ATTACHMENTS_PER_TASK} files on a task`, async () => {
    const already = (await listTaskFiles('T-2318')).length;
    for (let i = already; i < MAX_ATTACHMENTS_PER_TASK; i++) expect((await upload('T-2318', new File([`line ${i}`], `note-${i}.txt`))).status).toBe(200);
    const r = await upload('T-2318', new File(['one more'], 'extra.txt'));
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([409, `Too many files on this task · max ${MAX_ATTACHMENTS_PER_TASK}`]);
    const html = await page('T-2318');
    const attach = /<button[^>]*title="Too many files on this task · max \d+"[^>]*>/.exec(html)?.[0] ?? '';
    expect(attach).toContain('disabled=""');
  });
});
