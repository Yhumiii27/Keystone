// Plan Server Functions against an in-memory database: permission gate, prototype parsing of the inline
// edits (clamp, parseInt fallbacks, budget → EAC), predecessor validation, the three add-forms (numbering,
// working days, toasts) and removal. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, canEdit: true, isMine: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: await getProject(code), viewer: { role: viewer.role, name: 'Marie Lefebvre' }, canEdit: () => viewer.canEdit, isMine: viewer.isMine,
    }),
  };
});

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getPlanData } from '@/server/dal/plan';
import { addActivity, addWorkPackage, editActivity, moveActivity, removeRow, renamePackage, restoreRow, saveProgress } from './actions';

const act = async (id: string, code = 'HLT-026') => (await getPlanData(code))!.activities.find((a) => a.id === id);

describe('Plan Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.role = 'director';
    viewer.canEdit = true;
    viewer.isMine = true;
  });

  it('refuses read-only viewers, the client, unknown projects and projects without a plan', async () => {
    viewer.canEdit = false;
    expect(await editActivity('HLT-026', 'A1250', 'pct', '80')).toEqual({ error: 'This plan is read-only for you' });
    viewer.canEdit = true;
    viewer.role = 'client';
    expect(await saveProgress('HLT-026', { act: 'A1250 · x', pc: '80' })).toEqual({ error: 'This plan is read-only for you' });
    viewer.role = 'director';
    expect(await editActivity('NOPE-000', 'A1250', 'pct', '80')).toEqual({ error: 'Invalid request' });
    expect(await addWorkPackage('ALP-021', { name: 'X' })).toEqual({ error: 'This project has no plan yet' });
    expect((await act('A1250'))!.pct).toBe(72);
  });

  it('progress: clamped, normalised, unchanged values are not written', async () => {
    expect(await editActivity('HLT-026', 'A1250', 'pct', '150')).toEqual({ ok: true, value: '100' });
    expect((await act('A1250'))!.pct).toBe(100);
    expect(await editActivity('HLT-026', 'A1250', 'pct', 'abc')).toEqual({ ok: true, value: '0' });
    expect(await editActivity('HLT-026', 'A1250', 'pct', '72')).toEqual({ ok: true, value: '72' });
    const a = (await act('A1250'))!;
    expect([a.pct, a.edited]).toEqual([72, false]);
  });

  it('structure edits: duration fallback, budget raises EAC, owner, name', async () => {
    expect(await editActivity('HLT-026', 'A1260', 'dur', '')).toEqual({ ok: true, value: '25' });
    expect((await act('A1260'))!.edited).toBe(false);
    expect(await editActivity('HLT-026', 'A1260', 'dur', '30')).toEqual({ ok: true, value: '30' });
    expect(await editActivity('HLT-026', 'A1260', 'budget', '150')).toEqual({ ok: true, value: '150' });
    expect(await editActivity('HLT-026', 'A1260', 'owner', 'AO')).toEqual({ ok: true, value: 'AO' });
    expect(await editActivity('HLT-026', 'A1260', 'owner', 'XX')).toEqual({ error: 'Invalid request' });
    expect(await editActivity('HLT-026', 'A1260', 'name', '  ')).toEqual({ error: 'Enter a name' });
    expect(await editActivity('HLT-026', 'A1260', 'name', ' Roof decking & sheeting ')).toEqual({ ok: true, value: 'Roof decking & sheeting' });
    expect(await act('A1260')).toMatchObject({ durationDays: 30, budget: 150, eac: 150, actual: 0, owner: 'AO', name: 'Roof decking & sheeting', edited: true });
  });

  it('predecessors: parsed, validated with visible errors, loops refused', async () => {
    expect(await editActivity('HLT-026', 'A1430', 'preds', 'a1260 ss+2, A1410 FF 5d')).toEqual({ ok: true, value: 'A1260 SS+2, A1410 FF+5' });
    expect((await act('A1430'))!.preds).toEqual([['A1260', 'SS', 2], ['A1410', 'FF', 5]]);
    expect(await editActivity('HLT-026', 'A1430', 'preds', 'A1260, A9999')).toEqual({ error: 'A9999 — unknown activity' });
    expect(await editActivity('HLT-026', 'A1430', 'preds', 'A1430')).toEqual({ error: 'A1430 — an activity cannot precede itself' });
    expect(await editActivity('HLT-026', 'A1430', 'preds', 'A1260 XX')).toEqual({ error: 'A1260 XX — invalid syntax — use “A1010 FS+5”' });
    expect(await editActivity('HLT-026', 'A1010', 'preds', 'A1620')).toEqual({ error: 'A1620 — would create a logic loop' });
    expect((await act('A1010'))!.preds).toEqual([]);
  });

  it('move up / down within the work package, no-op at the ends', async () => {
    expect(await moveActivity('HLT-026', 'A1320', -1)).toEqual({ ok: true });
    const order = async () => (await getPlanData('HLT-026'))!.activities.filter((a) => a.wbs === '1.5').map((a) => a.id);
    expect(await order()).toEqual(['A1320', 'A1310', 'A1330']);
    expect(await moveActivity('HLT-026', 'A1320', -1)).toEqual({ ok: true });
    expect(await order()).toEqual(['A1320', 'A1310', 'A1330']);
  });

  it('AF plan — Add activity: id, working days, dates, owner, critical float, toast', async () => {
    const r = await addActivity('HLT-026', { name: 'As-built survey', wp: '1.4 · Steel structure', owner: 'Julien Wagner', start: '5 Oct 2026', finish: '30 Oct 2026', budget: '40', critical: 'Yes', desc: '' });
    expect(r).toEqual({ toast: 'A1901 · Activity created · 1.4' });
    expect(await act('A1901')).toMatchObject({
      wbs: '1.4', durationDays: 18, start: '05 Oct', startDate: '2026-10-05', finish: '30 Oct', baselineFinish: '30 Oct', owner: 'JW',
      budget: 40, eac: 40, totalFloat: -27, pct: 0, isAdded: true, critical: true,
    });
    const r2 = await addActivity('HLT-026', { name: 'Snag list', wp: '1.8 · Commissioning & handover', owner: 'Someone else', start: 'soon', finish: '', budget: 'x', critical: 'No' });
    expect(r2).toEqual({ toast: 'A1902 · Activity created · 1.8' });
    expect(await act('A1902')).toMatchObject({ durationDays: 20, start: 'soon', startDate: null, owner: 'RA', budget: 0, totalFloat: 10 });
    expect(await addActivity('HLT-026', { name: 'X', wp: '9.9 · Nope' })).toEqual({ error: 'Invalid request' });
    expect(await addActivity('HLT-026', { name: ' ' })).toEqual({ error: 'Enter a name' });
  });

  it('AF wp — Add work package, AF progress — Update progress', async () => {
    expect(await addWorkPackage('HLT-026', { name: 'Training', owner: 'Hélène Sauvage', budget: '100', desc: 'Operators' })).toEqual({ toast: '1.9 · Training · Work package created' });
    expect((await getPlanData('HLT-026'))!.packages.at(-1)).toMatchObject({ code: '1.9', name: 'Training', added: true });
    expect(await renamePackage('HLT-026', '1.9', 'Training & handover')).toEqual({ ok: true, value: 'Training & handover' });
    expect(await saveProgress('HLT-026', { act: 'A1260 · Roof decking', pc: '55', note: 'ignored' })).toEqual({ toast: 'A1260 · 55 % · Progress saved' });
    expect((await act('A1260'))!.pct).toBe(55);
    expect(await saveProgress('HLT-026', { act: 'A0000 · Nope', pc: '55' })).toEqual({ error: 'Invalid request' });
  });

  it('removes an activity and a work package with its activities (to the Plan trash, S-5)', async () => {
    expect(await removeRow('HLT-026', 'act', 'A1902')).toEqual({ ok: true, trashId: expect.any(String), toast: 'A1902 removed' });
    expect(await act('A1902')).toBeUndefined();
    expect(await removeRow('HLT-026', 'wp', '1.7')).toEqual({ ok: true, trashId: expect.any(String), toast: 'Work package 1.7 removed' });
    const d = (await getPlanData('HLT-026'))!;
    expect(d.packages.some((p) => p.code === '1.7')).toBe(false);
    expect(d.activities.some((a) => a.id === 'A1510' || a.id === 'A1520')).toBe(false);
    expect(await removeRow('HLT-026', 'wp', '1')).toEqual({ error: 'Invalid request' });
  });

  it('undo (S-5): removal and restore for the project manager and the director only; the toast trash id restores links exactly', async () => {
    const before = (await getPlanData('HLT-026'))!;
    const wp16 = before.activities.filter((a) => a.wbs === '1.6');
    expect(wp16.length).toBeGreaterThan(0);
    const linked = (d: typeof before) => d.activities.map((a) => [a.id, a.wbs, a.preds]);
    // Read-only project / outside the workspace, the client, a plan editor who is not the manager.
    viewer.canEdit = false;
    expect(await removeRow('HLT-026', 'wp', '1.6')).toEqual({ error: 'This plan is read-only for you' });
    viewer.canEdit = true;
    viewer.role = 'client';
    expect(await removeRow('HLT-026', 'wp', '1.6')).toEqual({ error: 'This plan is read-only for you' });
    Object.assign(viewer, { role: 'englead', isMine: false });
    expect(await removeRow('HLT-026', 'wp', '1.6')).toEqual({ error: 'Only the project manager or the director can do this' });
    Object.assign(viewer, { role: 'pm', isMine: true });
    const r = await removeRow('HLT-026', 'wp', '1.6');
    if (!('ok' in r)) throw new Error(r.error);
    expect(r.toast).toBe('Work package 1.6 removed');
    expect((await getPlanData('HLT-026'))!.activities.some((a) => a.wbs === '1.6')).toBe(false);
    // Restore: same rights.
    Object.assign(viewer, { role: 'englead', isMine: false });
    expect(await restoreRow('HLT-026', r.trashId)).toEqual({ error: 'Only the project manager or the director can do this' });
    viewer.canEdit = false;
    expect(await restoreRow('HLT-026', r.trashId)).toEqual({ error: 'This plan is read-only for you' });
    Object.assign(viewer, { role: 'director', isMine: true, canEdit: true });
    expect(await restoreRow('HLT-026', 'not-an-id')).toEqual({ error: 'Invalid request' });
    expect(await restoreRow('NDC-031', r.trashId)).toEqual({ error: 'This removal can no longer be undone' });
    expect(await restoreRow('HLT-026', r.trashId)).toEqual({ ok: true, toast: `Work package 1.6 restored · ${wp16.length} activities` });
    expect(linked((await getPlanData('HLT-026'))!)).toEqual(linked(before));
    expect(await restoreRow('HLT-026', r.trashId)).toEqual({ error: 'This removal can no longer be undone' });
  });
});
