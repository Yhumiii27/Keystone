// R-023 (V-3a "a"): once Vigie's API is connected, an NCR carries Vigie's own number ("EV-2026-130"), not Keystone's
// demo numbering ("EV-2026-029"). The NCR Server Functions accept both and still refuse anything else before the DAL. The
// session is mocked (the viewer is the "View as" persona), as in actions.test.ts.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'quality' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getNcr } from '@/server/dal/quality';
import { prototypeNcrSnapshot, type ProtoNcrRow } from '@/server/integrations/vigie/prototype-snapshot';
import { upsertNcrMirror } from '@/server/integrations/vigie/quality-mirror';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { advanceNcrAction, verifyNcrAction } from './actions';

const HLT = 'HLT-026';
const INVALID = { ok: false, error: 'Invalid request' };

describe('NCR references (R-023, V-3a)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
    // Vigie reports an NCR under its own number (a refresh of the mirror, no prune).
    const base = prototypeNcrSnapshot(PROTO.HLT_NCRS as ProtoNcrRow[], Object.keys(PROTO_GEN.projectData)).find((r) => r.projectCode === HLT && r.number === 'EV-2026-030')!;
    const db = await getDb();
    await db.transaction((tx) => upsertNcrMirror(tx, [{ ...base, number: 'EV-2026-130', vigieRef: 'EV-2026-130', status: 'containment' }], new Date()));
  }, 60_000);

  it('Vigie’s number reaches the NCR rules for every persona (only the usual gates refuse it)', async () => {
    for (const p of PERSONAS) {
      session.role = p.role;
      const r = await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-130', step: 'root_cause' });
      expect(r, p.role).not.toEqual(INVALID);
      const v = await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-130', decision: 'approved' });
      expect(v, p.role).not.toEqual(INVALID);
    }
    session.role = 'quality';
    expect((await getNcr(HLT, 'EV-2026-130'))!.requestedStatus).toBe('root_cause'); // D13: Containment is decided in Vigie
  });

  it('the demo numbers (Vigie’s, D13 CV-07) and a former NCR-nnn pass the format; anything else is refused before the data layer', async () => {
    session.role = 'quality';
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-028', step: 'root_cause' })).toMatchObject({ ok: true });
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-099', step: 'root_cause' })).toEqual({ ok: false, error: 'Unknown NCR' });
    for (const number of ['NCR 029', '../EV-2026-029', 'EV-2026-029/x', 'EV-2026-029?', '', 'EV', 'EV-', '-2026-130', 'EV-2026-130-1-2-3', 'A'.repeat(61), "EV-2026-029'; --", 42])
      expect(await advanceNcrAction({ projectCode: HLT, number: number as string, step: 'root_cause' }), String(number)).toEqual(INVALID);
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV 2026 130', decision: 'approved' })).toEqual(INVALID);
  });
});
