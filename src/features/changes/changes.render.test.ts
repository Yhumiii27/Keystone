// Change control & Trends: DAL integration (in-memory PGlite seeded from the prototype) + static render of both
// screens, checked against the prototype's displayed values (docs/spec/07 §2.2, docs/spec/04 §2.4).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/changes', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withDerivedStatus, type CrFilter } from '@/domain/change-control';
import { parseTrendKey, type TrendKey } from '@/domain/trends';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getChangeControl, type ChangeControl } from '@/server/dal/changes';
import { getBaselineRegister } from '@/server/dal/changes-baselines';
import { getTrends, type Trends } from '@/server/dal/trends';
import { ChangesView, CrDrawerBody, type ChangesViewData } from './changes-view';
import { changesT } from './i18n';
import { TrendsView } from './trends-view';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const viewData = (cc: ChangeControl): ChangesViewData => ({
  crs: withDerivedStatus(cc.changeRequests), baselines: cc.baselines, originalBudget: cc.originalBudget, bac: cc.bac, contingency: cc.contingency,
});
const href = (q: { filter?: CrFilter; cr?: string | null }) => `/c?filter=${q.filter ?? 'all'}&cr=${q.cr ?? ''}`;

function changes(cc: ChangeControl, lang: Lang, opts: { filter?: CrFilter; selected?: string | null; role?: 'director' | 'pm' | 'client' | 'quality'; canEdit?: boolean } = {}) {
  return html(
    h(ChangesView, {
      code: cc.projectCode, data: viewData(cc), filter: opts.filter ?? 'all', selected: opts.selected ?? null, role: opts.role ?? 'director', canEdit: opts.canEdit ?? true,
      href, planHref: '/plan', budgetHref: '/budget', lang, t: changesT(makeT(lang), lang),
    }),
    lang,
  );
}

function drawer(cc: ChangeControl, id: string, lang: Lang, role: 'director' | 'pm' | 'client' | 'quality' = 'director', canEdit = true) {
  const cr = viewData(cc).crs.find((c) => c.id === id)!;
  return html(
    h(CrDrawerBody, { cr, code: cc.projectCode, ctx: { bac: cc.bac, contingency: cc.contingency }, role, canEdit, planHref: '/plan', budgetHref: '/budget', lang, t: changesT(makeT(lang), lang) }),
    lang,
  );
}

function trends(tr: Trends, lang: Lang, selected: TrendKey = 'cpi') {
  return html(
    h(TrendsView, {
      data: { snapshots: tr.snapshots, series: tr.series, bac: tr.bac, contingency: tr.contingency, nextReport: tr.nextReport?.text ?? null },
      selected, href: (k: TrendKey) => `/t?kpi=${k}`, lang, t: changesT(makeT(lang), lang),
    }),
    lang,
  );
}

describe('Change control & baselines', () => {
  let hlt: ChangeControl;
  beforeAll(async () => {
    setDb(await openDatabase());
    hlt = (await getChangeControl('HLT-026'))!;
  }, 180_000);

  it('DAL: HLT-026 register (HLT_CRS_X + CR-005), approvers follow the project, BL0–BL2', async () => {
    expect(hlt.changeRequests.map((c) => [c.id, c.status])).toEqual([
      ['CR-004', 'approved'], ['CR-006', 'approved'], ['CR-007', 'approved'], ['CR-008', 'in_review'], ['CR-009', 'draft'], ['CR-005', 'rejected'],
    ]);
    expect(hlt.changeRequests[3].chain.map((s) => s.approver)).toEqual(['Romain Aubert', 'Marie Lefebvre', 'Nadia Bensaïd', 'Marie Lefebvre']);
    expect([hlt.originalBudget, hlt.bac, hlt.contingency]).toEqual([4600, 4800, 150]);
    expect(hlt.baselines.map((b) => [b.code, b.setOn, b.state])).toEqual([
      ['BL0', '18 Jan 2026', 'superseded'], ['BL1', '12 Mar 2026', 'current'], ['BL2', 'Pending CR-009', 'proposed'],
    ]);
    expect((await getChangeControl('EWA-051'))!.changeRequests).toEqual([]);
  });

  it('baseline register: recorded rows for HLT-026, the approved BL1 of the project controls elsewhere, none without data', async () => {
    expect(await getBaselineRegister('HLT-026')).toEqual(hlt.baselines);
    expect(await getBaselineRegister('NDC-031')).toEqual([
      { code: 'BL1', name: 'Approved baseline', setOn: '9 Apr 2026', setOnDate: '2026-04-09', bac: 2100, finish: '1 Apr 2027', finishDate: '2027-04-01', state: 'current', stateLabel: 'Current', changeRequest: null },
    ]);
    expect(await getBaselineRegister('EWA-051')).toEqual([]);
    const ndc = (await getChangeControl('NDC-031'))!;
    const tx = text(changes({ ...ndc, baselines: await getBaselineRegister('NDC-031') }, 'en'));
    expect(tx).toContain('Approved budget changes — BL1 €2.10M → BAC €2.10M');
    expect(tx).toContain('Baseline BL1 Approved baseline · 9 Apr 2026');
    expect(tx).toContain('BL1 Approved baseline 9 Apr 2026 €2.10M 1 Apr 2027 Current');
    expect(tx).not.toContain('CR-009');
  });

  it('EN: KPI row, chips, register rows and baselines as the prototype', () => {
    const tx = text(changes(hlt, 'en'));
    expect(tx).toContain('Change requests 6 1 in review · 1 draft');
    expect(tx).toContain('Approved budget changes +€200k BL1 €4.60M → BAC €4.80M');
    // Deviation P-6b (delivery 8, R-069): the sub-line names the step CR-008 waits for (the prototype's fixed step list).
    expect(tx).toContain('Pending value +€85k Awaiting director');
    expect(tx).not.toContain('Awaiting director · client · CCB');
    expect(tx).toContain('Schedule changes 2 Net 27 d on handover');
    expect(tx).toContain('Baseline BL1 BL2 proposed · CR-009 draft');
    expect(tx).toContain('Type All 6 Budget 4 Scope 3 Schedule 2');
    expect(tx).toContain('CR-008 Second steel crew — schedule recovery R. Aubert · 24 Sep Budget · Schedule +€85k -12 d 1.4 BL2 Project Portfolio Client Change In review');
    expect(tx).toContain('CR-009 Re-baseline BL2 — handover 14 Jan 2027 R. Aubert · 25 Sep Schedule — +27 d 1 BL2');
    // CR-005 has no WBS allocation in the Budget dataset: dash, like the drawer's "WBS impacted"
    expect(tx).toContain('CR-005 Value engineering — paving thickness Client · 11 Jun Budget −€40k — — BL1');
    expect(tx).toContain('BL2 Recovery re-baseline Pending CR-009 €4.88M 14 Jan 2027 Proposed'); // (4.885).toFixed(2)
    expect(tx).toContain('A re-baseline is itself a change request — BL2 becomes current when CR-009 is approved');
    // exactly one "Submit for review" (CR-009 is the only draft)
    expect(tx.match(/Submit for review/g)).toHaveLength(1);
  });

  it('FR: translated labels, register header "Demande", French day unit', () => {
    const tx = text(changes(hlt, 'fr'));
    expect(tx).toContain('Demandes de modification 6 1 en revue · 1 brouillon');
    expect(tx).toContain('Modifications budgétaires approuvées +200 k€ BL1 4,60 M€ → BAC 4,80 M€');
    expect(tx).toContain('Net 27 j sur le transfert'); // NEW-D5-3 'a' (R-156): « Transfert », not « livraison »
    expect(tx).toContain('BL2 proposée · CR-009 brouillon');
    expect(tx).toContain('Demande Type Budget Planning WBS Référence Chaîne d’approbation Statut');
    expect(tx).toContain('+85 k€ -12 j');
    expect(tx).toContain('Seconde équipe charpente — rattrapage du planning R. Aubert · 24 sept.');
    expect(tx).toContain('Soumettre en revue');
    expect(tx).toContain('Nouvelle référence de rattrapage En attente de CR-009 4,88 M€ 14 janv. 2027 Proposée');
    expect(tx).toContain('Référence approuvée 12 mars 2026 4,60 M€ 18 déc. 2026 Actuel');
  });

  it('filter, selected id colour, read-only hides the row action, empty states', async () => {
    const sched = text(changes(hlt, 'en', { filter: 'schedule' }));
    expect(sched).toContain('CR-008');
    expect(sched).not.toContain('CR-004');
    expect(changes(hlt, 'en', { selected: 'CR-008' })).toMatch(/reqIdOn[^>]*>CR-008/);
    // chain indicators expose their state to assistive technologies
    const m = changes(hlt, 'en');
    expect(m).toContain('role="img" aria-label="Portfolio director · Pending"');
    expect(m).toContain('aria-label="Client / sponsor · Not required"');
    expect(changes(hlt, 'fr')).toContain('aria-label="Directrice de portefeuille · En attente"');
    expect(text(changes(hlt, 'en', { canEdit: false }))).not.toContain('Submit for review');
    const empty = text(changes((await getChangeControl('EWA-051'))!, 'en'));
    expect(empty).toContain('Change requests 0 0 in review · 0 draft');
    expect(empty).toContain('Baseline — No baseline yet');
    expect(empty).toContain('No change request of this type');
    expect(empty).toContain('No baseline recorded for this project yet');
    expect(empty).toContain('A re-baseline is itself a change request');
  });

  it('drawer: impact, approval chain, decisions only for the step owner, hints and actions', () => {
    const d8 = text(drawer(hlt, 'CR-008', 'en'));
    expect(d8).toContain('Raised by R. Aubert · 24 Sep');
    expect(d8).toContain('Impact Budget +€85k → BAC €4.88M Schedule -12 days on handover WBS impacted 1.4 · Steel structure Baseline Requires re-baseline → BL2 Contingency Funded from contingency · 57% of reserve');
    expect(d8).toContain('Project manager Romain Aubert Approved');
    // the director decides the director step — and only it: the board's step waits for the client (P-6b, R-069)
    expect(d8).toContain('Portfolio director Marie Lefebvre Reject Approve Pending');
    expect(d8).toContain('Client / sponsor Nadia Bensaïd Pending');
    // R-169, P-6a: the director records the CCB decision (the prototype printed the cadence "Monthly · next 8 Oct").
    // Deviation P-6b (R-069): no decision buttons on the board's step before the client decided.
    expect(d8).toContain('Change control board Marie Lefebvre Pending');
    expect(d8.match(/\bApprove\b/g)).toHaveLength(1);
    expect(d8).toContain('Open plan Open budget');
    // decision buttons name their step for screen readers
    expect(drawer(hlt, 'CR-008', 'en')).toContain('aria-label="Approve · Portfolio director"');
    expect(drawer(hlt, 'CR-008', 'fr')).toContain('aria-label="Refuser · Directrice de portefeuille"');
    // P-6b: the client's step waits for the director's — no buttons, the hint says what it waits for.
    const asClient = text(drawer(hlt, 'CR-008', 'en', 'client'));
    expect(asClient).toContain('Client / sponsor Nadia Bensaïd Pending');
    expect(asClient).not.toMatch(/\bApprove\b/);
    expect(asClient).toContain('Waiting for Portfolio director');
    expect(text(drawer(hlt, 'CR-008', 'fr', 'client'))).toContain('En attente de la directrice de portefeuille');
    // Once the director approved: the client decides, then the board.
    const step = (cc: ChangeControl, s: string) => ({
      ...cc, changeRequests: cc.changeRequests.map((c) => (c.id === 'CR-008' ? { ...c, chain: c.chain.map((x) => (x.step === s ? { ...x, decision: 'ok' as const } : x)) } : c)),
    });
    const afterDirector = step(hlt, 'director');
    const clientNow = text(drawer(afterDirector, 'CR-008', 'en', 'client'));
    expect(clientNow).toContain('Client / sponsor Nadia Bensaïd Reject Approve Pending');
    expect(clientNow.match(/\bApprove\b/g)).toHaveLength(1);
    expect(text(drawer(afterDirector, 'CR-008', 'en', 'client', false))).not.toMatch(/\bApprove\b/);
    expect(text(drawer(afterDirector, 'CR-008', 'en'))).toContain('Waiting for Client / sponsor');
    const board = drawer(step(afterDirector, 'client'), 'CR-008', 'en');
    expect(text(board)).toContain('Change control board Marie Lefebvre Reject Approve Pending');
    expect(board).toContain('aria-label="Approve · Change control board"');
    expect(text(drawer(hlt, 'CR-008', 'en', 'quality'))).toContain('Switch to Project manager, Portfolio director or Client (bottom-left) to decide.');
    const d9 = text(drawer(hlt, 'CR-009', 'en'));
    expect(d9).toContain('Submit the request to start the approval chain.');
    expect(d9).toContain('Submit for review Open plan');
    expect(d9).not.toContain('Reject');
    // read-only / outside: neither the Submit button nor the instruction to submit
    const d9ro = text(drawer(hlt, 'CR-009', 'en', 'quality', false));
    expect(d9ro).not.toContain('Submit');
    expect(d9ro).toContain('Open plan Open budget');
    const d7 = text(drawer(hlt, 'CR-007', 'en'));
    expect(d7).toContain('Client / sponsor Nadia Bensaïd Not required');
    // CR-005: chain not recorded in the dataset
    expect(text(drawer(hlt, 'CR-005', 'en'))).toContain('Client / sponsor Nadia Bensaïd —');
    const fr = text(drawer(hlt, 'CR-008', 'fr'));
    expect(fr).toContain('Émise par R. Aubert · 24 sept.');
    expect(fr).toContain('Financé par la provision · 57 % de la réserve');
    // R-169, P-6a: the CCB line names the director who records the decision (the prototype printed "Monthly · next 8 Oct");
    // P-6b (R-069): no buttons before the client decided.
    expect(fr).toContain('Comité de contrôle des modifications Marie Lefebvre En attente');
  });
});

describe('Trends & status report', () => {
  let hlt: Trends;
  beforeAll(async () => {
    setDb(await openDatabase());
    hlt = (await getTrends('HLT-026'))!;
  }, 180_000);

  it('DAL: 13 weekly snapshots W27–W39, BAC, contingency, next report 2 Oct; none without data', async () => {
    expect(hlt.snapshots.map((s) => s.week)).toEqual(['W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37', 'W38', 'W39']);
    expect(hlt.snapshots.map((s) => s.dateText).slice(0, 2)).toEqual(['3 Jul', '10 Jul']);
    expect(hlt.series.float.at(-1)).toBe(-27);
    expect([hlt.bac, hlt.contingency, hlt.nextReport?.text]).toEqual([4800, 150, '2 Oct']);
    expect((await getTrends('NDC-031'))!.snapshots).toHaveLength(13);
    expect(await getTrends('EWA-051')).toBeNull();
  });

  it('EN: KPI row, cards, chart header, history (newest first)', () => {
    const tx = text(trends(hlt, 'en'));
    expect(tx).toContain('Snapshots 13 Weekly · Fridays · since 3 Jul');
    expect(tx).toContain('CPI trend −0.01 Last 4 weeks');
    expect(tx).toContain('EAC drift +€386k Since first snapshot');
    expect(tx).toContain('Float lost -31 d W27 → W39');
    expect(tx).toContain('Next status report 2 Oct One-page PDF + live dashboard link');
    expect(tx).toContain('CPI ≥ 1.00 0.92 −0.01 · 4 wk');
    expect(tx).toContain('EAC BAC €4.80M €5.24M +€76k · 4 wk');
    expect(tx).toContain('Critical-path float ≥ 0 −27 d −9 d · 4 wk');
    expect(tx).toContain('Risk exposure (EMV) Contingency €150k €340k +€50k · 4 wk');
    expect(tx).toContain('Milestone slip 0 d 39 d +13 d · 4 wk');
    expect(tx).toContain('CPI — 13 weekly snapshots Status date every Friday · dashed line = target ≥ 1.00');
    expect(tx).toContain('W39 25 Sep 0.92 0.90 €5.24M −27 d €340k 39 d');
    expect(tx.indexOf('W39 25 Sep')).toBeLessThan(tx.indexOf('W27 3 Jul'));
  });

  it('selected indicator, chart geometry, FR', () => {
    const m = trends(hlt, 'en', parseTrendKey('float'));
    expect(text(m)).toContain('Critical-path float — 13 weekly snapshots');
    expect(m).toContain('aria-current="true"');
    expect(m).toContain('stroke-dasharray="5 4"');
    expect(m).toMatch(/<circle cx="744" cy="173\.2\d*"/);
    expect(text(trends(hlt, 'en', 'risk'))).not.toContain('stroke-dasharray');
    const fr = text(trends(hlt, 'fr'));
    expect(fr).toContain('Instantanés 13 Hebdomadaire · vendredi · depuis le 3 juil.');
    expect(fr).toContain('Marge perdue -31 j W27 → W39');
    expect(fr).toContain('Prochain rapport d’état 2 oct.');
    expect(fr).toContain('Exposition aux risques (EMV) Provision 150 k€ 340 k€ +50 k€ · 4 sem.');
    expect(fr).toContain('CPI — 13 instantanés hebdomadaires Date d’état chaque vendredi · pointillé = cible ≥ 1.00');
    expect(fr).toContain('Semaine Date d’état CPI SPI EAC Marge Exposition aux risques Glissement des jalons');
    expect(fr).toContain('W39 25 sept. 0.92 0.90 5,24 M€ −27 j 340 k€ 39 j');
  });
});
