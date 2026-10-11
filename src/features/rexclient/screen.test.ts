// Lessons learned & closure and client portal screens on a seeded in-memory database, in English and French, against
// the prototype's own render values (src/domain/rexclient.golden.json, scripts/proto-golden-rexclient.ts). The view
// models are what the pages render (getRexScreen / getClientScreen). Deliberate deviations are asserted explicitly:
// the contract billing plan instead of the static BILLING rows (A-5), issues scoped per project (11 §7 #22), French
// decimals and the translated criterion / step labels / deliverable types the prototype left in English.
import { beforeAll, describe, expect, it } from 'vitest';
import { crumbBase, isOutside } from '@/components/app/shell/nav-model';
import { SCREEN_BY_ID, type RoleKey } from '@/config/screens';
import { makeT, type Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContract } from '@/server/dal/contract';
import golden from '@/domain/rexclient.golden.json';
import { getClientScreen, getRexScreen } from './screen';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
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

describe('client portal screen', () => {
  it.each(LANGS)('HLT-026 (%s): tiles, tabs, progress, milestones, decisions', async (lang) => {
    const t = makeT(lang);
    const v = await getClientScreen('HLT-026', 'decisions', t, lang);
    const g = G.client[lang]['HLT-026'];
    expect(v.kpis).toEqual(str(g.kpis));
    // S-9a: "Schedule" (FR "Planning") added after the prototype's first segment.
    expect(v.tabs.map((o) => o.label)).toEqual([g.seg[0], t('Schedule'), ...g.seg.slice(1)]);
    expect(v.tabs.map((o) => o.href)).toEqual(['', 'planning', 'decisions', 'invoices', 'issues', 'docs'].map((x) => `/projects/HLT-026/client${x ? `?tab=${x}` : ''}`));
    expect(v.progress).toEqual(g.progress);
    expect(v.milestones).toEqual(g.milestones);
    // Deliverable types the prototype left in English are translated by the shared dictionary when it has them.
    const typeFr = (sub: string) => (lang === 'fr' ? sub.replace(/^[^·]+ · /, (m) => `${t(m.slice(0, -3))} · `) : sub);
    expect(v.decisions.map((d) => ({ kind: d.kindLabel, id: d.id, title: d.title, sub: d.sub, when: d.when, approveLabel: d.approveLabel })))
      .toEqual(g.decisions.map((d: any) => (d.id.startsWith('D-') ? { ...d, sub: typeFr(d.sub) } : d)));
    expect(v.decided).toEqual(g.decided);
  });

  it.each(LANGS)('HLT-026 (%s): invoices and contract summary follow the contract billing plan (A-5)', async (lang) => {
    const t = makeT(lang);
    const v = await getClientScreen('HLT-026', 'invoices', t, lang);
    const c = (await getContract('HLT-026'))!;
    const g = G.client[lang]['HLT-026'];
    // Delivery 7, NEW-D3-3 (R-079): the signed Amendment 1's own milestone M6 is billable and listed after M5 (planned).
    const planned = g.invoices[g.invoices.length - 1];
    expect(v.invoices.map((i) => [i.status, i.tagClass])).toEqual([...g.invoices, planned].map((i: any) => [i.status, i.tagClass]));
    expect(v.invoices.map((i) => [i.no, i.amount])).toEqual(
      c.milestones.filter((m) => m.billable).map((m, k) => [['INV-2026-001', 'INV-2026-002', 'INV-2026-003'][k] ?? '—', money(m.amountKeur, lang)]),
    );
    if (lang === 'en') expect(v.invoices[5].name).toBe('M6 Anti-collision lidar commissioned');
    expect(v.invoices.map((i) => i.payment)).toEqual(
      lang === 'en'
        ? ['Settled', 'Settled', 'Due 10 Nov', 'On milestone', 'On milestone', 'On milestone']
        : ['Réglée', 'Réglée', 'Échéance 10 nov.', 'Au jalon', 'Au jalon', 'Au jalon'],
    );
    expect(v.invoices[2].name).toBe(lang === 'en' ? 'M3 Structure topped out' : 'M3 Structure hors d’eau');
    expect(v.summary!.map((r) => r.k)).toEqual(g.invKpis.map((r: any) => r.k));
    expect(v.summary!.map((r) => r.v)).toEqual([money(c.valueKeur, lang), money(c.invoicedKeur, lang), money(c.paidKeur, lang), g.invKpis[3].v]);
    expect([v.invoicesEmpty, v.summaryEmpty]).toEqual([null, null]);
  });

  it.each(LANGS)('HLT-026 (%s): issues and shared documents (Codex index)', async (lang) => {
    const v = await getClientScreen('HLT-026', 'docs', makeT(lang), lang);
    const g = G.client[lang]['HLT-026'];
    expect(v.issues.map((i) => ({ id: i.id, title: i.title, when: i.when, status: i.status, resp: i.response, tagClass: i.tagClass }))).toEqual(g.issues);
    expect(v.docs.map((d) => ({
      id: d.id, title: d.title, typeLabel: d.typeLabel, date: d.date, rev: d.rev, status: d.status, stClass: d.tagClass, ack: d.acknowledged, canAck: !d.acknowledged, ackLabel: d.ackLabel,
    }))).toEqual(g.docs);
    // 03 OQ2 / A.3: real labels instead of the engineering register's "Column mapping" / "Deliverables" / "Own documents · …".
    expect(v.docsLabels).toEqual(lang === 'en'
      ? { idHeader: 'Reference', sub: 'Released documents shared with you', empty: 'No document shared with you yet' }
      : { idHeader: 'Référence', sub: 'Documents diffusés partagés avec vous', empty: 'Aucun document partagé avec vous pour l’instant' });
  });

  it('NDC-031: generated data; issues are per project (the prototype listed Harbor Line’s issues everywhere)', async () => {
    const v = await getClientScreen('NDC-031', 'progress', makeT('en'), 'en');
    const g = G.client.en['NDC-031'];
    expect(v.kpis.slice(0, 4)).toEqual(str(g.kpis).slice(0, 4));
    expect(v.kpis[4]).toEqual({ ...g.kpis[4], value: '0' });
    expect(v.issues).toEqual([]);
    expect(v.progress).toEqual(g.progress);
    expect(v.milestones).toEqual(g.milestones);
    expect(v.decisions.map((d) => [d.id, d.sub, d.when])).toEqual(g.decisions.map((d: any) => [d.id, d.sub, d.when]));
    expect(v.decided).toEqual(g.decided);
    // Legacy monthly plan: no invoice numbers or due dates are recorded ("F-2026-104" / "Due 15 Oct" were static).
    expect(v.invoices.map((i) => [i.no, i.name, i.amount, i.status, i.payment])).toEqual(g.invoices.map((i: any) => ['—', i.name, i.amt, i.status, i.status === 'Invoiced' ? '—' : i.due]));
    expect(v.summary!.map((r) => r.v)).toEqual(g.invKpis.map((r: any) => r.v));
    expect(v.docs.map((d) => [d.id, d.acknowledged])).toEqual(g.docs.map((d: any) => [d.id, d.ack]));
  });

  it('projects without data: empty states, no Harbor Line fallback (00 §7.16)', async () => {
    const v = await getClientScreen('EWA-051', 'progress', makeT('en'), 'en');
    expect(v.kpis.map((k) => k.value)).toEqual(['—', '—', '—', '0', '0']);
    expect([v.progress, v.milestones, v.decisions, v.decided, v.invoices, v.issues, v.docs]).toEqual([null, [], [], [], [], [], []]);
    expect([v.invoicesEmpty, v.summaryEmpty]).toEqual(['No billing plan for this project yet', 'No contract recorded for this project']);
    // Internal project (contract value 0): the prototype's empty invoice list and €0k contract summary.
    for (const lang of LANGS) {
      const internal = await getClientScreen('ERP-202', 'invoices', makeT(lang), lang);
      expect([internal.invoices, internal.invoicesEmpty, internal.summaryEmpty]).toEqual([[], makeT(lang)('Internal project — no client billing'), null]);
      expect(internal.summary).toEqual(lang === 'en'
        ? [{ k: 'Contract value', v: '€0k' }, { k: 'Invoiced', v: '€0k' }, { k: 'Paid', v: '€0k' }, { k: 'Approved changes', v: '—' }]
        : [{ k: 'Montant du contrat', v: '0 k€' }, { k: 'Facturé', v: '0 k€' }, { k: 'Payé', v: '0 k€' }, { k: 'Modifications approuvées', v: '—' }]);
    }
  });
});

describe('page header (title, crumb, who gets the primary action)', () => {
  it.each(LANGS)('%s: Lessons learned & closure and My project — client view, every role on HLT-026', (lang) => {
    const t = makeT(lang);
    const cases = [
      { screen: 'rex' as const, roles: G.rex[lang].roles, crumb: crumbBase('rex'), primary: 'Add lesson' },
      { screen: 'client' as const, roles: G.client[lang].roles, crumb: `${crumbBase('client')} · read-only except decisions and issues`, primary: 'Download status report' },
    ];
    for (const c of cases)
      for (const [role, h] of Object.entries(c.roles) as [RoleKey, any][]) {
        // HLT-026 is owned by the PM persona and the client's organisation, so only the workspace rule applies here; the
        // pages render the primary action when the screen is in the workspace (and, for the REX screen, the project editable).
        expect([t(SCREEN_BY_ID[c.screen].title), t(c.crumb), t(c.primary), isOutside(role, c.screen), !isOutside(role, c.screen)])
          .toEqual([h.title, h.crumb, h.primaryAction, h.outside, h.hasPrimary]);
      }
  });
});
