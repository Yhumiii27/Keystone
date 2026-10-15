// Delivery 8, lot cost-change — R-140 (X-11 shared): the justification of a change request, as typed, in the Change control drawer
// (every viewer, the client included) and on the client portal's "Waiting for your decision" row (three lines, then "Show more");
// absent when blank. With R-069 / R-081 in the drawer: the contractual impact for everyone, the cost category for the team only.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/changes', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withDerivedStatus } from '@/domain/change-control';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { createChangeRequest, decideChangeStep, getChangeControl } from '@/server/dal/changes';
import { ClientView } from '@/features/rexclient/client-view';
import { getClientScreen } from '@/features/rexclient/screen';
import { CrDrawerBody } from './changes-view';
import { changesT } from './i18n';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function drawer(id: string, lang: Lang, role: 'director' | 'client' = 'director', costCategory: string | null = null) {
  const cc = (await getChangeControl('HLT-026'))!;
  const cr = withDerivedStatus(cc.changeRequests).find((c) => c.id === id)!;
  return html(
    h(CrDrawerBody, {
      cr, code: 'HLT-026', ctx: { bac: cc.bac, contingency: cc.contingency }, role, canEdit: true, planHref: '/plan', budgetHref: '/budget', lang,
      t: changesT(makeT(lang), lang), costCategory,
    }),
    lang,
  );
}
async function portal(lang: Lang) {
  return html(h(ClientView, { code: 'HLT-026', view: await getClientScreen('HLT-026', 'decisions', makeT(lang), lang), can: { decide: true, raise: true }, t: makeT(lang) }), lang);
}

// "Schedule" is a dictionary word (FR "Planning"): typed text must stay as typed.
const SHORT = 'Schedule\nBerth 3 fenders worn out — the port asks for the upgrade now.';
const LONG = Array.from({ length: 6 }, (_, i) => `Line ${i + 1}: the quay wall survey found more corrosion than the tender assumed.`).join('\n');
let shortCr = '';
let longCr = '';

beforeAll(async () => {
  setDb(await openDatabase());
  shortCr = await createChangeRequest('HLT-026', { title: 'Fender upgrade', types: ['budget'], amountKeur: 30, scheduleDays: 0, justification: SHORT, contractImpact: 'price', costCategoryCode: 'C02' }, 'Romain Aubert');
  longCr = await createChangeRequest('HLT-026', { title: 'Quay wall repair', types: ['budget'], amountKeur: 40, scheduleDays: 0, justification: LONG, contractImpact: 'price_dates' }, 'Romain Aubert');
  for (const n of [shortCr, longCr]) {
    await decideChangeStep('HLT-026', n, 'pm', 'ok', 'Romain Aubert');
    await decideChangeStep('HLT-026', n, 'director', 'ok', 'Marie Lefebvre');
  }
}, 60_000);

describe('R-140 — Change control drawer', () => {
  it('the justification as typed (EN and FR, line breaks kept), for the client too; the contractual impact', async () => {
    for (const lang of ['en', 'fr'] as const) {
      const m = await drawer(shortCr, lang);
      expect(m).toContain('>Justification<'); // same word in French
      expect(m).toContain('Schedule\nBerth 3 fenders worn out — the port asks for the upgrade now.');
      expect(text(m)).toContain(lang === 'en' ? 'Contractual impact Contract price' : 'Impact contractuel Prix du contrat');
    }
    expect(await drawer(shortCr, 'en', 'client')).toContain('Berth 3 fenders worn out');
  });

  it('the cost category only when given (the page passes it to the project team only); no section without a justification', async () => {
    expect(text(await drawer(shortCr, 'en', 'director', 'C02 · Materials'))).toContain('Cost category C02 · Materials');
    expect(text(await drawer(shortCr, 'en', 'client'))).not.toContain('Cost category');
    // CR-008 (seed): no justification recorded — no empty section.
    const d8 = await drawer('CR-008', 'en');
    expect(d8).not.toContain('>Justification<');
    expect(text(d8)).toContain('Contractual impact Contract price and dates');
  });
});

describe('R-140 — client portal "Waiting for your decision"', () => {
  it('"Why:" with the text as typed; a long one folds behind "Show more" (EN / FR); none for CR-008 nor the deliverables', async () => {
    const en = await portal('en');
    expect(text(en)).toContain('Why: Schedule Berth 3 fenders worn out');
    expect(en.match(/<details/g)).toHaveLength(1);
    expect(text(en)).toContain('Show more');
    expect(text(en)).toContain('Line 6: the quay wall survey');
    const fr = await portal('fr');
    expect(text(fr)).toContain('Pourquoi : Schedule Berth 3 fenders worn out');
    expect(text(fr)).toContain('Afficher plus');
    // The cost category never reaches the portal.
    expect(text(en)).not.toContain('C02');
    expect(text(en).match(/Why:/g)).toHaveLength(2);
  });
});
