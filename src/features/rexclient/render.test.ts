// Static render of the Lessons learned & closure screen (Server Components + client islands) on the seeded in-memory database:
// the prototype's texts in EN and FR, the edit controls only for the viewers allowed to act (07 OQ14), empty states. D9-06: the
// client portal's render cases were removed with the portal.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/closure', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { recordVerb } from './i18n';
import { RexView } from './rex-view';
import { getRexScreen } from './screen';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function rex(code: string, lang: Lang, canEdit: boolean) {
  return html(h(RexView, { code, view: await getRexScreen(code, makeT(lang), lang), canEdit, t: makeT(lang) }), lang);
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Lessons learned & closure render', () => {
  it('EN: tiles, table headers, rows, checklist buttons, survey', async () => {
    const m = await rex('HLT-026', 'en', true);
    const x = text(m);
    for (const s of ['Lessons recorded', '1 applied to templates & procedures', '25 %', '4.0 / 5', 'lowest · Schedule adherence', 'Lessons learned', 'What happened',
      'Applies to', 'LL-04', 'Validate', 'Mark applied', 'Closure checklist', 'Click to cycle · not started → in progress → done', 'Final account agreed with client',
      'Customer satisfaction', 'Survey · 5 criteria', 'Schedule adherence', '3.0'])
      expect(x).toContain(s);
    expect(m.match(/<button[^>]*class="[^"]*clRow/g)?.length).toBe(10);
    expect(m.match(/>Mark applied</g)?.length).toBe(2);
    expect(m).toContain('width:90%');
  });

  it('FR and read-only: translated labels, no buttons', async () => {
    const m = await rex('HLT-026', 'fr', false);
    const x = text(m);
    for (const s of ['REX enregistrés', 'Retours d’expérience', 'Ce qui s’est passé', 'Checklist de clôture', 'Décompte final accepté par le client', 'Satisfaction client', '4,0', 'Respect du planning'])
      expect(x).toContain(s);
    expect(m).not.toContain('<button');
  });

  it('a project without data: empty-state lines', async () => {
    const x = text(await rex('NDC-031', 'en', true));
    for (const s of ['No lesson recorded for this project yet', 'No closure checklist for this project yet', 'Survey not received yet', 'survey not received']) expect(x).toContain(s);
  });
});

describe('Add lesson learned form', () => {
  it('"Add lesson learned" submit is the verb ("Enregistrer"), not the dictionary noun "Fiche"', () => {
    expect([recordVerb('en'), recordVerb('fr'), makeT('fr')(recordVerb('fr'))]).toEqual(['Record', 'Enregistrer', 'Enregistrer']);
  });
});
