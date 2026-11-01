// Documents Server Functions changed by Delivery 8 (R-033, R-127; D-2 = a, A-15 = a), for every persona, against an in-memory
// database: downloads give the Codex hand-off (a link to the record for the internal team, none for the client; nothing
// written), "Sync now" stays the director's, and with Codex connected the deposit hand-off is refused with an "Open Codex"
// link. Malformed input and unknown records are refused. Session and project context are mocked as in actions.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', short: 'M. Lefebvre', role: 'director', isMine: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { listProjects } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: { code },
      viewer: { name: viewer.name, short: viewer.short, role: viewer.role, organisation: viewer.role === 'client' ? 'Port authority' : null },
      canEdit: () => true,
      outside: false,
      isMine: viewer.isMine,
      access: { member: viewer.isMine },
    }),
    clientProjectCodes: async () => new Set((await listProjects()).filter((p) => p.client === 'Port authority').map((p) => p.code)),
  };
});

import { revalidatePath } from 'next/cache';
import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getDocumentRecord, listVaultDocuments } from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { depositInCodexAction, logDownloadAction, syncCodexAction } from './actions';
import { DOWNLOAD_IN_CODEX } from './i18n';

const as = (p: (typeof PERSONAS)[number], isMine = true) => Object.assign(viewer, { name: p.name, short: p.short, role: p.role, isMine });

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => vi.mocked(revalidatePath).mockClear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('downloads: the Codex hand-off (D-2 = a, R-127)', () => {
  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s', async (_role, p) => {
    as(p);
    const audit = (await listAudit({ projectCode: 'HLT-026' })).length;
    const shared = await logDownloadAction('HLT-026', 'PID-HLT-026', 'PDF');
    const internal = await logDownloadAction('HLT-026', 'LST-INS-026', 'Native');
    if (p.role === 'client') {
      // P-10a / P-10b: the shared record of their own project only, and no Codex link (no Codex access).
      expect(shared).toEqual({ ok: true, toast: DOWNLOAD_IN_CODEX, link: null });
      expect(internal).toEqual({ error: 'Unknown document' });
    } else {
      expect(shared).toEqual({ ok: true, toast: DOWNLOAD_IN_CODEX, link: { href: 'http://localhost:3100/?document=PID-HLT-026&revision=D', label: 'Open Codex' } });
      expect(internal).toMatchObject({ ok: true, link: { href: expect.stringContaining('document=LST-INS-026'), label: 'Open Codex' } });
    }
    // Nothing is written: no download log, no audit row, no revalidation.
    expect((await listAudit({ projectCode: 'HLT-026' })).length).toBe(audit);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('malformed input and unknown records are refused', async () => {
    as(PERSONAS[0]);
    expect(await logDownloadAction(42 as never, 'PID-HLT-026')).toEqual({ error: 'Invalid request' });
    expect(await logDownloadAction('', 'PID-HLT-026')).toEqual({ error: 'Invalid request' });
    expect(await logDownloadAction('NOPE-000', 'PID-HLT-026')).toEqual({ error: 'Unknown project' });
    expect(await logDownloadAction('HLT-026', 'PID-HLT-026', 'zip' as never)).toEqual({ error: 'Invalid request' });
    expect(await logDownloadAction('HLT-026', null as never)).toEqual({ error: 'Unknown document' });
    expect(await logDownloadAction('HLT-026', 'PID-HLT-999')).toEqual({ error: 'Unknown document' });
  });
});

describe('"Sync now" with Codex connected (R-033): the director only; the toast says what really happened', () => {
  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s', async (_role, p) => {
    as(p);
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', fetch);
    const r = await syncCodexAction('HLT-026');
    if (p.role === 'director') {
      // L9-X3: the demo's three shipping-document deposits are delivered by the first sync.
      expect(r).toEqual({ ok: true, toast: expect.stringMatching(/^Codex sync · index up to date · \d+ records · [03] sent · 0 pending · 0 refreshed$/) });
      expect(fetch).toHaveBeenCalled();
    } else {
      expect(r).toEqual({ error: 'Only the portfolio director synchronises the Codex index' });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('Codex unreachable: refused toast, never "index up to date"', async () => {
    as(PERSONAS[0]);
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    expect(await syncCodexAction('HLT-026')).toEqual({ error: 'Codex sync · index not read · 0 sent · 0 pending · 0 refreshed' });
    expect(await syncCodexAction(undefined as never)).toEqual({ error: 'Invalid request' });
  });
});

describe('deposit hand-off with Codex connected (A-15, R-033): refused with an "Open Codex" link, nothing created', () => {
  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s', async (_role, p) => {
    as(p);
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const before = (await listVaultDocuments()).length;
    const r = await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: 'Mill certificate' });
    const rev = await depositInCodexAction({ project: 'HLT-026', revisionOf: 'GA-HLT-026' });
    if (p.role === 'client') {
      // NEW-D3-1 (R-047): deposits are the internal team's — refused before the connector rule.
      expect([r, rev]).toEqual([{ error: 'Only the project’s internal team deposits documents in Codex' }, { error: 'Only the project’s internal team deposits documents in Codex' }]);
    } else {
      expect(r).toEqual({ error: 'Codex is connected — deposit the document in Codex', link: { href: 'http://localhost:3100/?project=HLT-026', label: 'Open Codex' } });
      expect(rev).toEqual({ error: 'Codex is connected — deposit the document in Codex', link: { href: 'http://localhost:3100/?document=GA-HLT-026', label: 'Open Codex' } });
    }
    expect((await listVaultDocuments()).length).toBe(before);
    expect((await getDocumentRecord('GA-HLT-026'))!.status).not.toBe('draft');
  });

  it('malformed deposits are refused before the connector rule; without CODEX_API_URL the mock hand-off is unchanged', async () => {
    as(PERSONAS[0]);
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    expect(await depositInCodexAction(null)).toMatchObject({ error: expect.any(String) });
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'NOPE', title: 'x' })).toMatchObject({ error: expect.any(String) });
    vi.unstubAllEnvs();
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: 'Mill certificate' })).toMatchObject({ ok: true, created: true });
  });
});
