// Project BOM Server Function against an in-memory database: permission gate (outside / read-only viewers refused
// server-side), the "Add article" parsing (catalogue reference, duplicate, quantity, activity, scope), the write with
// the viewer as the actor, the toast, and the form definition built from the prototype's AF.bom. Session and project
// context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: (screen: string) => screen === 'bom' && viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getProjectBom, listBomActivityOptions } from '@/server/dal/bom';
import { listAudit } from '@/server/dal/notifications';
import golden from './bom.golden.json';
import { addBomArticleAction } from './actions';
import { bomFormDef, localizeBomForm } from './forms';

const line = async (code: string, ref: string) => (await getProjectBom(code))!.lines.find((l) => l.ref === ref);

describe('addBomArticleAction', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Romain Aubert';
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers who may not edit the BOM, unknown projects and malformed requests', async () => {
    viewer.canEdit = false;
    expect(await addBomArticleAction('HLT-026', { ref: 'CR-BRG-FAG' })).toEqual({ error: 'This project BOM is read-only for you' });
    viewer.lang = 'fr';
    expect(await addBomArticleAction('HLT-026', { ref: 'CR-BRG-FAG' })).toEqual({ error: 'Cette nomenclature projet est en consultation pour vous' });
    viewer.canEdit = true;
    expect(await addBomArticleAction('NOPE-000', { ref: 'CR-BRG-FAG' })).toEqual({ error: 'Projet inconnu' });
    viewer.lang = 'en';
    expect(await addBomArticleAction(42, { ref: 'CR-BRG-FAG' })).toEqual({ error: 'Invalid request' });
    expect(await addBomArticleAction('HLT-026', null)).toEqual({ error: 'The article reference is required' });
    expect(await addBomArticleAction('HLT-026', { ref: ['CR-BRG-FAG'] })).toEqual({ error: 'The article reference is required' });
    expect(await line('HLT-026', 'CR-BRG-FAG')).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('validates the form: catalogue reference, not yet in the BOM, quantity, activity, scope', async () => {
    const err = async (v: Record<string, string>) => ((await addBomArticleAction('HLT-026', v)) as { error: string }).error;
    expect(await err({ ref: 'NOPE-1' })).toBe('Unknown article reference');
    expect(await err({ ref: 'el-vfd-200' })).toBe('This article is already in the project BOM');
    expect(await err({ ref: 'CR-BRG-FAG', qty: '0' })).toBe('Invalid quantity');
    expect(await err({ ref: 'CR-BRG-FAG', qty: '1', act: 'A9999' })).toBe('Unknown activity');
    expect(await err({ ref: 'CR-BRG-FAG', qty: '1', scope: 'Overlay' })).toBe('Invalid scope');
    viewer.lang = 'fr';
    expect(await err({ ref: 'NOPE-1' })).toBe('Référence article inconnue');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('adds the article with the viewer as the actor; toast "Article added to the project BOM"', async () => {
    const acts = await listBomActivityOptions('HLT-026');
    expect(await addBomArticleAction('HLT-026', { ref: ' cr-brg-fag ', qty: '2,5', act: acts[1].code, scope: 'overlay', note: 'Spare drive' })).toEqual({ toast: 'Article added to the project BOM' });
    const l = (await line('HLT-026', 'CR-BRG-FAG'))!;
    expect([l.quantity, l.activityCode, l.scope, l.note]).toEqual([2.5, acts[1].code, 'overlay', 'Spare drive']);
    const audit = (await listAudit({ limit: 5 })).find((a) => a.object === 'HLT-026 BOM');
    expect([audit?.who, audit?.change]).toEqual(['Romain Aubert', `CR-BRG-FAG × 2.5 added · Overlay · ${acts[1].code}`]);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    // A second add of the same article is refused; French toast on success.
    expect(await addBomArticleAction('HLT-026', { ref: 'CR-BRG-FAG' })).toEqual({ error: 'This article is already in the project BOM' });
    viewer.lang = 'fr';
    viewer.name = 'Marie Lefebvre';
    expect(await addBomArticleAction('EWA-051', { ref: 'EL-VFD-200', qty: '3' })).toEqual({ toast: 'Article ajouté à la nomenclature projet' });
    expect((await line('EWA-051', 'EL-VFD-200'))!.quantity).toBe(3);
  });

  it('form definition: the prototype AF.bom (fields, defaults, required ref), activities as "A1250 · name", scope codes', async () => {
    const acts = await listBomActivityOptions('HLT-026');
    const def = bomFormDef(acts);
    const af = (golden as { form: { af: { fields: (string | number | string[])[][] } } }).form.af;
    expect(def.fields.map((f) => [f.id, f.label, f.type, f.required])).toEqual(af.fields.map((f) => [f[0], f[1], f[2], !!f[4]]));
    expect([def.title, def.submit, def.kind, def.fields[1].defaultValue]).toEqual(['Add article', 'Add to BOM', 'create', '1']);
    expect(def.fields[2].options).toEqual(acts.map((a) => ({ value: a.code, label: a.label })));
    expect(acts.length).toBeLessThanOrEqual(12);
    expect(def.fields[3].options).toEqual([{ value: 'keystone', label: 'Keystone' }, { value: 'client', label: 'Client' }, { value: 'overlay', label: 'Overlay' }]);
    const fr = localizeBomForm(def, makeT('fr'));
    expect([fr.title, fr.submit, fr.fields.map((f) => f.label), fr.fields[3].options]).toEqual([
      'Ajouter un article', 'Ajouter à la nomenclature', ['Référence article', 'Quantité', 'Activité', 'Périmètre', 'Note'],
      [{ value: 'keystone', label: 'Keystone' }, { value: 'client', label: 'Client' }, { value: 'overlay', label: 'Surcouche' }],
    ]);
  });
});
