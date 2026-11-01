// R-204 — rights of the supplier schedules and the activity codes, per persona: the pure rules over PERSONAS, then the Server
// Functions (procurement edits a supplier schedule but does not tie it; the project's leads do both; a team member, Finance and
// a read-only project are refused; the client is refused), with their validation.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Fabien Bertrand', role: 'procurement', lead: false, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({
    project: { code }, viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, isLead: viewer.lead, canEdit: () => viewer.edit,
  }),
}));

import { PERSONAS } from '@/config/personas';
import { canEditSupplierSchedule, canTieSupplierSchedule } from '@/domain/rights';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getActivityCodes } from '@/server/dal/activity-codes';
import { listSupplierSchedules } from '@/server/dal/supplier-schedules';
import { addCodeTypeAction, addCodeValueAction, setActivityCodeAction } from '@/features/activity-codes/actions';
import {
  addSupplierLinkAction, addSupplierTieAction, createSupplierScheduleAction, recordSupplierProgressAction, removeSupplierTieAction, saveSupplierActivityAction,
} from './actions';

const SCHEDULE_ONLY = { error: 'Only procurement, the project manager or the director can edit the supplier schedules' };
const TIES_ONLY = { error: 'Only the project manager or the director can tie a supplier schedule to the project schedule' };
const CODES_ONLY = { error: 'Only the project manager or the director can change the activity codes' };
const as = (role: string, lead: boolean, edit = true) => Object.assign(viewer, { role, lead, edit, name: role === 'procurement' ? 'Fabien Bertrand' : 'Romain Aubert' });

beforeAll(async () => setDb(await openDatabase()), 120_000);

describe('pure rights over the personas (R-204)', () => {
  it('supplier schedule: the leads (any role but the client) and procurement, on orders they may edit; ties: the leads only', () => {
    for (const p of PERSONAS) {
      expect([p.role, canEditSupplierSchedule(p.role, { lead: false }, true)]).toEqual([p.role, p.role === 'procurement']);
      expect([p.role, canEditSupplierSchedule(p.role, { lead: true }, true)]).toEqual([p.role, p.role !== 'client']);
      expect([p.role, canEditSupplierSchedule(p.role, { lead: true }, false)]).toEqual([p.role, false]);
      expect([p.role, canTieSupplierSchedule(p.role, { lead: false }, true)]).toEqual([p.role, false]);
      expect([p.role, canTieSupplierSchedule(p.role, { lead: true }, true)]).toEqual([p.role, p.role !== 'client']);
      expect([p.role, canTieSupplierSchedule(p.role, { lead: true }, false)]).toEqual([p.role, false]);
    }
  });
});

describe('supplier schedule Server Functions (R-204)', () => {
  it('procurement creates and edits the schedule and records progress, but cannot tie it', async () => {
    as('procurement', false);
    expect(await createSupplierScheduleAction('HLT-026', 'PO-1071', false)).toEqual({ ok: true });
    expect(await saveSupplierActivityAction('HLT-026', 'PO-1071', '', { code: 'f10', name: 'Fabrication', duration: '10', committedStart: '2026-09-28', committedFinish: '' })).toEqual({ ok: true });
    expect(await saveSupplierActivityAction('HLT-026', 'PO-1071', '', { code: 'F20', name: 'Livraison', duration: '0', committedStart: '', committedFinish: '2026-10-16', chain: 'yes' })).toEqual({ ok: true });
    expect(await recordSupplierProgressAction('HLT-026', 'PO-1071', 'F10', { actualStart: '2026-09-21', actualFinish: '', pct: '30' })).toEqual({ ok: true });
    expect(await addSupplierTieAction('HLT-026', 'PO-1071', { supplier: 'F20', activity: 'A1420', direction: 'to_project', lag: '0' })).toEqual(TIES_ONLY);
    const s = (await listSupplierSchedules('HLT-026')).find((x) => x.poNumber === 'PO-1071')!;
    expect(s.activities.map((a) => [a.code, a.percentComplete, a.actualStart])).toEqual([['F10', 30, '2026-09-21'], ['F20', 0, null]]);
    expect(s.links).toMatchObject([{ pred: 'F10', succ: 'F20' }]);
  });

  it('the PM lead ties it; validation errors come back translated; a loop is refused with its path', async () => {
    as('pm', true);
    expect(await addSupplierTieAction('HLT-026', 'PO-1071', { supplier: 'F20', activity: 'A1420', direction: 'to_project', lag: '0' })).toEqual({ ok: true });
    expect(await addSupplierTieAction('HLT-026', 'PO-1071', { supplier: 'F10', activity: 'A1420', direction: 'from_project', lag: '0' })).toMatchObject({ error: expect.stringContaining('A1420') });
    expect(await saveSupplierActivityAction('HLT-026', 'PO-1071', '', { code: 'F30', name: '', duration: '1' })).toEqual({ error: 'Name: 1 to 120 characters' });
    expect(await recordSupplierProgressAction('HLT-026', 'PO-1071', 'F20', { pct: '50' })).toEqual({ error: 'Enter the actual start of a started activity' });
    expect(await addSupplierLinkAction('HLT-026', 'PO-1071', { pred: 'F10', succ: 'F20', type: 'FS', lag: '0' })).toEqual({ error: 'This relationship already exists' });
    expect(await createSupplierScheduleAction('HLT-026', 'PO-1071', false)).toEqual({ error: 'This order already has a supplier schedule' });
    expect(await createSupplierScheduleAction('HLT-026', 'po 1', false)).toEqual({ error: 'Invalid request' });
    expect(await removeSupplierTieAction('HLT-026', 'PO-1071', 'F20', 'A1420')).toEqual({ ok: true });
  });

  it('refuses a team member, Finance, the client, and a read-only project', async () => {
    as('member', false);
    expect(await createSupplierScheduleAction('HLT-026', 'PO-1063', false)).toEqual(SCHEDULE_ONLY);
    as('finance', false);
    expect(await recordSupplierProgressAction('HLT-026', 'PO-1071', 'F10', { pct: '0' })).toEqual(SCHEDULE_ONLY);
    as('client', true);
    expect(await createSupplierScheduleAction('HLT-026', 'PO-1063', false)).toEqual(SCHEDULE_ONLY);
    expect(await addSupplierTieAction('HLT-026', 'PO-1071', { supplier: 'F20', activity: 'A1420', direction: 'to_project', lag: '0' })).toEqual(TIES_ONLY);
    as('procurement', false, false);
    expect(await createSupplierScheduleAction('HLT-026', 'PO-1063', false)).toEqual(SCHEDULE_ONLY);
    expect((await listSupplierSchedules('HLT-026')).some((x) => x.poNumber === 'PO-1063')).toBe(false);
  });
});

describe('activity code Server Functions (R-204)', () => {
  it('the leads edit the dictionary and the assignments; procurement and members are refused', async () => {
    as('procurement', false);
    expect(await addCodeTypeAction('HLT-026', { name: 'Zone' })).toEqual(CODES_ONLY);
    as('member', false);
    expect(await setActivityCodeAction('HLT-026', 'A1250', 'equipment', '')).toEqual(CODES_ONLY);
    as('pm', true);
    expect(await addCodeTypeAction('HLT-026', { name: 'Discipline', kind: 'custom' })).toEqual({ ok: true });
    expect(await addCodeTypeAction('HLT-026', { name: 'discipline' })).toEqual({ error: 'A code type with this name already exists' });
    const type = (await getActivityCodes('HLT-026'))!.types.find((x) => x.name === 'Discipline')!;
    expect(await addCodeValueAction('HLT-026', type.key, { code: 'ELEC', label: 'Electrical' })).toEqual({ ok: true });
    const value = (await getActivityCodes('HLT-026'))!.types.find((x) => x.name === 'Discipline')!.values[0];
    expect(await setActivityCodeAction('HLT-026', 'A1420', type.key, value.key)).toEqual({ ok: true });
    expect(await setActivityCodeAction('HLT-026', 'A1420', 'purchase_package', '')).toEqual({ error: 'This code type is derived from the project’s links' });
    expect(await setActivityCodeAction('HLT-026', 'A1420', 'nope', '')).toEqual({ error: 'Invalid request' });
    expect(await setActivityCodeAction('HLT-026', 'A9999', type.key, '')).toEqual({ error: 'Unknown activity' });
    expect((await getActivityCodes('HLT-026'))!.map.A1420[type.key]).toEqual([value.key]);
  });
});
