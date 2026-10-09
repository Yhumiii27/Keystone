// Engineering Server Functions against an in-memory database (seeded register of HLT-026, Codex deliverables): the
// workspace gate and the project read-only rule, input validation, stale actions (the row changed since the page was
// rendered), "Validate release (PM)" for the project's PM or the director only, the release gate on open blocking
// checks, the viewer as the actor (audit trail), the statuses shared with the Codex Documents screen, the import
// wizard (revision in use, P&ID input, closed revision check) and the sidebar badges. The session is mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
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
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getDocumentRecord } from '@/server/dal/documents';
import { engNavBadges, engNavBadgesByProject, getEngScreen } from '@/server/dal/eng-screen';
import { listAudit } from '@/server/dal/notifications';
import { closeCheckAction, confirmInputAction, deliverableStepAction, generateOutputAction, importListAction } from './actions';

const HLT = 'HLT-026';
const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};
const reg = async () => (await getEngScreen(HLT))!;
const READ_ONLY = { ok: false, error: 'The engineering register is read-only for you' };
const INVALID = { ok: false, error: 'Invalid request' };
const STALE = { ok: false, error: 'This action is not available any more' };

describe('engineering Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('director');
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside the workspace, read-only projects and malformed requests', async () => {
    for (const role of ['depthead', 'member', 'procurement', 'client']) {
      as(role);
      expect(await confirmInputAction({ code: HLT, disc: 'meca', doc: 'PID-HLT-026' })).toEqual(READ_ONLY);
      expect(await closeCheckAction({ code: HLT, disc: 'elec', number: 'C-01', how: 'resolved' })).toEqual(READ_ONLY);
      expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'freeze' })).toEqual(READ_ONLY);
      expect(await generateOutputAction({ code: HLT, disc: 'process', number: 'O-01' })).toEqual(READ_ONLY);
      expect(await importListAction({ code: HLT, from: 'eng', disc: 'elec', doc: 'LST-INS-026', tool: 2 })).toEqual(READ_ONLY);
    }
    // The PM on a project that is not theirs (NDC-031: S. Perrin) — read-only.
    as('pm');
    expect(await confirmInputAction({ code: 'NDC-031', disc: 'meca', doc: 'PID-HLT-026' })).toEqual(READ_ONLY);
    as('director');
    expect(await confirmInputAction({ code: HLT, disc: 'client', doc: 'PID-HLT-026' })).toEqual(INVALID);
    expect(await confirmInputAction({ code: HLT, disc: 'meca', doc: '<script>' })).toEqual(INVALID);
    expect(await confirmInputAction(null as never)).toEqual(INVALID);
    expect(await closeCheckAction({ code: HLT, disc: 'elec', number: 'C-01', how: 'deleted' })).toEqual(INVALID);
    expect(await closeCheckAction({ code: HLT, disc: 'elec', number: 'X-1', how: 'resolved' })).toEqual(INVALID);
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'release' })).toEqual(INVALID);
    expect(await generateOutputAction({ code: HLT, disc: 'elec', number: 'C-01' })).toEqual(INVALID);
    expect(await importListAction({ code: HLT, from: 'eng', disc: 'elec', doc: 'LST-INS-026', tool: 9 })).toEqual(INVALID);
    expect(await importListAction({ code: HLT, from: 'eng', disc: 'elec', doc: 'BOD-CLI-026', tool: 0 })).toEqual(INVALID);
    expect(await importListAction({ code: HLT, from: 'elec', disc: 'elec', doc: 'SCH-ELE-026', tool: 2 })).toEqual(INVALID);
    expect(await importListAction({ code: HLT, from: 'nope', disc: 'elec', doc: 'LST-INS-026', tool: 0 })).toEqual(INVALID);
    expect(await importListAction({ code: 'XXX-999', from: 'eng', disc: 'elec', doc: 'LST-INS-026', tool: 0 })).toEqual(INVALID);
    // A project without a register.
    expect(await confirmInputAction({ code: 'NDC-031', disc: 'meca', doc: 'PID-HLT-026' })).toEqual({
      ok: false, error: 'No engineering register for this project yet — import the first list to start.',
    });
    // French messages.
    as('member', 'fr');
    expect(await confirmInputAction({ code: HLT, disc: 'meca', doc: 'PID-HLT-026' })).toEqual({ ok: false, error: 'Le registre ingénierie est en lecture seule pour vous' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses actions that do not belong to the screen or are stale', async () => {
    // An input of another discipline, an outdated input, an already confirmed one.
    expect(await confirmInputAction({ code: HLT, disc: 'elec', doc: 'FDS-HLT-026' })).toEqual(STALE);
    expect(await confirmInputAction({ code: HLT, disc: 'elec', doc: 'PID-HLT-026' })).toEqual(STALE);
    expect(await confirmInputAction({ code: HLT, disc: 'process', doc: 'GA-HLT-026' })).toEqual(STALE);
    // A check not listed on the Mechanical screen; a resolved one.
    expect(await closeCheckAction({ code: HLT, disc: 'meca', number: 'C-02', how: 'resolved' })).toEqual(STALE);
    expect(await closeCheckAction({ code: HLT, disc: 'elec', number: 'C-10', how: 'resolved' })).toEqual(STALE);
    // A deliverable of another discipline; a step that does not follow the status; an output blocked by checks.
    expect(await deliverableStepAction({ code: HLT, disc: 'meca', number: 'SCH-ELE-026', step: 'freeze' })).toEqual(STALE);
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'propose' })).toEqual(STALE);
    expect(await generateOutputAction({ code: HLT, disc: 'elec', number: 'O-03' })).toEqual(STALE);
    // Release gate: LST-IO-026 is Frozen but Electrical owns 2 open blocking checks.
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'LST-IO-026', step: 'propose' })).toEqual({
      ok: false, error: 'Release blocked by open blocking inconsistencies',
    });
  });

  it('confirm, resolve / send back, generate — the viewer as the actor, badges follow', async () => {
    as('englead');
    expect(await confirmInputAction({ code: HLT, disc: 'meca', doc: 'PID-HLT-026' })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect((await reg()).inputs.find((i) => i.consumer === 'meca' && i.documentNumber === 'PID-HLT-026')).toMatchObject({ acknowledged: true, state: 'up_to_date' });
    expect(await confirmInputAction({ code: HLT, disc: 'meca', doc: 'PID-HLT-026' })).toEqual(STALE);

    as('quality');
    expect(await closeCheckAction({ code: HLT, disc: 'elec', number: 'C-01', how: 'resolved' })).toEqual({ ok: true });
    // C-03 is listed on the Mechanical screen too (Mechanical ↔ Electrical).
    expect(await closeCheckAction({ code: HLT, disc: 'meca', number: 'C-03', how: 'sent_back' })).toEqual({ ok: true });
    const r = await reg();
    expect(r.checks.filter((c) => ['C-01', 'C-03'].includes(c.number)).map((c) => [c.number, c.status, c.note])).toEqual([
      ['C-01', 'resolved', 'Resolved in Keystone'], ['C-03', 'sent_back', 'Sent back to tool · closes on next import'],
    ]);
    expect(await engNavBadges(HLT)).toEqual({ eng: '2', 'eng-process': '', 'eng-meca': '', 'eng-elec': '', 'eng-auto': '2' });
    expect(await engNavBadgesByProject()).toEqual({ [HLT]: { eng: '2', 'eng-process': '', 'eng-meca': '', 'eng-elec': '', 'eng-auto': '2' } });
    // Electrical has no open blocking check any more: its outputs can be generated.
    expect(await generateOutputAction({ code: HLT, disc: 'elec', number: 'O-03' })).toEqual({ ok: true });
    expect((await reg()).outputs.find((o) => o.number === 'O-03')).toMatchObject({ state: 'ready', generatedFormat: 'xlsx' });
    const audit = (await listAudit({ projectCode: HLT })).map((a) => [a.who, a.object]);
    expect(audit).toEqual(
      expect.arrayContaining([['Gabriel Comte', 'O-03 · I/O list'], ['Gabriel Comte', 'C-03'], ['Gabriel Comte', 'C-01'], ['Antoine Girard', 'PID-HLT-026']]),
    );
  });

  it('deliverables: freeze, propose, validate (PM or director only), shared with Codex', async () => {
    as('englead');
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'freeze' })).toEqual({ ok: true });
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'propose' })).toEqual({ ok: true });
    expect((await getDocumentRecord('SCH-ELE-026'))?.status).toBe('release_proposed');
    // The engineering lead and quality do not validate; neither does a PM on a project that is not theirs.
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'validate' })).toEqual({
      ok: false, error: 'Only the project manager validates releases',
    });
    as('quality', 'fr');
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'validate' })).toEqual({
      ok: false, error: 'Seul le chef de projet valide les diffusions',
    });
    as('pm');
    expect(await deliverableStepAction({ code: HLT, disc: 'elec', number: 'SCH-ELE-026', step: 'validate' })).toEqual({ ok: true });
    expect((await getDocumentRecord('SCH-ELE-026'))?.status).toBe('released');
    expect((await reg()).deliverables.find((d) => d.number === 'SCH-ELE-026')).toMatchObject({ status: 'released', canValidate: false });
  });

  it('import wizard: the revision in use is updated (to confirm), the P&ID input too, the revision check closes', async () => {
    as('englead');
    expect(await importListAction({ code: HLT, from: 'eng', disc: 'elec', doc: 'LST-INS-026', tool: 2 })).toEqual({ ok: true });
    const r = await reg();
    expect(r.inputs.filter((i) => i.consumer === 'elec').map((i) => [i.documentNumber, i.revisionInUse, i.state])).toEqual([
      ['PID-HLT-026', 'D', 'to_confirm'], ['LST-INS-026', 'D', 'to_confirm'], ['LST-MOT-026', 'B', 'up_to_date'], ['GA-HLT-026', 'C', 'up_to_date'],
    ]);
    expect(r.checks.find((c) => c.number === 'C-08')).toMatchObject({ status: 'resolved', note: 'Closed by import of rev D' });
    // From a discipline screen, with the document's tool; a revision check sent back to the tool closes on this import.
    expect(await closeCheckAction({ code: HLT, disc: 'auto', number: 'C-09', how: 'sent_back' })).toEqual({ ok: true });
    expect(await importListAction({ code: HLT, from: 'auto', disc: 'auto', doc: 'LST-IO-026', tool: 2 })).toEqual({ ok: true });
    expect((await reg()).checks.find((c) => c.number === 'C-09')).toMatchObject({ status: 'resolved', note: 'Closed by import of rev B' });
    // Now the imported input can be confirmed.
    expect(await confirmInputAction({ code: HLT, disc: 'elec', doc: 'LST-INS-026' })).toEqual({ ok: true });
  });
});
