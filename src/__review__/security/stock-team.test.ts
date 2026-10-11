import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'quality' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: 'en', t: makeT('en') }),
    getViewer: async () => PERSONA_BY_ROLE[state.role],
    getLang: async () => 'en',
  };
});

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listStock } from '@/server/dal/stock';
import { getActivities } from '@/server/dal/planning';
import { applyStockMovementAction } from '@/features/stock/actions';
import { getProjectContext } from '@/server/project-context';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-041 stock writes on a project the viewer is not on', () => {
  it('quality issues stock to NDC-031', async () => {
    const ctx = await getProjectContext('NDC-031', 'plan');
    console.log('quality on NDC-031: readOnly', ctx.readOnly, 'member', ctx.isMine);
    const acts = await getActivities('NDC-031');
    const act = acts.find((a) => /^[A-Za-z0-9]/.test(a.id))!;
    const line = (await listStock()).find((r) => r.available >= 1)!;
    console.log('line', line.ref, line.available, 'act', act?.id);
    const r = await applyStockMovementAction(line.id, { op: 'issue', qty: '1', activity: act.id }, 'NDC-031');
    console.log('ISSUE result', JSON.stringify(r));
    const r2 = await applyStockMovementAction(line.id, { op: 'reserve', qty: '1' }, 'NDC-031');
    console.log('RESERVE result', JSON.stringify(r2));
    expect(r).toBeTruthy();
  }, 60_000);
});
