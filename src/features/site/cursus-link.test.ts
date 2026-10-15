// R-032 (NEW-CURSUS-3 'a'): on the Site's Cursus table, a person whose Cursus row carries a matricule links to that employee
// in Cursus (a proposed parameter Cursus ignores today, so the link must not promise more than opening Cursus); without a
// matricule (the demo and the mock) the name stays plain text, as in the prototype. Reminders are unchanged.
import { createElement as h } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({
  advancePrerequisiteAction: vi.fn(), confirmEquipmentAction: vi.fn(), remindInCursusAction: vi.fn(), syncCursusAction: vi.fn(), saveDailyReportAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }), usePathname: () => '/projects/HLT-026/site' }));

import { sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getSite } from '@/server/dal/site';
import { siteView } from './model';
import { SiteBody } from './site-view';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const render = async (lang: Lang) => {
  const t = makeT(lang);
  const v = siteView('HLT-026', await getSite('HLT-026'), { tab: 'ready' }, t, lang);
  return { v, out: renderToStaticMarkup(h(I18nProvider, { lang, children: h(SiteBody, { code: 'HLT-026', view: v, canEdit: true, t }) })) };
};

describe('R-032 · the person in Cursus', () => {
  it('the seed (names only): no link, the name as plain text', async () => {
    const { v, out } = await render('en');
    expect(v.ready!.cursus.rows.map((r) => r.personUrl)).toEqual([null, null, null, null, null]);
    expect(out).not.toContain('/collaborateurs');
  });

  it('a matricule from Cursus: the name links to /collaborateurs?matricule=… outside Keystone; reminders unchanged', async () => {
    const db = await getDb();
    await db.execute(sql`update cursus_clearances set matricule = 'EMP-0018' where person_name = 'Thomas Kerbrat'`);
    const { v, out } = await render('en');
    const row = v.ready!.cursus.rows.find((r) => r.person === 'Thomas Kerbrat')!;
    expect([row.who, row.personUrl, row.remindable]).toEqual(['Thomas Kerbrat', 'http://localhost:5173/collaborateurs?matricule=EMP-0018', true]);
    expect(v.ready!.cursus.rows.filter((r) => r.personUrl).length).toBe(1);
    expect(out).toMatch(/<a href="http:\/\/localhost:5173\/collaborateurs\?matricule=EMP-0018" target="_blank" rel="noopener noreferrer" class="[^"]*" title="Opens Cursus in a new window">Thomas Kerbrat<\/a>/);
    const fr = await render('fr');
    expect(fr.out).toContain('title="Ouvre Cursus dans une nouvelle fenêtre">Thomas Kerbrat</a>');
  });
});
