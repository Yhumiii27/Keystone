// Chapter 4 — My approvals decides every row: resource requests inline (the Approvals screen's rules, through its Server
// Functions) and forced stage changes (L-1: the portfolio director approves → the stage is kept, rejects → the project goes
// back to the stage it left; audited and notified). In-memory seeded database, mocked session / screen access.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'depthead' as string, outside: false };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), usePathname: () => '/my/approvals' }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { makeT } = await import('@/i18n/translate');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as 'director'],
    getI18n: async () => ({ lang: 'en', t: makeT('en') }),
    getLastProject: async () => 'HLT-026',
  };
});
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getScreenAccess: async () => ({ viewer: PERSONA_BY_ROLE[session.role as 'director'], outside: session.outside, canEdit: !session.outside }),
    getProjectScope: async () => ({ pool: [], mineCount: 0, scopeAvail: false, isMine: () => true, readOnly: () => false }),
  };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { inboxView } from '@/domain/approvals';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { countForcedStageDecisions, getStageHistory, listPendingForcedTransitions, recordStageChange } from '@/server/dal/lifecycle';
import { listAudit, listNotifications } from '@/server/dal/notifications';
import { getProject } from '@/server/dal/projects';
import { getResourceRequest } from '@/server/dal/requests';
import { decideForcedStageChangeAction, decideResourceRequestAction } from './actions';
import { MyApprovalsBody } from './inbox';

const inbox = (role: RoleKey) => getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: 'HLT-026', lang: 'en' });
const pending = async (code: string) => (await listPendingForcedTransitions()).filter((p) => p.projectCode === code);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'depthead';
  session.outside = false;
});

describe('resource requests decided from the inbox', () => {
  it('the department head gets inline buttons on every request row; the inbox render shows them', async () => {
    const { items, decided } = await inbox('depthead');
    expect(items.map((i) => [i.id, i.decision])).toEqual([
      ['RQ-043', { mode: 'resource-request', number: 'RQ-043' }],
      ['RQ-041', { mode: 'resource-request', number: 'RQ-041' }],
    ]);
    const html = renderToStaticMarkup(
      h(I18nProvider, { lang: 'fr', children: h(MyApprovalsBody, { view: inboxView(items, { decided, roleTitle: 'Head of engineering' }), t: makeT('fr'), lang: 'fr', canDecide: true }) }),
    );
    expect(html.match(/>Approuver</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Refuser RQ-043"');
    expect(html).toContain('aria-haspopup="dialog"'); // Reject asks the reason the PM sees
  });

  it('Approve creates the task; the row is decided; a second decision is refused', async () => {
    const r = await decideResourceRequestAction({ number: 'RQ-043', decision: 'ok' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.toast).toMatch(/^RQ-043 · Approved · Task created · T-\d+$/);
    const rq = (await getResourceRequest('RQ-043'))!;
    expect([rq.status, rq.taskId, rq.response]).toEqual(['approved', expect.stringMatching(/^T-\d+$/), 'Approved · Marion Kerviel · Fri 25 Sep']);
    expect(await decideResourceRequestAction({ number: 'RQ-043', decision: 'rejected' })).toEqual({ ok: false, error: 'This request has already been decided' });
    expect((await inbox('depthead')).items.map((i) => i.id)).toEqual(['RQ-041']);
    expect((await inbox('depthead')).decided).toBeGreaterThan(0);
  });

  it('Reject keeps the reason the PM sees', async () => {
    expect(await decideResourceRequestAction({ number: 'RQ-041', decision: 'rejected', note: '  Over capacity that week  ' })).toEqual({ ok: true, toast: 'RQ-041 · Rejected' });
    const rq = (await getResourceRequest('RQ-041'))!;
    expect([rq.status, rq.response]).toEqual(['rejected', 'Rejected · Marion Kerviel · Fri 25 Sep — Over capacity that week']);
  });

  it('refuses outside the workspace, bad input, and roles without Approvals', async () => {
    session.outside = true;
    expect(await decideResourceRequestAction({ number: 'RQ-042', decision: 'ok' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    session.outside = false;
    expect(await decideResourceRequestAction({ number: "RQ-042'; --", decision: 'ok' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideResourceRequestAction({ number: 'RQ-042', decision: 'maybe' })).toEqual({ ok: false, error: 'Invalid request' });
    session.role = 'member';
    expect(await decideResourceRequestAction({ number: 'RQ-042', decision: 'ok' })).toEqual({ ok: false, error: 'Read-only — you cannot decide resource requests' });
    expect((await getResourceRequest('RQ-042'))!.status).toBe('pending');
  });
});

describe('forced stage changes (L-1)', () => {
  it('the director approves: the stage is kept, the forced row validated, audited, counted as decided', async () => {
    session.role = 'director';
    await recordStageChange('NDC-031', 'fabrication_assemblage', 'forced', { reason: 'Long-lead switchgear released early', missing: ['x'], requestedByShortName: 'S. Perrin' });
    const [p] = await pending('NDC-031');
    const item = (await inbox('director')).items.find((i) => i.kind === 'stage')!;
    expect(item.decision).toEqual({ mode: 'stage', projectCode: 'NDC-031', transitionId: p.id, fromLabel: 'Approvisionnements' });
    expect(await decideForcedStageChangeAction({ projectCode: 'NDC-031', transitionId: p.id, decision: 'approved', comment: 'Agreed with the client' })).toEqual({
      ok: true, toast: 'NDC-031 · Stage change approved',
    });
    expect((await getProject('NDC-031'))!.stage).toBe('fabrication_assemblage');
    const last = (await getStageHistory('NDC-031')).at(-1)!;
    expect([last.mode, last.stage, last.validationStatus]).toEqual(['forced', 'fabrication_assemblage', 'approved']);
    expect(await pending('NDC-031')).toEqual([]);
    expect(await countForcedStageDecisions('Marie Lefebvre')).toBe(1);
    expect((await inbox('director')).decided).toBe(2); // PO-1078 ordered + this decision
    const [audit] = await listAudit({ projectCode: 'NDC-031', limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual([
      'Marie Lefebvre', 'NDC-031 stage', 'forced stage change approved: Approvisionnements → Fabrication & Assemblage — Agreed with the client', 'Lifecycle',
    ]);
    // Decided: nothing left to decide, a second decision is refused.
    expect(await decideForcedStageChangeAction({ projectCode: 'NDC-031', transitionId: p.id, decision: 'rejected' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
  });

  it('the director rejects: the project goes back to the stage it left (revert row), the PM is notified', async () => {
    session.role = 'director';
    const before = (await getProject('HLT-026'))!.stage;
    const beforeNotes = (await listNotifications('pm')).length;
    await recordStageChange('HLT-026', 'annule', 'forced', { reason: 'Client funding frozen', requestedByShortName: 'R. Aubert' });
    expect((await getProject('HLT-026'))!.stage).toBe('annule');
    const [p] = await pending('HLT-026');
    expect(await decideForcedStageChangeAction({ projectCode: 'HLT-026', transitionId: p.id, decision: 'rejected', comment: 'Funding confirmed this morning' })).toEqual({
      ok: true, toast: 'HLT-026 · Stage change rejected · Reverted to the previous stage',
    });
    expect((await getProject('HLT-026'))!.stage).toBe(before);
    const h = await getStageHistory('HLT-026');
    expect(h.slice(-2).map((x) => [x.mode, x.from, x.stage, x.validationStatus, x.reason])).toEqual([
      ['forced', before, 'annule', 'rejected', 'Client funding frozen'],
      ['revert', 'annule', before, null, 'Funding confirmed this morning'],
    ]);
    // The forcing PM (R. Aubert, persona "pm") hears about it; the director, who decided, does not.
    const notes = await listNotifications('pm');
    expect(notes.length).toBe(beforeNotes + 1);
    expect([notes[0].title, notes[0].sub, notes[0].screen, notes[0].params]).toEqual([
      'Forced stage change rejected', `HLT-026 · Annulé → ${(await getProject('HLT-026'))!.status} · Marie Lefebvre`, 'projects', { q: 'HLT-026' },
    ]);
  });

  it('Reject refuses once the project has moved on; Approve still works', async () => {
    session.role = 'director';
    await recordStageChange('RCF-019', 'annule', 'forced', { reason: 'Stop', requestedByShortName: 'R. Aubert' });
    const [p] = await pending('RCF-019');
    // A later move on the project (seeded data allows any stage here; the DAL does not check TRANS).
    await recordStageChange('RCF-019', 'clos', 'auto');
    expect(await decideForcedStageChangeAction({ projectCode: 'RCF-019', transitionId: p.id, decision: 'rejected' })).toEqual({
      ok: false, error: 'The project has moved to another stage since — it can no longer be reverted from here',
    });
    expect((await getProject('RCF-019'))!.stage).toBe('clos');
    expect(await decideForcedStageChangeAction({ projectCode: 'RCF-019', transitionId: p.id, decision: 'approved' })).toMatchObject({ ok: true });
  });

  it('only the director decides, inside the workspace, on valid input', async () => {
    session.role = 'director';
    await recordStageChange('PRS-038', 'annule', 'forced', { reason: 'Test', requestedByShortName: 'R. Aubert' });
    const [p] = await pending('PRS-038');
    session.role = 'pm';
    expect(await decideForcedStageChangeAction({ projectCode: 'PRS-038', transitionId: p.id, decision: 'approved' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    expect((await inbox('pm')).items.some((i) => i.kind === 'stage')).toBe(false);
    session.role = 'director';
    session.outside = true;
    expect(await decideForcedStageChangeAction({ projectCode: 'PRS-038', transitionId: p.id, decision: 'approved' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    session.outside = false;
    expect(await decideForcedStageChangeAction({ projectCode: 'PRS-038', transitionId: 'not-a-uuid', decision: 'approved' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideForcedStageChangeAction({ projectCode: 'PRS-038', transitionId: p.id, decision: 'later' })).toEqual({ ok: false, error: 'Invalid request' });
    // The id must belong to that project.
    expect(await decideForcedStageChangeAction({ projectCode: 'HLT-026', transitionId: p.id, decision: 'approved' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect(await pending('PRS-038')).toHaveLength(1);
  });

  it('the inbox row of a pending forced change carries inline buttons for the director', async () => {
    const { items, decided } = await inbox('director');
    const html = renderToStaticMarkup(
      h(I18nProvider, { lang: 'en', children: h(MyApprovalsBody, { view: inboxView(items, { decided, roleTitle: 'Portfolio director', filter: 'stage' }), t: makeT('en'), lang: 'en', canDecide: true }) }),
    );
    expect(html).toContain('aria-label="Approve PRS-038"');
    expect(html).toContain('aria-label="Reject PRS-038"');
  });
});
