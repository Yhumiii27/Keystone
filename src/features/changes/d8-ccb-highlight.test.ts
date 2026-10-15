// Integration review of delivery 8 (R-069 / P-6c): the drawer's Budget row is highlighted when |amount| is over the change
// control board threshold in force (Settings), the same rule as the board step (`requiredSteps`) — no longer the
// prototype's fixed `amt > 50`. Pure rule, then the Change control screen passing the Settings value to the drawer.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/changes', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LO, OK } from '@/components/app/tones';
import { crImpact, DEFAULT_CCB_THRESHOLD_KEUR, requiredSteps, withDerivedStatus, type ChangeRequestLike } from '@/domain/change-control';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getChangeControl, type ChangeControl } from '@/server/dal/changes';
import { ChangesView, CrDrawerBody } from './changes-view';
import { changesT } from './i18n';

const ctx = { bac: 4800, contingency: 150 };
const budgetLo = (cr: ChangeRequestLike, ccbThresholdKeur?: number) => crImpact(cr, { ...ctx, ccbThresholdKeur }, 'en')[0].lo;
const boardStep = (amountKeur: number, ccbThresholdKeur: number) => requiredSteps({ contractImpact: 'price', amountKeur, ccbThresholdKeur }).ccb;

describe('drawer Budget highlight = board threshold (R-069, P-6c)', () => {
  let hlt: ChangeControl;
  let base: ChangeRequestLike;
  beforeAll(async () => {
    setDb(await openDatabase());
    hlt = (await getChangeControl('HLT-026'))!;
    base = withDerivedStatus(hlt.changeRequests).find((c) => c.id === 'CR-008')!;
  }, 60_000);

  it('threshold 100 k€: +60 k€ not highlighted (no board step), −120 k€ highlighted (board step)', () => {
    expect([budgetLo({ ...base, amount: 60 }, 100), boardStep(60, 100)]).toEqual([false, 'na']);
    expect([budgetLo({ ...base, amount: -120 }, 100), boardStep(-120, 100)]).toEqual([true, 'pending']);
    expect([budgetLo({ ...base, amount: 100 }, 100), boardStep(100, 100)]).toEqual([false, 'na']); // "au-delà": strictly over
  });

  it('without a usable threshold: the 50 k€ default (the prototype’s highlight for the seeded positive requests)', () => {
    expect(DEFAULT_CCB_THRESHOLD_KEUR).toBe(50);
    expect([budgetLo({ ...base, amount: 85 }), budgetLo({ ...base, amount: 15 }), budgetLo({ ...base, amount: -60 })]).toEqual([true, false, true]);
    for (const bad of [Number.NaN, -1, 2_000_000]) expect(budgetLo({ ...base, amount: 60 }, bad)).toBe(true);
  });

  it('the Change control screen gives the drawer the Settings threshold; the drawer body highlights by it', () => {
    const data = { crs: withDerivedStatus(hlt.changeRequests), baselines: hlt.baselines, originalBudget: hlt.originalBudget, bac: hlt.bac, contingency: hlt.contingency };
    const t = changesT(makeT('en'), 'en');
    // The drawer is a client portal (absent from static markup): read the ctx ChangesView hands it from the element tree.
    const drawerCtx = (ccbThresholdKeur?: number): { ccbThresholdKeur?: number } | undefined => {
      const tree = ChangesView({ code: 'HLT-026', data, filter: 'all', selected: 'CR-008', role: 'director', canEdit: true, href: () => '/c', planHref: '/plan', budgetHref: '/budget', lang: 'en', t, ccbThresholdKeur });
      const walk = (node: unknown): { ccbThresholdKeur?: number } | undefined => {
        if (Array.isArray(node)) return node.map(walk).find(Boolean);
        if (!isValidElement(node)) return undefined;
        const props = node.props as { ctx?: { ccbThresholdKeur?: number }; children?: unknown };
        return props.ctx ?? walk(props.children);
      };
      return walk(tree);
    };
    expect(drawerCtx(100)).toMatchObject({ bac: hlt.bac, ccbThresholdKeur: 100 });
    expect(drawerCtx()?.ccbThresholdKeur).toBeUndefined();
    // CR-008 (+€85k): highlighted at the 50 k€ default, not with a 100 k€ threshold.
    const body = (ccbThresholdKeur?: number) =>
      renderToStaticMarkup(h(I18nProvider, {
        lang: 'en',
        children: h(CrDrawerBody, { cr: base, code: 'HLT-026', ctx: { bac: hlt.bac, contingency: hlt.contingency, ccbThresholdKeur }, role: 'director', canEdit: true, planHref: '/plan', budgetHref: '/budget', lang: 'en', t }),
      }));
    const budgetColor = (markup: string) => /--kv-color:([^"]+)"[^>]*>\+€85k → BAC/.exec(markup)?.[1];
    expect([budgetColor(body()), budgetColor(body(50)), budgetColor(body(100))]).toEqual([LO, LO, OK]);
  });
});
