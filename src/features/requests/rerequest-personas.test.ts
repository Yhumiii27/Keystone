// R-090 (P-8c a): re-requesting a withdrawn resource request — the 8 personas (only its sender), malformed ids and stale states.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'pm' as string };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: 'en', t: makeT('en') }),
    getLastProject: async () => 'HLT-026',
  };
});

import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getResourceRequest, withdrawResourceRequest } from '@/server/dal/requests';
import { reRequestAction } from './actions';

beforeAll(async () => {
  setDb(await openDatabase());
  await withdrawResourceRequest('RQ-044', 'Romain Aubert');
}, 60_000);

describe('R-090 — re-request a withdrawn request: personas', () => {
  it('only the sender (R. Aubert) re-sends it; everyone else is refused and nothing changes', async () => {
    for (const p of PERSONAS.filter((x) => x.role !== 'pm')) {
      session.role = p.role;
      expect(await reRequestAction('RQ-044'), p.role).toEqual({ ok: false, error: 'Read-only — only the sender can change this request' });
    }
    expect((await getResourceRequest('RQ-044'))!.status).toBe('withdrawn');
    session.role = 'pm';
    expect(await reRequestAction('RQ-044')).toEqual({ ok: true });
    expect((await getResourceRequest('RQ-044'))!.events.map((e) => e.action).slice(-2)).toEqual(['withdrawn', 'resent']);
  });

  it('malformed ids, unknown requests and other statuses are refused', async () => {
    session.role = 'pm';
    for (const id of ['', 'RQ-', 'DROP TABLE', 42]) expect(await reRequestAction(id as string)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await reRequestAction('RQ-999')).toEqual({ ok: false, error: 'Unknown request' });
    // Pending (just re-sent), reschedule (RQ-038), approved (RQ-040): stale.
    for (const id of ['RQ-044', 'RQ-038', 'RQ-040']) expect(await reRequestAction(id)).toEqual({ ok: false, error: 'This request has already been decided' });
  });
});
