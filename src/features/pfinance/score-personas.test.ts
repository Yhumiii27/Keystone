// "Score a proposal" with the 5 ranking axes (Delivery 8, L-5a = a, R-134) for every persona, against an in-memory
// database: the director and the project manager score (the screen is in their workspace), every other persona is outside
// it and refused before anything is read or written; a project that left the pipeline is refused (stale form).
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { canSee } = await import('@/config/screens');
  return {
    getScreenAccess: async (screen: string) => ({ viewer: { role: viewer.role, name: viewer.name }, outside: !canSee(viewer.role as never, screen as never) }),
  };
});

import { revalidatePath } from 'next/cache';
import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { recordStageChange } from '@/server/dal/lifecycle';
import { listAudit } from '@/server/dal/notifications';
import { listPortfolioScores } from '@/server/dal/prioritisation';
import { scoreProposalAction } from './actions';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Score a proposal — 5 axes (L-5a), every persona', () => {
  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s', async (role, p) => {
    Object.assign(viewer, { role: p.role, name: p.name });
    vi.mocked(revalidatePath).mockClear();
    const audit = (await listAudit({ projectCode: 'CER-047' })).length;
    const r = await scoreProposalAction({ project: 'CER-047', fit: '4', fin: '3', risk: '4', res: '2', client: '5', comment: role });
    if (role === 'director' || role === 'pm') {
      expect(r).toEqual({ toast: 'Score saved' });
      expect((await listPortfolioScores())['CER-047'].slice(3)).toEqual([2, 5]);
      expect((await listAudit({ projectCode: 'CER-047' }))[0]).toMatchObject({ who: p.name, change: 'score: fit 4 · margin 3 · risk 4 · resources 2 · client 5' });
      expect(revalidatePath).toHaveBeenCalledWith('/portfolio/prioritisation');
    } else {
      expect(r).toEqual({ error: 'Outside my workspace · Read-only' });
      expect((await listAudit({ projectCode: 'CER-047' })).length).toBe(audit);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it('malformed values for the new axes are refused; a project that left the pipeline (stale form) too', async () => {
    Object.assign(viewer, { role: 'director', name: 'Marie Lefebvre' });
    for (const bad of [{ res: 'x' }, { res: '' }, { client: '3.5' }, { client: '-1' }, { res: ['3'] as never }, { client: null as never }])
      expect(await scoreProposalAction({ project: 'CER-047', fit: '3', fin: '3', risk: '3', res: '3', client: '3', ...bad }), JSON.stringify(bad)).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    // CER-047 moves to execution (Études): it is no longer a proposal the form offers.
    await recordStageChange('CER-047', 'etudes', 'forced');
    expect(await scoreProposalAction({ project: 'CER-047', fit: '3', fin: '3', risk: '3', res: '3', client: '3' })).toEqual({ error: 'Choose a project in the pipeline' });
  });
});
