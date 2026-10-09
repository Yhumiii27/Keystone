// Chapter 4 — Site › "Client communication log" (Keystone-owned): the Server Functions (rights per persona and project,
// validation, numbering, follow-up ticks, EN / FR texts) and the HSE card's button. In-memory seeded database, mocked session.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }), usePathname: () => '/projects/HLT-026/site' }));
vi.mock('./actions', () => ({}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getSite } from '@/server/dal/site';
import { addClientExchangeAction, loadClientLogAction, setClientFollowUpDoneAction } from './comm-log-actions';
import { siteView } from './model';
import { SiteBody } from './site-view';

const entry = { occurredOn: '2026-09-24', channel: 'phone', direction: 'inbound', contactName: 'Nadia Bensaïd', subject: 'Crane rail delivery window', summary: 'Asks to deliver on 19 Oct.' };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('client communication log — Server Functions', () => {
  it('the director loads an empty log with the form options', async () => {
    const r = await loadClientLogAction('HLT-026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.data.canWrite, r.data.rows, r.data.counts, r.data.today]).toEqual([true, [], '0 exchanges · 0 follow-ups open', '2026-09-25']);
    expect(r.data.channels.map((c) => c.value)).toEqual(['email', 'phone', 'meeting', 'video', 'site_visit', 'letter', 'other']);
    expect(r.data.directions).toEqual([{ value: 'outbound', label: 'To the client' }, { value: 'inbound', label: 'From the client' }]);
    expect(r.data.team).toContain('Romain Aubert');
  });

  it('logs exchanges (validated, numbered per project, audited) and ticks follow-ups', async () => {
    expect(await addClientExchangeAction('HLT-026', { ...entry, subject: ' ' })).toEqual({ ok: false, error: 'Enter a subject' });
    expect(await addClientExchangeAction('HLT-026', { ...entry, followUpOwner: 'Romain Aubert' })).toEqual({ ok: false, error: 'A follow-up needs an owner and a due date' });
    expect(await addClientExchangeAction('HLT-026', { ...entry, followUpOwner: 'Somebody', followUpDueOn: '2026-09-30' })).toEqual({ ok: false, error: 'Choose the follow-up owner in the project team' });
    expect(await addClientExchangeAction('HLT-026', { ...entry, followUpOwner: 'Romain Aubert', followUpDueOn: '2026-09-30' })).toEqual({ ok: true, number: 'COM-001', toast: 'COM-001 · Exchange logged' });
    expect(await addClientExchangeAction('HLT-026', { ...entry, occurredOn: '2026-09-25', channel: 'email', direction: 'outbound', subject: 'Minutes of the site meeting', summary: '' })).toMatchObject({
      ok: true, number: 'COM-002',
    });
    const [audit] = await listAudit({ projectCode: 'HLT-026', limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual(['Marie Lefebvre', 'HLT-026 COM-002', 'client exchange logged: Minutes of the site meeting', 'Client']);
    let r = await loadClientLogAction('HLT-026');
    expect(r.ok && r.data.counts).toBe('2 exchanges · 1 follow-up open');
    expect(r.ok && r.data.rows.map((x) => [x.number, x.date, x.channel, x.direction, x.inbound, x.subject, x.followUp, x.by])).toEqual([
      ['COM-002', '25 Sep 2026', 'E-mail', 'To the client', false, 'Minutes of the site meeting', null, 'Marie Lefebvre'],
      ['COM-001', '24 Sep 2026', 'Phone', 'From the client', true, 'Crane rail delivery window', { owner: 'Romain Aubert', due: '30 Sep', state: 'open' }, 'Marie Lefebvre'],
    ]);
    expect(await setClientFollowUpDoneAction('HLT-026', 'COM-001', true)).toEqual({ ok: true });
    expect(await setClientFollowUpDoneAction('HLT-026', 'COM-002', true)).toEqual({ ok: false, error: 'Unknown exchange' }); // no follow-up
    expect(await setClientFollowUpDoneAction('HLT-026', "COM-1'", true)).toEqual({ ok: false, error: 'Invalid request' });
    r = await loadClientLogAction('HLT-026');
    expect(r.ok && [r.data.counts, r.data.rows[1].followUp?.state]).toEqual(['2 exchanges · 0 follow-ups open', 'done']);
    session.lang = 'fr';
    r = await loadClientLogAction('HLT-026');
    expect(r.ok && [r.data.counts, r.data.rows[1].date, r.data.rows[1].channel, r.data.rows[1].direction]).toEqual(['2 échanges · 0 relance ouverte', '24 sept. 2026', 'Téléphone', 'Reçu du client']);
    expect(await addClientExchangeAction('HLT-026', { ...entry, contactName: '' })).toEqual({ ok: false, error: 'Saisissez le contact client' });
  });

  it('rights: Site editors write; outside viewers and other PMs’ projects read; a client contact sees nothing', async () => {
    session.role = 'pm'; // R. Aubert manages HLT-026, not NDC-031
    expect(((await loadClientLogAction('HLT-026')) as { data: { canWrite: boolean } }).data.canWrite).toBe(true);
    const ndc = await loadClientLogAction('NDC-031');
    expect(ndc.ok && [ndc.data.canWrite, ndc.data.team]).toEqual([false, []]);
    expect(await addClientExchangeAction('NDC-031', entry)).toEqual({ ok: false, error: 'The client communication log is read-only for you' });
    session.role = 'quality'; // Site outside their workspace: read-only
    const q = await loadClientLogAction('HLT-026');
    expect(q.ok && q.data.canWrite).toBe(false);
    expect(await setClientFollowUpDoneAction('HLT-026', 'COM-001', false)).toEqual({ ok: false, error: 'The client communication log is read-only for you' });
    session.role = 'member';
    expect(((await loadClientLogAction('HLT-026')) as { data: { canWrite: boolean } }).data.canWrite).toBe(true);
    session.role = 'client';
    expect(await loadClientLogAction('HLT-026')).toEqual({ ok: false, error: 'The client communication log is not available to you' });
    expect(await addClientExchangeAction('HLT-026', entry)).toEqual({ ok: false, error: 'The client communication log is not available to you' });
    expect(await loadClientLogAction('NOPE-1')).toEqual({ ok: false, error: 'Invalid request' });
  });
});

describe('client communication log — the HSE card button', () => {
  it('is a real button (no coming-soon toast) and is hidden when the page says so (client contact)', async () => {
    const data = await getSite('HLT-026');
    const v = siteView('HLT-026', data, { tab: 'exec' }, makeT('en'), 'en');
    const render = (showCommLog?: boolean) =>
      renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: h(SiteBody, { code: 'HLT-026', view: v, canEdit: false, showCommLog, t: makeT('en') }) as ReactElement }));
    const shown = render();
    expect(shown).toContain('Client communication log');
    expect(shown).toContain('aria-haspopup="dialog"');
    expect(render(false)).not.toContain('Client communication log');
  });
});
