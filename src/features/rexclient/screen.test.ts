// Lessons learned & closure screen on a seeded in-memory database, in English and French, against the prototype's own render
// values (src/domain/rexclient.golden.json, scripts/proto-golden-rexclient.ts). The view model is what the page renders
// (getRexScreen). Deliberate deviations are asserted explicitly: French decimals and the translated criterion labels the
// prototype left in English. D9-06: the client portal screen and its cases were removed (clients never see Keystone).
import { beforeAll, describe, expect, it } from 'vitest';
import { crumbBase, isOutside } from '@/components/app/shell/nav-model';
import { SCREEN_BY_ID, type RoleKey } from '@/config/screens';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import golden from '@/domain/rexclient.golden.json';
import { demoNcrGolden } from '@/domain/vigie-demo';
import { getRexScreen } from './screen';

/* eslint-disable @typescript-eslint/no-explicit-any */
// D13 (CV-07): the prototype's NCR numbers as the demo data set has them (EV-2026-0nn, src/domain/vigie-demo.ts).
const G = demoNcrGolden(golden) as any;

const LANGS: Lang[] = ['en', 'fr'];
const ICON = { done: 'ph ph-check-square', progress: 'ph ph-minus-square', idle: 'ph ph-square' };
const str = (ks: any[]) => ks.map((k) => ({ ...k, value: String(k.value) }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Lessons learned & closure screen', () => {
  it.each(LANGS)('HLT-026 (%s): tiles, lessons, checklist, survey', async (lang) => {
    const v = await getRexScreen('HLT-026', makeT(lang), lang);
    const g = G.rex[lang]['HLT-026'];
    const fr = lang === 'fr';
    expect(v.kpis).toEqual(
      str(g.kpis).map((k: any, i: number) =>
        // French: decimals "4,0" and the criterion translated like the survey rows (the prototype printed "4.0" and "Schedule adherence").
        fr && i === 3 ? { ...k, value: '4,0 / 5', sub: 'plus bas · Respect du planning' } : k,
      ),
    );
    expect(v.lessons.map((l) => ({
      id: l.id, theme: l.theme, what: l.what, impact: l.impact, reco: l.reco, apply: l.apply, status: l.status, stClass: l.tagClass, canAdvance: !!l.next,
      next: l.next?.label ?? g.lessons.find((x: any) => x.id === l.id).next,
    }))).toEqual(g.lessons.map((l: any) => (fr && l.canAdvance ? { ...l, next: l.next === 'Validate' ? 'Valider' : 'Marquer comme appliqué' } : l)));
    expect(v.closure.map((c) => ({ item: c.item, owner: c.owner, status: c.status, icon: ICON[c.mark], color: c.color, textColor: c.textColor }))).toEqual(g.closure);
    expect(v.satisfaction.map((r) => ({ k: r.criterion, v: r.score, w: r.width }))).toEqual(
      g.satisfaction.map((r: any) => (fr ? { ...r, v: r.v.replace('.', ',') } : r)),
    );
    expect(v.satAvg).toBe(fr ? '4,0' : g.satAvg);
  });

  it('a project without REX data: empty lists and "—" tiles', async () => {
    for (const lang of LANGS) {
      const v = await getRexScreen('NDC-031', makeT(lang), lang);
      expect(v.kpis).toEqual(str(G.rex[lang]['NDC-031'].kpis));
      expect([v.lessons, v.closure, v.satisfaction, v.satAvg]).toEqual([[], [], [], '—']);
    }
  });
});

describe('page header (title, crumb, who gets the primary action)', () => {
  it.each(LANGS)('%s: Lessons learned & closure, every role on HLT-026', (lang) => {
    const t = makeT(lang);
    // D9-06: the client portal screen ("My project — client view") and the Client role are gone — the client cases are left out.
    const cases = [{ screen: 'rex' as const, roles: G.rex[lang].roles, crumb: crumbBase('rex'), primary: 'Add lesson' }];
    for (const c of cases)
      for (const [role, h] of (Object.entries(c.roles) as [RoleKey | 'client', any][]).filter(([r]) => r !== 'client') as [RoleKey, any][]) {
        // HLT-026 is owned by the PM persona and the client's organisation, so only the workspace rule applies here; the
        // pages render the primary action when the screen is in the workspace (and, for the REX screen, the project editable).
        expect([t(SCREEN_BY_ID[c.screen].title), t(c.crumb), t(c.primary), isOutside(role, c.screen), !isOutside(role, c.screen)])
          .toEqual([h.title, h.crumb, h.primaryAction, h.outside, h.hasPrimary]);
      }
  });
});
