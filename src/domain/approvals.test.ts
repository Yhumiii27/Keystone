// Golden values of the My approvals builders (docs/spec/08 §7.4–7.5, 00 §8.8) on the prototype data set: item text
// of the kinds built here (Codex documents, change requests), the change-request routing rule, and the inbox view
// model (myApprKpis 4737) — including the fixed "Oldest" (00 §7.16, 08 OQ22).
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { PROTO } from '@/server/prototype';
import {
  changeRequestItems, changeRequestSub, codexDocItems, inboxView, isoOfWhen, kpiTexts, oldestItem, pendingStepFor,
  type ApprovalItem, type ChangeRequestForInbox, type ProtoDoc,
} from './approvals';
import { canDecideStep } from './change-control';

const ids = (xs: ApprovalItem[]) => xs.map((x) => x.id);

// RFQ awards, invoices, purchase orders, ECOs and delivery quality checks (Delivery 4), NCR verification and client
// deliverable acceptance (Delivery 5) are read from the database: their item builders are golden-tested with their
// modules (orders, eco, deliveries, procurement, quality).
describe('Codex documents (00 §7.8, DOC_WHO)', () => {
  const docs = PROTO.DOCS as ProtoDoc[];
  it('RPT-HLT-014 (release proposed) waits for the quality manager, step 2 of its circuit', () => {
    expect(codexDocItems(docs, PROTO.DOC_TYPE, PROTO.DOC_WHO, 'G. Comte', 'HLT-026', 2026)).toEqual([
      {
        kind: 'doc', id: 'RPT-HLT-014', title: 'Crane rail alignment report', sub: 'Test & inspection report · rev A · Quality manager', when: '28 Sep', whenIso: '2026-09-28',
        who: 'G. Comte', href: '/projects/HLT-026/documents?doc=RPT-HLT-014', decision: null,
      },
    ]);
    for (const who of ['R. Aubert', 'M. Lefebvre', 'A. Girard', 'N. Bensaïd', 'F. Bertrand']) expect(codexDocItems(docs, PROTO.DOC_TYPE, PROTO.DOC_WHO, who, 'HLT-026', 2026)).toEqual([]);
  });
});

describe('change requests (apprItems 4726 by person)', () => {
  const approver = { pm: 'Romain Aubert', director: 'Marie Lefebvre', client: 'Nadia Bensaïd', ccb: 'Monthly · next 8 Oct' } as const;
  const status = (s: string) => (s === 'In review' ? 'in_review' : s === 'Draft' ? 'draft' : s === 'Approved' ? 'approved' : 'rejected');
  const crs: ChangeRequestForInbox[] = (PROTO.HLT_CRS_X as { id: string; title: string; status: string; chain: Record<string, string>; by: string; date: string; amt: number; days: number; types: string[] }[]).map((c) => ({
    id: c.id, title: c.title, typesLabel: c.types.map((t) => PROTO.CR_TYPES[t]).join(' · '), amount: c.amt, days: c.days, status: status(c.status), by: c.by, date: c.date,
    chain: (['pm', 'director', 'client', 'ccb'] as const).map((step) => ({ step, approver: approver[step], decision: (c.chain[step] === 'n/a' ? 'na' : c.chain[step]) as 'ok' })),
  }));
  const director = { name: 'Marie Lefebvre', role: 'director' } as const;
  const client = { name: 'Nadia Bensaïd', role: 'client' } as const;
  const pm = { name: 'Romain Aubert', role: 'pm' } as const;
  // Deviation P-6b (delivery 8, R-069): the chain is sequential — CR-008 waits for the director only; the client contact gets it
  // once the director approved, the director again (change control board) once the client approved. The prototype offered it to
  // the director and the client at once.
  const withDecided = (list: ChangeRequestForInbox[], steps: ChangeRequestForInbox['chain'][number]['step'][]) =>
    list.map((c) => (c.id === 'CR-008' ? { ...c, chain: c.chain.map((x) => (steps.includes(x.step) ? { ...x, decision: 'ok' as const } : x)) } : c));
  it('CR-008 waits for the director only (sequential chain, P-6b), not the PM (step already ok)', () => {
    expect(ids(changeRequestItems(crs, director, 'HLT-026', 'en', 2026))).toEqual(['CR-008']);
    expect(ids(changeRequestItems(crs, client, 'HLT-026', 'en', 2026))).toEqual([]);
    expect(changeRequestItems(crs, pm, 'HLT-026', 'en', 2026)).toEqual([]);
    const [d] = changeRequestItems(crs, director, 'HLT-026', 'en', 2026);
    expect(d).toEqual({
      kind: 'cr', id: 'CR-008', title: 'Second steel crew — schedule recovery', sub: 'Budget · Schedule · +€85k · -12 d', when: '24 Sep', whenIso: '2026-09-24', who: 'R. Aubert',
      href: '/projects/HLT-026/changes?cr=CR-008', decision: { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'director' },
    });
    const afterDirector = withDecided(crs, ['director']);
    expect(changeRequestItems(afterDirector, client, 'HLT-026', 'fr', 2026)[0].sub).toBe('Budget · Schedule · +85 k€ · -12 d');
    expect(changeRequestItems(afterDirector, client, 'HLT-026', 'en', 2026)[0].decision).toMatchObject({ step: 'client' });
    expect(changeRequestItems(afterDirector, director, 'HLT-026', 'en', 2026)).toEqual([]);
    // Another person holding the director role is not the named approver of the director step.
    expect(ids(changeRequestItems(crs, { name: 'Someone Else', role: 'pm' }, 'HLT-026', 'en', 2026))).toEqual([]);
  });
  it('once the director and the client decided, CR-008 comes back to the director for the change control board (recorded by the director on Change control)', () => {
    const decided = withDecided(crs, ['director', 'client']);
    const [d] = changeRequestItems(decided, director, 'HLT-026', 'en', 2026);
    expect([d.id, d.sub, d.decision]).toEqual([
      'CR-008', 'Budget · Schedule · +€85k · -12 d · Change control board', { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'ccb' },
    ]);
    const fr = changeRequestItems(decided, director, 'HLT-026', 'fr', 2026)[0].sub;
    // Shared engine: the prototype's "-12 d" stays as is (the feature's inboxT renders "-12 j", see myapprovals.test.ts).
    expect(makeT('fr')(fr)).toBe('Budget · Planning · +85 k€ · -12 d · Comité de contrôle des modifications');
    expect(changeRequestItems(decided, client, 'HLT-026', 'en', 2026)).toEqual([]);
  });
  it('sub line omits a zero amount or zero days; days are signed', () => {
    expect(changeRequestSub({ typesLabel: 'Schedule', amount: 0, days: 27 }, 'en')).toBe('Schedule · +27 d');
    // Negative days keep the prototype's ASCII hyphen (apprItems 4726: `c0.days+' d'`), as Change control's cell.
    expect(changeRequestSub({ typesLabel: 'Budget · Schedule', amount: -4, days: -5 }, 'en')).toBe('Budget · Schedule · −€4k · -5 d');
    expect(changeRequestSub({ typesLabel: 'Scope', amount: 15, days: 0 }, 'en')).toBe('Scope · +€15k');
  });
  it('permission rule: in review, own CURRENT step (named approver; CCB = its recorder role), never a draft — one rule with Change control (R-171)', () => {
    const cr8 = crs.find((c) => c.id === 'CR-008')!;
    const cr9 = crs.find((c) => c.id === 'CR-009')!;
    expect(canDecideStep(cr8, 'director', director)).toBe(true);
    expect(canDecideStep(cr8, 'client', director)).toBe(false);
    expect(canDecideStep(cr8, 'pm', pm)).toBe(false);
    // Deviation P-6b (R-069): the board step waits for the director and the client (the prototype let the director decide it at once).
    expect(canDecideStep(cr8, 'ccb', director)).toBe(false);
    expect(canDecideStep(cr8, 'client', client)).toBe(false);
    const cr8Board = withDecided([cr8], ['director', 'client'])[0];
    expect(canDecideStep(cr8Board, 'ccb', director)).toBe(true);
    expect(canDecideStep(cr8Board, 'ccb', pm)).toBe(false);
    expect(canDecideStep(cr8Board, 'ccb', client)).toBe(false);
    expect(canDecideStep(cr9, 'pm', pm)).toBe(false);
    expect(canDecideStep(cr9, 'ccb', director)).toBe(false);
    expect(pendingStepFor({ ...cr9, status: 'in_review' }, pm)).toBe('pm');
    // R-069: once submitted, CR-009 waits for its PM first — the director's step comes after.
    expect(pendingStepFor({ ...cr9, status: 'in_review' }, director)).toBeNull();
  });
});

describe('inbox view (myApprKpis 4737, apprChips 4736)', () => {
  const it_ = (kind: ApprovalItem['kind'], id: string, when: string): ApprovalItem => ({ kind, id, title: id, sub: '', who: '', when, whenIso: isoOfWhen(when, 2026), href: null, decision: null });
  // The director's seed queue (HLT-026): PO-1082, CR-008, INV-HC-7781, INV-BX-55120, INV-LE-2210.
  const director = [it_('po', 'PO-1082', '24 Sep'), it_('cr', 'CR-008', '24 Sep'), it_('invoice', 'INV-HC-7781', '10 Sep'), it_('invoice', 'INV-BX-55120', '24 Sep'), it_('invoice', 'INV-LE-2210', '25 Sep')];

  it('KPIs: 5 waiting · 3 kinds · oldest 10 Sep (not the last pushed, 25 Sep) · decided', () => {
    const v = inboxView(director, { decided: 1, roleTitle: 'Portfolio director' });
    const en = v.kpis.map((k) => kpiTexts(k, makeT('en')));
    expect(en).toEqual([
      { label: 'Waiting for me', value: '5', sub: 'As Portfolio director', lo: true },
      { label: 'Types', value: '3', sub: 'Purchase order · Change request · Invoice — 3-way match', lo: false },
      { label: 'Oldest', value: '10 Sep', sub: 'Submitted on', lo: false },
      { label: 'Decided this week', value: '1', sub: 'Audit trail kept per item', lo: false },
    ]);
    expect(v.kpis.map((k) => kpiTexts(k, makeT('fr')))).toEqual([
      { label: 'En attente de ma part', value: '5', sub: 'En tant que Directrice de portefeuille', lo: true },
      { label: 'Types', value: '3', sub: 'Commande d’achat · Demande de modification · Facture — rapprochement 3 voies', lo: false },
      { label: 'Plus ancienne', value: '10 sept.', sub: 'Soumise le', lo: false },
      { label: 'Décidées cette semaine', value: '1', sub: 'Piste d’audit conservée par élément', lo: false },
    ]);
    expect(director[director.length - 1].when).toBe('25 Sep'); // what the prototype showed
  });

  it('chips: All + each kind present, with counts; the filter keeps one kind and falls back to All when gone', () => {
    const v = inboxView(director, { decided: 1, roleTitle: 'Portfolio director', filter: 'invoice' });
    expect(v.chips.map((c) => [c.value, c.label, c.count])).toEqual([
      [null, 'All', 5],
      ['po', 'Purchase order', 1],
      ['cr', 'Change request', 1],
      ['invoice', 'Invoice — 3-way match', 3],
    ]);
    expect([v.filter, ids(v.rows), v.total]).toEqual(['invoice', ['INV-HC-7781', 'INV-BX-55120', 'INV-LE-2210'], 5]);
    expect(inboxView(director, { decided: 0, roleTitle: 'x', filter: 'eco' }).filter).toBeNull();
    expect(inboxView(director, { decided: 0, roleTitle: 'x', filter: 'bogus' }).rows).toHaveLength(5);
  });

  it('empty queue: 0 · Nothing pending · —', () => {
    const v = inboxView([], { decided: 4, roleTitle: 'Engineering lead' });
    expect(v.kpis.map((k) => kpiTexts(k, makeT('en')))).toEqual([
      { label: 'Waiting for me', value: '0', sub: 'As Engineering lead', lo: false },
      { label: 'Types', value: '0', sub: 'Nothing pending', lo: false },
      { label: 'Oldest', value: '—', sub: 'Submitted on', lo: false },
      { label: 'Decided this week', value: '4', sub: 'Audit trail kept per item', lo: false },
    ]);
    expect(v.chips).toEqual([{ value: null, label: 'All', count: 0 }]);
  });

  it('oldest: earliest date, first on ties, undated items ignored', () => {
    expect(oldestItem([it_('request', 'RQ-043', '25 Sep'), it_('request', 'RQ-041', '24 Sep')])!.id).toBe('RQ-041');
    expect(oldestItem([it_('po', 'A', '24 Sep'), it_('cr', 'B', '24 Sep')])!.id).toBe('A');
    expect(oldestItem([it_('po', 'A', ''), it_('cr', 'B', '—')])).toBeNull();
    expect(oldestItem([it_('po', 'PO-5141', '9 Jan ’27'), it_('stage', 'NDC-031', '25 Sep 2026')])!.id).toBe('NDC-031');
  });
});
