// NEW-D2-2 (Delivery 7, R-062): the "Plan activities" section of the change-request drawer — the links with their
// duration change, the add form for the project team on an open request, nothing for the client.
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/changes', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./activity-actions', () => ({ linkCrActivityAction: vi.fn(), unlinkCrActivityAction: vi.fn() }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChangeRequestLike } from '@/domain/change-control';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { CrDrawerBody } from './changes-view';
import { changesT } from './i18n';

const cr = (status: ChangeRequestLike['status']): ChangeRequestLike => ({
  id: 'CR-008', title: 'Steel erection acceleration — second crew', types: ['schedule'], amount: 85, days: -18, status, by: 'R. Aubert', date: '24 Sep', baseline: 'BL1',
  chain: [{ step: 'pm', decision: 'ok', approver: 'R. Aubert' }, { step: 'director', decision: 'pending', approver: 'M. Lefebvre' }], wbs: [{ code: '1.3', name: 'Steel structure' }],
});
const render = (status: ChangeRequestLike['status'], lang: Lang, acts: { canEdit: boolean; visible: boolean }) =>
  renderToStaticMarkup(h(I18nProvider, {
    lang,
    children: h(CrDrawerBody, {
      cr: cr(status), code: 'HLT-026', ctx: { bac: 4800, contingency: 200 }, role: 'pm', canEdit: true, planHref: '/plan', budgetHref: '/budget', lang, t: changesT(makeT(lang), lang),
      crActivities: {
        byCr: { 'CR-008': [{ code: 'A1250', label: 'A1250 · Steel erection — Bays 3–4', duration: lang === 'fr' ? '20 j → 28 j' : '20d → 28d' }] },
        options: [{ value: 'A1250', label: 'A1250 · Steel erection — Bays 3–4' }, { value: 'A1260', label: 'A1260 · Steel erection — Bays 5–6' }], ...acts,
      },
    }),
  }));

describe('CR drawer › Plan activities (NEW-D2-2)', () => {
  it('lists the links; the project team adds and removes them on an open request', () => {
    const out = render('in_review', 'en', { canEdit: true, visible: true });
    for (const s of ['Plan activities', 'A1250 · Steel erection — Bays 3–4', '20d → 28d', 'aria-label="Remove A1250"', 'Choose an activity', 'A1260 · Steel erection — Bays 5–6', 'aria-label="New duration (working days, optional)"'])
      expect(out, s).toContain(s);
    // An activity already linked is not offered again.
    expect(out.match(/<option value="A1250"/g)).toBeNull();
  });

  it('a decided request is read-only; French labels', () => {
    const out = render('approved', 'fr', { canEdit: true, visible: true });
    for (const s of ['Activités du planning', '20 j → 28 j']) expect(out, s).toContain(s);
    expect(out).not.toContain('Choisissez une activité');
    expect(out).not.toContain('aria-label="Retirer A1250"');
  });

  it('nothing for the client (the plan is internal)', () => {
    const out = render('in_review', 'en', { canEdit: false, visible: false });
    expect(out).not.toContain('Plan activities');
    expect(out).not.toContain('A1250');
  });
});
