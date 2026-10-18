// Chapter 4 (S-7, R-3): the DRAFT resource requests drafted by the what-if levelling ("Apply" on a suggested rebalancing,
// "Select scenario → create requests") end to end on the in-memory database, with the real session (persona cookie) and
// project scope: the Requests screen shows them as drafts (no "Sent …", no "Awaiting {head}", not counted as sent) with
// Send / Discard for the viewers allowed; the Server Functions enforce the same rule (requester, project PM or director;
// read-only and outside the workspace refused); Send hands the request to the department head, Discard deletes it.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
const revalidated: string[] = [];
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/resources/requests',
  useRouter: () => ({ push() {}, refresh() {} }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (p: string, type?: string) => revalidated.push(`${p}${type ? ` ${type}` : ''}`) }));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { applySuggestion } from '@/features/resources/actions';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listActivity, listAudit, listNotifications } from '@/server/dal/notifications';
import { createResourceRequest, getDepartmentApprovals, getResourceRequest, listApprovalDepartments, listResourceRequests } from '@/server/dal/requests';
import { getProjectScope } from '@/server/project-context';
import { COOKIE } from '@/server/session';
import { discardDraftRequestAction, sendDraftRequestAction } from './actions';
import { reqT } from './i18n';
import { requestsScreenModel } from './model';
import { canHandleDraft, draftRights } from './permissions';
import { RequestsScreen } from './requests-screen';

const EN = makeT('en');
const FR = makeT('fr');
const PM = PERSONA_BY_ROLE.pm;
const as = (role: RoleKey, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
/** The PM's outbox as the Requests page builds it (rows sent by the viewer, Send / Discard rights from the project scope). */
const outbox = async (lang: 'en' | 'fr' = 'en') => {
  as('pm', lang);
  const rows = await listResourceRequests({ requestedBy: PM.short });
  return requestsScreenModel(rows, null, lang === 'fr' ? FR : EN, lang, PM, draftRights(PM, await getProjectScope()));
};
const engineeringQueue = async () => {
  const d = (await getDepartmentApprovals('Engineering'))!;
  return { pending: d.pending.map((r) => r.id), decided: d.decided.map((r) => r.id) };
};

// HLT-026 levers derived from the seed (src/features/resources/actions.test.ts): both draft an Engineering request.
const CREW = 'extra_resource:A1250:steel-erection-crew';
const RELIEF = 'extra_resource:A1250:julien-wagner';

const NOT_SENDER = 'Read-only — you cannot send resource requests';
const NOT_DRAFTER = 'Read-only — only the requester, the project manager or the director can send or discard this draft';
const NOT_DRAFT = 'This request is no longer a draft';

beforeAll(async () => {
  setDb(await openDatabase());
  // R-084: the relief lever exists when Julien Wagner is above 100 % on the schedules (the named demo assignments, 18 Oct 2026).
}, 60_000);
beforeEach(() => {
  revalidated.length = 0;
});

describe('draft resource requests (S-7)', () => {
  it('what-if "Apply" drafts: listed under All as drafts, not counted as sent, not in the department queue', async () => {
    as('pm');
    expect(await applySuggestion('HLT-026', CREW)).toMatchObject({ ok: true });
    expect(await applySuggestion('HLT-026', RELIEF)).toMatchObject({ ok: true });
    expect((await listResourceRequests({ status: 'draft' })).map((r) => [r.id, r.requestedBy])).toEqual([['RQ-046', 'R. Aubert'], ['RQ-045', 'R. Aubert']]);
    expect((await getResourceRequest('RQ-045'))!.department).toBe('Engineering'); // the crew's extra unit: Marion Kerviel decides

    const m = await outbox();
    // "Requests sent" stays 9 (it read 11 before the fix); All lists the 2 drafts.
    expect(m.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Requests sent', '9', 'Harbor Line · last 2 weeks'],
      ['Awaiting review', '4', '64 h requested'],
      ['Needs your answer', '1', 'Reschedule proposals'],
      ['Approved', '3', 'Now in team members’ lists'],
      ['Avg response', '1.0 d', 'Department heads'],
    ]);
    expect(m.chips.map((c) => `${c.label} ${c.count}`)).toEqual(['All 11', 'Pending 4', 'Reschedule proposed 1', 'Approved 3', 'Rejected / withdrawn 1']);
    const d45 = m.rows.find((r) => r.id === 'RQ-045')!;
    expect(d45).toMatchObject({
      sent: 'Not sent', statusLabel: 'Draft', tagClass: 'tag tag-outline', steps: [false, false, false], stepLabel: 'Not sent to the department yet', response: '—',
      isDraft: true, isPending: false, mine: true, canSendDraft: true,
    });
    expect(m.rows.filter((r) => r.isDraft).map((r) => r.id)).toEqual(['RQ-046', 'RQ-045']);
    // Sent requests are unchanged.
    expect(m.rows.find((r) => r.id === 'RQ-041')).toMatchObject({ sent: 'Sent Thu 24 Sep', response: 'Awaiting Marion Kerviel', isDraft: false, canSendDraft: false });

    const fr = await outbox('fr');
    expect(fr.kpis[0]).toMatchObject({ label: 'Demandes envoyées', value: '9' });
    expect(fr.rows.find((r) => r.id === 'RQ-045')).toMatchObject({ sent: 'Non envoyée', statusLabel: 'Brouillon', stepLabel: 'Pas encore envoyée au service', response: '—' });

    // The department head does not see drafts: queue, decided list and the Approvals badge count are unchanged.
    expect(await engineeringQueue()).toEqual({ pending: ['RQ-043', 'RQ-041'], decided: [] });
    expect((await listApprovalDepartments()).find((d) => d.name === 'Engineering')!.pending).toBe(2);
  });

  it('renders Send / Discard on the drafts only when the viewer may act (FR)', async () => {
    const tt = reqT(FR, 'fr');
    const html = renderToStaticMarkup(createElement(RequestsScreen, { model: await outbox('fr'), filter: null, canAct: true, t: tt }));
    expect(html.match(/>Envoyer</g)?.length).toBe(2);
    expect(html.match(/>Supprimer</g)?.length).toBe(2);
    expect(html.match(/>Brouillon</g)?.length).toBe(2);
    expect(html.match(/>Non envoyée</g)?.length).toBe(2);
    expect(html.match(/>Retirer</g)?.length).toBe(5); // the PM actions on sent requests are unchanged
    expect(html.match(/En attente de Marion Kerviel/g)?.length).toBe(2); // RQ-043 and RQ-041 only, not the drafts
    const ro = renderToStaticMarkup(createElement(RequestsScreen, { model: await outbox('fr'), filter: null, canAct: false, t: tt }));
    expect(ro).not.toContain('>Envoyer<');
    expect(ro).not.toContain('>Supprimer<');
    // Without rights (e.g. another viewer's draft), no buttons either.
    as('pm');
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const none = renderToStaticMarkup(createElement(RequestsScreen, { model: requestsScreenModel(rows, null, FR, 'fr', PM), filter: null, canAct: true, t: tt }));
    expect(none).not.toContain('>Envoyer<');
  });

  it('who may send / discard: requester, project PM or director; read-only and outside the workspace refused', async () => {
    // The director drafts on HLT-026 (R. Aubert's project) and on NDC-031 (not his).
    const onHlt = await createResourceRequest({ projectCode: 'HLT-026', title: 'Night shift crew', activityCode: 'A1250', person: 'Julien Wagner', hours: 16, priority: 'med', draft: true }, PERSONA_BY_ROLE.director.name);
    const onNdc = await createResourceRequest({ projectCode: 'NDC-031', title: 'Survey support', activityCode: 'A1250', contractRole: 'Surveyor', hours: 8, priority: 'low', draft: true }, PERSONA_BY_ROLE.director.name);
    expect([onHlt, onNdc]).toEqual(['RQ-047', 'RQ-048']);

    for (const role of ['member', 'quality', 'client'] as const) {
      as(role);
      expect(await sendDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_SENDER });
      expect(await discardDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_SENDER });
    }
    // Procurement may draft from Resources, but Resource requests is outside its workspace.
    as('procurement');
    expect(await sendDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_SENDER });
    // Neither the requester nor the project's PM.
    for (const role of ['depthead', 'englead'] as const) {
      as(role);
      expect(await sendDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_DRAFTER });
      expect(await discardDraftRequestAction('RQ-047')).toEqual({ ok: false, error: NOT_DRAFTER });
    }
    // NDC-031 is read-only for R. Aubert.
    as('pm');
    expect(await sendDraftRequestAction(onNdc)).toEqual({ ok: false, error: NOT_DRAFTER });
    expect(await discardDraftRequestAction(onNdc)).toEqual({ ok: false, error: NOT_DRAFTER });
    // Input validation and stale states.
    expect(await sendDraftRequestAction('DROP TABLE')).toEqual({ ok: false, error: 'Invalid request' });
    // @ts-expect-error untrusted input
    expect(await discardDraftRequestAction(42)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendDraftRequestAction('RQ-999')).toEqual({ ok: false, error: 'Unknown request' });
    expect(await sendDraftRequestAction('RQ-044')).toEqual({ ok: false, error: NOT_DRAFT }); // his, pending
    expect(await discardDraftRequestAction('RQ-044')).toEqual({ ok: false, error: NOT_DRAFT });
    expect((await listResourceRequests({ status: 'draft' })).map((r) => r.id)).toEqual(['RQ-048', 'RQ-047', 'RQ-046', 'RQ-045']);
    expect(revalidated).toEqual([]);

    // The pure rule.
    const f = { requester: false, projectPm: false, readOnly: false };
    expect(canHandleDraft('director', f)).toBe(true);
    expect(canHandleDraft('pm', { ...f, projectPm: true })).toBe(true);
    expect(canHandleDraft('pm', { ...f, requester: true, readOnly: true })).toBe(false);
    expect(canHandleDraft('depthead', { ...f, requester: true })).toBe(true);
    expect(canHandleDraft('procurement', { ...f, requester: true })).toBe(false);
  });

  it('Send: draft → pending review, sent today, in the department head’s queue, notified, audited', async () => {
    as('pm');
    expect(await sendDraftRequestAction('RQ-045')).toEqual({ ok: true, number: 'RQ-045' });
    expect(revalidated).toEqual(['/ layout']);
    expect(await getResourceRequest('RQ-045')).toMatchObject({
      status: 'pending', statusLabel: 'Pending review', sentText: 'Fri 25 Sep', requestedBy: 'R. Aubert', response: '', department: 'Engineering',
    });
    expect((await getResourceRequest('RQ-045'))!.events.map((e) => [e.action, e.by])).toEqual([['drafted', 'Romain Aubert'], ['sent', 'Romain Aubert']]);
    expect(await engineeringQueue()).toEqual({ pending: ['RQ-045', 'RQ-043', 'RQ-041'], decided: [] });
    expect((await listApprovalDepartments()).find((d) => d.name === 'Engineering')!.pending).toBe(3);
    const { title, resource } = (await getResourceRequest('RQ-045'))!;
    expect((await listNotifications('depthead'))[0]).toMatchObject({ kind: 'request', title: 'New resource request', sub: `${title} · ${resource} · Romain Aubert`, screen: 'approvals' });
    expect((await listAudit()).find((a) => a.object === 'Request RQ-045' && a.change === 'draft → pending review')).toMatchObject({ who: 'Romain Aubert', projectCode: 'HLT-026' });
    expect((await listActivity({ kind: 'request' })).find((a) => a.what.includes('RQ-045'))).toMatchObject({ what: `Sent draft resource request RQ-045 — ${title}`, who: 'Romain Aubert', projectCode: 'HLT-026' });
    expect(await sendDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_DRAFT });

    // Counted as sent now; the row reads as any pending request.
    const m = await outbox();
    expect(m.kpis[0].value).toBe('10');
    expect(m.rows.find((r) => r.id === 'RQ-045')).toMatchObject({ sent: 'Sent Fri 25 Sep', response: 'Awaiting Marion Kerviel', steps: [true, false, false], isDraft: false, isPending: true, canSendDraft: false });

    // The project's PM sends the draft the director prepared on his project (the requester stays the director).
    expect(await sendDraftRequestAction('RQ-047')).toEqual({ ok: true, number: 'RQ-047' });
    expect(await getResourceRequest('RQ-047')).toMatchObject({ status: 'pending', requestedBy: 'M. Lefebvre' });
  });

  it('Discard: the draft is deleted (with its trail), audited; nothing reaches the department', async () => {
    as('director');
    expect(await discardDraftRequestAction('RQ-048')).toEqual({ ok: true, number: 'RQ-048' }); // director, any project
    expect(revalidated).toEqual(['/ layout']);
    expect(await getResourceRequest('RQ-048')).toBeNull();
    expect((await listAudit()).filter((a) => a.object === 'Request RQ-048').map((a) => [a.change, a.who, a.projectCode])).toEqual([
      ['draft discarded', 'Marie Lefebvre', 'NDC-031'], ['drafted', 'Marie Lefebvre', 'NDC-031'],
    ]);
    expect((await listActivity({ kind: 'request' })).find((a) => a.what.includes('RQ-048'))).toMatchObject({ what: 'Discarded draft resource request RQ-048 — Survey support', who: 'Marie Lefebvre' });
    expect(await discardDraftRequestAction('RQ-048')).toEqual({ ok: false, error: 'Unknown request' });
    as('pm');
    expect(await discardDraftRequestAction('RQ-046')).toEqual({ ok: true, number: 'RQ-046' }); // the requester
    expect(await discardDraftRequestAction('RQ-045')).toEqual({ ok: false, error: NOT_DRAFT }); // already sent
    expect(await listResourceRequests({ status: 'draft' })).toEqual([]);
    expect((await outbox()).chips[0].count).toBe(10);
    expect(await engineeringQueue()).toEqual({ pending: ['RQ-047', 'RQ-045', 'RQ-043', 'RQ-041'], decided: [] });
  });
});
