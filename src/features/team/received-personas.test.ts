// R-116 (Q-4 a): "Mark received" with its received date — the 8 personas against the real project context (who may edit the
// Interface register of HLT-026), the client sent home, and a stale row; nothing is written when refused.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: () => {
    throw new Error('REDIRECT');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listInterfaces } from '@/server/dal/interfaces';
import { getProjectContext } from '@/server/project-context';
import { markInterfaceReceivedAction } from './actions';

const ifc = async (n: string) => (await listInterfaces('HLT-026')).find((r) => r.number === n)!;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-116 — Mark received: personas', () => {
  it('editors of the register pass the gate (a future date is then refused), others are read-only, the client is sent home', async () => {
    const before = await ifc('IF-05');
    let editors = 0;
    for (const p of PERSONAS) {
      session.role = p.role;
      if (p.role === 'client') {
        await expect(markInterfaceReceivedAction('HLT-026', 'IF-05', { received: '28 Sep 2026' })).rejects.toThrow('REDIRECT');
        continue;
      }
      const canEdit = (await getProjectContext('HLT-026', 'interfaces')).canEdit('interfaces');
      const r = await markInterfaceReceivedAction('HLT-026', 'IF-05', { received: '1 Oct 2026' });
      if (canEdit) {
        editors++;
        expect(r, p.role).toEqual({ error: 'The received date cannot be after today' });
      } else expect(r, p.role).toEqual({ error: 'This interface register is read-only for you' });
    }
    expect(editors).toBeGreaterThanOrEqual(2); // the director and the PM at least
    expect(await ifc('IF-05')).toEqual(before);
  });

  it('the PM records it; a second click on the stale row is refused', async () => {
    session.role = 'pm';
    // R-013: a date on or before the business date (25 Sep 2026 on the demo data set; the prototype's today was 30 Sep).
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-05', { received: '24 Sep 2026' })).toEqual({ ok: true });
    expect(await ifc('IF-05')).toMatchObject({ status: 'received', providedOn: '2026-09-24' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-05', { received: '24 Sep 2026' })).toEqual({ error: 'This interface is no longer open' });
  });
});
