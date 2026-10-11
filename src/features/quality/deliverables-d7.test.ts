// R-114 (Q-3a: a deliverable rejected by the client goes back to In progress at the next revision, the history of refusals
// is kept) and R-115 (Q-3b: "New deliverable" for the project manager). Pure rules (next revision, form parsing, review
// line), then the Server Functions on the seeded in-memory database with the real project context: the 8 personas, a PM
// on another project (read-only), the director, input validation, numbering, RACI R / B, audit; the reject → next
// revision → resubmit → reject cycle with its history; a rejection made before the history existed; stale clicks; the
// drawer view model and the register action.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
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

import { and, eq } from 'drizzle-orm';
import { deliverableActionFor, nextRevision, parseNewDeliverable, reviewLineText } from '@/domain/quality';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { deliverables, projects } from '@/server/db/schema';
import { listAudit } from '@/server/dal/notifications';
import { createDeliverable, getDeliverable, listDeliverables } from '@/server/dal/quality';
import { createDeliverableAction, decideDeliverableAction, moveDeliverableAction, rejectDeliverableWithCommentsAction } from './actions';
import { newDeliverableFormDef } from './deliverable-form';
import { dlvDrawerView, dlvTabView, type QualityState } from './model';

const HLT = 'HLT-026';
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const NEW = { type: 'test_reports', title: 'Load test report — gantry 2', due: '30 Nov', wbs: '1.5', r: 'Thomas Kerbrat', b: 'Hélène Sauvage' };

describe('R-114 / R-115 rules', () => {
  it('next revision: letters, numbers, mixed indexes, none yet', () => {
    expect([null, '—', 'A', 'B', 'Z', 'AZ', 'ZZ', 'c', '0', '1', '09', 'P01', '1A', 'B.2', 'v'].map(nextRevision)).toEqual([
      'A', 'A', 'B', 'C', 'AA', 'BA', 'AAA', 'd', '1', '2', '10', 'P02', '1B', 'B.3', 'w',
    ]);
    expect(nextRevision('#')).toBe('#.1');
  });

  it('a rejected deliverable offers "Start next revision" to the project team, never to the client', () => {
    const team = { role: 'pm', canEdit: true, isClientContact: false };
    expect(deliverableActionFor({ status: 'rejected' }, team)).toEqual({ kind: 'move', to: 'in_progress', label: 'Start next revision', variant: 'secondary' });
    expect(deliverableActionFor({ status: 'rejected' }, { role: 'client', canEdit: true, isClientContact: true })).toBeNull();
    expect(deliverableActionFor({ status: 'rejected' }, { ...team, canEdit: false })).toBeNull();
  });

  it('review line', () => {
    expect(reviewLineText({ revision: 'C', decision: 'rejected', decidedOn: '2026-09-25', decidedBy: 'N. Bensaïd', comments: 'x' })).toBe('Rev C · Rejected 25 Sep · N. Bensaïd');
    expect(reviewLineText({ revision: null, decision: 'accepted', decidedOn: '2027-01-14', decidedBy: 'Client', comments: null })).toBe('Rev — · Accepted 14 Jan ’27 · Client');
  });

  it('parses "New deliverable"', () => {
    const opts = { types: [{ code: 'drawings', label: 'Drawings' }, { code: 'test_reports', label: 'Test & inspection reports' }], wbs: ['1', '1.5'], team: ['Thomas Kerbrat', 'Hélène Sauvage'] };
    expect(parseNewDeliverable(NEW, opts)).toEqual({
      ok: true, value: { type: 'test_reports', title: 'Load test report — gantry 2', dueOn: '2026-11-30', wbsCode: '1.5', responsible: 'Thomas Kerbrat', backup: 'Hélène Sauvage' },
    });
    expect(parseNewDeliverable({ ...NEW, type: 'Drawings', b: '—' }, opts)).toMatchObject({ ok: true, value: { type: 'drawings', backup: null } });
    expect(parseNewDeliverable({ title: 'x', due: '1 Dec' }, opts)).toMatchObject({ ok: true, value: { type: 'drawings', wbsCode: '1', responsible: 'Thomas Kerbrat', backup: null } });
    const err = (v: Record<string, string>) => {
      const r = parseNewDeliverable({ ...NEW, ...v }, opts);
      return r.ok ? null : r.error;
    };
    expect([err({ type: 'nope' }), err({ title: ' ' }), err({ title: 'x'.repeat(201) }), err({ due: '' }), err({ due: 'later' }), err({ wbs: '9.9' }), err({ r: 'Nobody' }), err({ b: 'Nobody' }), err({ b: 'Thomas Kerbrat' })]).toEqual([
      'Unknown deliverable type', 'Title is required', 'Text is too long', 'Due date is required', 'Enter the due date as a date, e.g. 15 Oct', 'Unknown WBS element', 'Unknown responsible',
      'Unknown backup', 'The backup must differ from the responsible',
    ]);
  });
});

describe('R-114 / R-115 Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'director';
    session.lang = 'en';
  });

  it('"New deliverable": the project manager of the project and the director only; the others are refused, nothing written', async () => {
    const before = (await listDeliverables(HLT)).length;
    const outcome: Record<string, string> = {};
    for (const role of ROLES) {
      session.role = role;
      const r = (await createDeliverableAction(HLT, { ...NEW, title: `By ${role}` })) as { toast?: string; error?: string };
      outcome[role] = r.toast ?? r.error ?? '';
    }
    expect(outcome).toEqual({
      director: 'D-022 · Deliverable added',
      pm: 'D-023 · Deliverable added',
      depthead: 'Quality is read-only for you',
      member: 'Quality is read-only for you',
      englead: 'Only the project manager creates deliverables',
      quality: 'Only the project manager creates deliverables',
      procurement: 'Quality is read-only for you',
      client: 'Only the project manager creates deliverables',
    });
    expect((await listDeliverables(HLT)).length).toBe(before + 2);
    // The PM of HLT-026 on another project (NDC-031, read-only for him) is refused; the writer re-checks the ownership.
    session.role = 'pm';
    expect(await createDeliverableAction('NDC-031', NEW)).toEqual({ error: 'Quality is read-only for you' });
    await expect(createDeliverable('NDC-031', { type: 'drawings', title: 'x', dueOn: '2026-11-30', wbsCode: '1', responsible: 'Thomas Kerbrat' }, { name: 'Romain Aubert', role: 'pm' }))
      .rejects.toThrow(/Only the project manager/);
    await expect(createDeliverable(HLT, { type: 'drawings', title: 'x', dueOn: '2026-11-30', wbsCode: '1', responsible: 'Thomas Kerbrat' }, { name: 'Gabriel Comte', role: 'quality' }))
      .rejects.toThrow(/Only the project manager/);
  });

  it('"New deliverable": stored Planned with R and B, numbered after the project’s highest, audited; validation errors translated', async () => {
    session.role = 'pm';
    expect(await createDeliverableAction(HLT, { ...NEW, b: '—' })).toEqual({ toast: 'D-024 · Deliverable added' });
    const d = (await getDeliverable(HLT, 'D-024'))!;
    expect([d.title, d.type, d.typeLabel, d.wbsCode, d.wbsName, d.dueOn, d.status, d.revision, d.acceptanceText]).toEqual([
      'Load test report — gantry 2', 'test_reports', 'Test & inspection reports', '1.5', 'Crane installation', '2026-11-30', 'planned', null, '—',
    ]);
    expect(d.raci.map((c) => [c.role, c.name])).toEqual([['R', 'Thomas Kerbrat'], ['A', null], ['C', null], ['I', null], ['B', null]]);
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.area]).toEqual(['Romain Aubert', 'D-024', 'Deliverables']);
    session.lang = 'fr';
    expect(await createDeliverableAction(HLT, { ...NEW, title: '' })).toEqual({ error: 'Le titre est obligatoire' });
    expect(await createDeliverableAction(HLT, { ...NEW, wbs: '7.7' })).toEqual({ error: 'Élément de WBS inconnu' });
    // A deactivated Settings type is not offered and refused.
    expect(await createDeliverableAction(HLT, { ...NEW, type: 'not_a_type' })).toEqual({ error: 'Type de livrable inconnu' });
  });

  it('reject → "Start next revision" (revision +1, history kept) → resubmit → reject again → accept', async () => {
    // D-016 (rev B) is submitted: the client rejects it with comments.
    session.role = 'client';
    expect(await rejectDeliverableWithCommentsAction(HLT, 'D-016', { comments: 'Load case 4 missing' })).toEqual({ toast: 'D-016 · Rejected' });
    let d = (await getDeliverable(HLT, 'D-016'))!;
    expect([d.status, d.revision, d.reviewComments, d.acceptanceText]).toEqual(['rejected', 'B', 'Load case 4 missing', '25 Sep · comments issued']);
    expect(d.reviews).toEqual([{ revision: 'B', decision: 'rejected', submittedOn: d.submittedOn, decidedOn: '2026-09-25', decidedBy: 'N. Bensaïd', comments: 'Load case 4 missing' }]);
    // The client cannot restart it; quality (project team) can.
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'in_progress' })).toEqual({ ok: false, error: 'Only the project team records this progress' });
    session.role = 'quality';
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'in_progress' })).toEqual({ ok: true, toast: 'D-016 · In progress · Rev C' });
    d = (await getDeliverable(HLT, 'D-016'))!;
    expect([d.status, d.revision, d.rejectedOn, d.reviewComments, d.submittedOn, d.acceptanceDueOn]).toEqual(['in_progress', 'C', null, null, null, null]);
    expect(d.reviews.map((r) => [r.revision, r.decision, r.comments])).toEqual([['B', 'rejected', 'Load case 4 missing']]);
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Gabriel Comte', 'D-016', 'status: Rejected → In progress · revision B → C']);
    // A second click on the stale "Start next revision" does nothing.
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'in_progress' })).toEqual({ ok: false, error: 'This step is not available any more' });
    expect((await getDeliverable(HLT, 'D-016'))!.revision).toBe('C');
    // Rev C: internal review, submit, rejected again, then rev D accepted.
    expect((await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'internal_review' })).ok).toBe(true);
    expect((await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'submitted' })).ok).toBe(true);
    session.role = 'client';
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-016', decision: 'rejected', comments: 'Units on sheet 3' })).toEqual({ ok: true, toast: 'D-016 · Rejected' });
    session.role = 'pm';
    expect((await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'in_progress' })).ok).toBe(true);
    expect((await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'internal_review' })).ok).toBe(true);
    expect((await moveDeliverableAction({ projectCode: HLT, number: 'D-016', to: 'submitted' })).ok).toBe(true);
    session.role = 'client';
    expect((await decideDeliverableAction({ projectCode: HLT, number: 'D-016', decision: 'accepted' })).ok).toBe(true);
    d = (await getDeliverable(HLT, 'D-016'))!;
    expect([d.status, d.revision, d.acceptedBy]).toEqual(['accepted', 'D', 'N. Bensaïd']);
    expect(d.reviews.map((r) => [r.revision, r.decision, r.comments])).toEqual([['D', 'accepted', null], ['C', 'rejected', 'Units on sheet 3'], ['B', 'rejected', 'Load case 4 missing']]);

    // Drawer: history lines (newest first) in FR, no restart once accepted.
    const state: QualityState = { tab: 'dlv', filter: null, status: null, ncr: null, dlv: 'D-016' };
    const view = (role: string, dv = d) =>
      dlvDrawerView({ code: HLT, deliverable: dv, state, viewer: { role, canEdit: true, isClientContact: role === 'client', vigie: role !== 'client' }, documents: [] }, makeT('fr'), 'fr');
    expect(view('pm').reviews).toEqual([
      { line: 'Rév. D · Accepté 25 sept. · N. Bensaïd', comments: null },
      { line: 'Rév. C · Refusé 25 sept. · N. Bensaïd', comments: 'Units on sheet 3' },
      { line: 'Rév. B · Refusé 25 sept. · N. Bensaïd', comments: 'Load case 4 missing' },
    ]);
    expect(view('pm').restart).toBeNull();
  });

  it('a rejection recorded before the history existed (seed / older database) is shown, then kept when the next revision starts', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
    await db.update(deliverables).set({ status: 'rejected', rejectedOn: '2026-09-20', reviewComments: 'Missing CE marking', revision: 'A', submittedOn: '2026-09-15' })
      .where(and(eq(deliverables.projectId, p.id), eq(deliverables.number, 'D-018')));
    let d = (await getDeliverable(HLT, 'D-018'))!;
    expect(d.reviews).toEqual([{ revision: 'A', decision: 'rejected', submittedOn: '2026-09-15', decidedOn: '2026-09-20', decidedBy: 'Client', comments: 'Missing CE marking' }]);
    // Register row: "Start next revision" for the PM, nothing for the client.
    const state: QualityState = { tab: 'dlv', filter: null, status: null, ncr: null, dlv: null };
    const rows = (role: string) =>
      dlvTabView({ code: HLT, deliverables: [d], state, viewer: { role, canEdit: true, isClientContact: role === 'client', vigie: role !== 'client' } }, makeT('en'), 'en').rows;
    expect(rows('pm')[0].action).toEqual({ kind: 'move', to: 'in_progress', label: 'Start next revision', variant: 'secondary', restart: true });
    expect(rows('client')[0].action).toBeNull();
    session.role = 'director';
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'in_progress' })).toEqual({ ok: true, toast: 'D-018 · In progress · Rev B' });
    d = (await getDeliverable(HLT, 'D-018'))!;
    expect(d.reviews.map((r) => [r.revision, r.decision, r.decidedOn, r.comments])).toEqual([['A', 'rejected', '2026-09-20', 'Missing CE marking']]);
  });

  it('the form definition: Settings types, WBS elements, team; backup "—" first', () => {
    const f = newDeliverableFormDef({ types: [{ code: 'drawings', label: 'Drawings' }], wbs: [{ code: '1.5', name: 'Crane installation' }], team: ['Thomas Kerbrat'] }, makeT('fr'));
    expect([f.title, f.submit]).toEqual(['Nouveau livrable', 'Ajouter le livrable']);
    expect(f.fields.map((x) => [x.id, x.required ?? false, x.options ?? null])).toEqual([
      ['type', false, [{ value: 'drawings', label: 'Plans' }]], ['title', true, null], ['due', true, null], ['wbs', false, [{ value: '1.5', label: '1.5 · Crane installation' }]],
      ['r', false, ['Thomas Kerbrat']], ['b', false, ['—', 'Thomas Kerbrat']],
    ]);
  });
});
