// PLM Server Functions against an in-memory database: the outside-workspace gate, the New part validation (prototype
// AF `plm` fields, codes for the selects), duplicates, the created part (Not validated, revision A, viewer in the audit
// trail), and "Register equivalent" (both directions, candidates only). Session and screen access are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Antoine Girard', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getScreenAccess: async () => ({ viewer: { name: viewer.name }, outside: !viewer.canEdit, canEdit: viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getPart, getPartRecord } from '@/server/dal/parts';
import { createPartAction, registerEquivalentAction } from './actions';
import { parseNewPart } from './forms';

describe('PLM Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Antoine Girard';
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside the catalogue workspace, in their language', async () => {
    viewer.canEdit = false;
    expect(await createPartAction({ ref: 'X-1', name: 'x' })).toEqual({ error: 'The parts catalogue is read-only for you' });
    expect(await registerEquivalentAction('KS-STL-0450', { equivalent: 'KS-STL-0301' })).toEqual({ error: 'The parts catalogue is read-only for you' });
    viewer.lang = 'fr';
    expect(await createPartAction({ ref: 'X-1', name: 'x' })).toEqual({ error: 'Le catalogue articles est en consultation pour vous' });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getPart('X-1')).toBeNull();
  });

  it('"New part" validation (translated), forged payloads never thrown on', async () => {
    expect(await createPartAction({ ref: ' ', name: 'x' })).toEqual({ error: 'Reference is required' });
    expect(await createPartAction({ ref: 'A B', name: 'x' })).toEqual({ error: 'Invalid reference' });
    expect(await createPartAction({ ref: 'X-1', name: '' })).toEqual({ error: 'Designation is required' });
    expect(await createPartAction({ ref: 'X-1', name: 'x', family: 'Electrical' })).toEqual({ error: 'Unknown family' });
    expect(await createPartAction({ ref: 'X-1', name: 'x', unit: 'l' })).toEqual({ error: 'Unknown unit' });
    expect(await createPartAction({ ref: 'X-1', name: 'x', price: '-3' })).toEqual({ error: 'Invalid unit price' });
    expect(await createPartAction({ ref: 'X-1', name: 'x', price: 'abc' })).toEqual({ error: 'Invalid unit price' });
    expect(await createPartAction({ ref: 'el-vfd-200', name: 'dup' })).toEqual({ error: 'EL-VFD-200 already exists in the catalogue' });
    expect(await createPartAction({ ref: 42, name: ['x'] } as never)).toEqual({ error: 'Reference is required' });
    viewer.lang = 'fr';
    expect(await createPartAction({ ref: 'X-1', name: ' ' })).toEqual({ error: 'La désignation est obligatoire' });
    expect(await createPartAction({ ref: 'EL-VFD-200', name: 'dup' })).toEqual({ error: 'EL-VFD-200 existe déjà dans le catalogue' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"Create part": appended Not validated, revision A, the family\'s type, the viewer as the actor; toast', async () => {
    expect(await createPartAction({ ref: ' ks-brk-900 ', name: ' Brake bracket ', family: 'mechanical', supplier: 'Keystone Steelworks', price: '1250,5', unit: 'set' })).toEqual({
      toast: 'Part created in the catalogue',
    });
    const p = (await getPartRecord('KS-BRK-900'))!;
    expect(p).toMatchObject({
      ref: 'KS-BRK-900', name: 'Brake bracket', type: 'mechanical', status: 'not_validated', revision: 'A', listPriceEur: 1250.5, unit: 'set',
      manufacturer: 'Keystone Steelworks', makeBuy: 'manufactured', usage: [], statusNote: 'Qualification pending — cannot be released to purchasing.',
    });
    expect((await listAudit())[0]).toMatchObject({ who: 'Antoine Girard', object: 'KS-BRK-900', area: 'PLM' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    viewer.lang = 'fr';
    expect(await createPartAction({ ref: 'KS-BRK-901', name: 'Équerre', family: 'structure' })).toEqual({ toast: 'Article créé dans le catalogue' });
    expect(await getPart('KS-BRK-901')).toMatchObject({ type: 'structural', listPriceEur: 0, unit: 'pc', manufacturer: null, makeBuy: 'purchased' });
  });

  it('"Register equivalent": both directions, catalogue candidates only', async () => {
    expect(await registerEquivalentAction('KS-STL-0450', { equivalent: 'KS-STL-0450B' })).toEqual({ error: 'Choose a part of the catalogue' });
    expect(await registerEquivalentAction('KS-STL-0450', { equivalent: 'KS-STL-0450' })).toEqual({ error: 'Choose a part of the catalogue' });
    expect(await registerEquivalentAction('KS-STL-0450', { equivalent: 'NOPE' })).toEqual({ error: 'Choose a part of the catalogue' });
    expect(await registerEquivalentAction('NOPE', { equivalent: 'KS-STL-0301' })).toEqual({ error: 'Unknown part' });
    expect(await registerEquivalentAction('' as string, {})).toEqual({ error: 'Invalid request' });
    expect(revalidatePath).not.toHaveBeenCalled();
    viewer.name = 'Fabien Bertrand';
    expect(await registerEquivalentAction('CR-BRG-SKF', { equivalent: 'CR-BRG-SKF-X' })).toEqual({ error: 'Choose a part of the catalogue' });
    expect(await registerEquivalentAction('CR-WHL-630', { equivalent: 'CR-BRG-FAG' })).toEqual({ toast: 'Equivalent registered · CR-BRG-FAG' });
    expect((await getPart('CR-WHL-630'))!.equivalents).toEqual(['CR-BRG-FAG']);
    expect((await getPart('CR-BRG-FAG'))!.equivalents).toEqual(['CR-BRG-SKF', 'CR-WHL-630']);
    expect((await listAudit())[0]).toMatchObject({ who: 'Fabien Bertrand', object: 'CR-WHL-630', area: 'PLM' });
    viewer.lang = 'fr';
    expect(await registerEquivalentAction('CR-WHL-630', { equivalent: 'CR-BRG-FAG' })).toEqual({ error: 'Choisissez un article du catalogue' });
  });

  it('parseNewPart: defaults (first select options), trims, decimal comma', () => {
    expect(parseNewPart({ ref: 'a-1', name: 'n' })).toEqual({ ok: true, value: { ref: 'A-1', name: 'n', family: 'structure', supplier: null, priceEur: null, unit: 'pc' } });
    expect(parseNewPart({ ref: 'A-1', name: 'n', price: '0' })).toMatchObject({ ok: true, value: { priceEur: 0 } });
    expect(parseNewPart({ ref: 'X'.repeat(41), name: 'n' })).toEqual({ ok: false, error: 'Invalid reference' });
  });
});
