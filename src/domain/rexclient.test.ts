// Golden values of the Lessons learned & closure and client portal logic (docs/spec/07 §2.7, 03 §8, 00 §8.8): the
// domain output (English source strings) against the prototype's own render values (rexclient.golden.json, generated
// by scripts/proto-golden-rexclient.ts — the prototype logic run in node:vm, EN). The prototype records (LESSONS,
// CLOSURE, SATISFACTION, HLT_PD / projectData, HMILES, HLT_CRS_X, HLT_DELIVS, BILLING, CLIENT_ISSUES) are rebuilt as
// the DAL-shaped inputs; the French rendering is covered by src/features/rexclient/model.test.ts. Deliberate
// deviations are asserted explicitly.
import { describe, expect, it } from 'vitest';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import {
  changeStatus, clientIssueStatus, closureItemStatus, deliverableStatus, isoOfDisplayDate, lessonStatus, lessonTheme, milestoneStatus,
  type ChangeStep, type StepDecision,
} from '@/server/db/codes';
import {
  CLIENT_TABS, DOCS_TAB, LESSON_RESULT, REPORT_RESULT, clientDecisions, clientKpis, clientMilestones, clientProgress, closureProgress, closureRow,
  contractSummary, invoiceRow, issueRow, lessonRow, oneDecimal, openIssueCount, parseClientReport, parseClientTab, parseIssueText, parseNewLesson,
  paymentOf, rexView, type ChangeRequestLike, type ClosureLike, type DeliverableLike, type Kpi, type LessonLike, type SatisfactionLike,
} from './rexclient';
import golden from './rexclient.golden.json';

/** R-013: the prototype's status date (Fri 25 Sep 2026), passed explicitly ("Raised today"). */
const STATUS_ISO = '2026-09-25';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const kpis = (ks: Kpi[]) => ks.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.alert ? LO : OK }));
/** Golden KPI values are numbers for counts. */
const gk = (ks: any[]) => ks.map((k) => ({ ...k, value: String(k.value) }));
const tag = (tone: string) => `tag tag-${tone}`;

// ── Prototype records as DAL rows ──────────────────────────────────────────────────────────────────────

const lessonsOf = (code: string): LessonLike[] =>
  ((PROTO.LESSONS[code] ?? []) as string[][]).map(([number, theme, whatHappened, impact, recommendation, appliesTo, status]) => ({
    number, theme: lessonTheme.code(theme), whatHappened, impact, recommendation, appliesTo, status: lessonStatus.code(status),
  }));
const closureOf = (code: string): ClosureLike[] =>
  ((PROTO.CLOSURE[code] ?? []) as string[][]).map(([item, owner, status], position) => ({ position, item, owner, status: closureItemStatus.code(status) }));
const surveyOf = (code: string): SatisfactionLike[] => ((PROTO.SATISFACTION[code] ?? []) as [string, number][]).map(([criterion, score]) => ({ criterion, score }));
const rex = (code: string) => ({ lessons: lessonsOf(code), closure: closureOf(code), satisfaction: surveyOf(code) });

function rexSnapshot(d: ReturnType<typeof rex>) {
  const v = rexView(d, 'en');
  return {
    kpis: kpis(v.kpis),
    lessons: v.lessons.map((l) => ({
      id: l.id, theme: l.theme, what: l.what, impact: l.impact, reco: l.reco, apply: l.apply, status: l.status, stClass: tag(l.tone),
      // The prototype keeps "Mark applied" on applied rows (hidden by canAdvance); the rebuild has no action there.
      canAdvance: !!l.next, next: l.next?.label ?? 'Mark applied',
    })),
    closure: v.closure.map((c) => ({ item: c.item, owner: c.owner, status: c.status, icon: ICON[c.mark], color: c.color, textColor: c.textColor })),
    satisfaction: v.satisfaction.map((s) => ({ k: s.criterion, v: s.score, w: s.width })),
    satAvg: v.satAvg,
  };
}
const ICON = { done: 'ph ph-check-square', progress: 'ph ph-minus-square', idle: 'ph ph-square' };
/** The golden snapshot without its header, KPI values as strings. */
const goldenRex = (g: any) => ({ kpis: gk(g.kpis), lessons: g.lessons, closure: g.closure, satisfaction: g.satisfaction, satAvg: g.satAvg });

describe('lessons learned & closure (07 §2.7)', () => {
  it('HLT-026: KPI tiles, lessons, closure checklist, satisfaction survey', () => {
    expect(rexSnapshot(rex('HLT-026'))).toEqual(goldenRex(G.rex.en['HLT-026']));
  });

  it('a project without REX data: empty lists, "—" KPIs, survey not received', () => {
    const g = G.rex.en['NDC-031'];
    expect(rexSnapshot(rex('NDC-031'))).toEqual(goldenRex(g));
    expect(closureProgress([])).toEqual({ pct: null, done: 0, inProgress: 0, notStarted: 0 });
  });

  it('Validate / Mark applied: LL-04 Proposed → Validated, LL-01 and LL-03 Validated → Applied', () => {
    const d = rex('HLT-026');
    for (const id of ['LL-04', 'LL-01', 'LL-03']) {
      const l = d.lessons.find((x) => x.number === id)!;
      l.status = lessonRow(l).next!.to;
    }
    const g = G.rex.en.afterAdvance;
    expect(rexSnapshot(d)).toEqual(goldenRex(g));
    expect(lessonRow(d.lessons[1]).next).toBeNull();
  });

  it('closure click cycles Not started → In progress → Done → Not started', () => {
    const d = rex('HLT-026');
    for (const i of [0, 2, 4]) d.closure[i].status = closureRow(d.closure[i]).next;
    const g = G.rex.en.afterCycle;
    expect(rexSnapshot(d)).toEqual(goldenRex(g));
    const c = rex('HLT-026').closure[0];
    for (let i = 0; i < 3; i++) c.status = closureRow(c).next;
    expect(closureRow(c).status).toBe(G.rex.en.afterCycleTwice.closure[0].status);
  });

  it('Add lesson learned: Proposed, impact "—" when blank, blank selects take the first option; LL-10 then LL-11', () => {
    const a = parseNewLesson({ theme: 'quality', what: ' Weld map missing at FAT ', impact: '2 d lost', reco: 'Attach the weld map to the FAT pack', apply: 'ITP template' });
    const b = parseNewLesson({ theme: '', what: 'Late crane permit', impact: '  ', reco: 'Request permits at award', apply: '' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const d = rex('HLT-026');
    // Numbering is the data layer's (nextBusinessNumber(…, 'LL-', 2, 9)); the second form is the one advanced once here.
    d.lessons.push({ number: 'LL-10', ...a.value, impact: a.value.impact ?? '—', status: 'validated' }, { number: 'LL-11', ...b.value, impact: b.value.impact ?? '—', status: 'proposed' });
    const g = G.rex.en.afterAdd;
    expect(rexSnapshot(d)).toEqual(goldenRex(g));
    expect(LESSON_RESULT).toBe(G.toasts.rex.en);
  });

  it('Add lesson learned validation', () => {
    const ok = { theme: 'site', what: 'x', reco: 'y', apply: 'Other' };
    expect(parseNewLesson({ ...ok, what: ' ' })).toEqual({ ok: false, error: 'What happened is required' });
    expect(parseNewLesson({ ...ok, reco: '' })).toEqual({ ok: false, error: 'Recommendation is required' });
    expect(parseNewLesson({ ...ok, theme: 'Weather' })).toEqual({ ok: false, error: 'Unknown theme' });
    expect(parseNewLesson({ ...ok, apply: 'My own template' })).toEqual({ ok: false, error: 'Unknown template or procedure' });
    expect(parseNewLesson({ ...ok, what: 'x'.repeat(1001) })).toEqual({ ok: false, error: 'What happened is too long' });
    expect(parseNewLesson({ ...ok, what: 42 })).toEqual({ ok: false, error: 'What happened is required' });
    expect(parseNewLesson(null)).toEqual({ ok: false, error: 'What happened is required' });
    expect(parseNewLesson(ok)).toEqual({ ok: true, value: { theme: 'site', whatHappened: 'x', impact: null, recommendation: 'y', appliesTo: 'Other' } });
  });

  it('satisfaction: attention colour below 3.5, French decimals (deliberate: the prototype printed "4.0" in French)', () => {
    const low = rexView({ lessons: [], closure: [], satisfaction: [{ criterion: 'A', score: 3 }, { criterion: 'B', score: 3.5 }] }, 'en');
    expect(low.kpis[3]).toEqual({ label: 'Customer satisfaction', value: '3.3 / 5', sub: 'lowest · A', alert: true });
    expect(rexView(rex('HLT-026'), 'fr').kpis[3].value).toBe('4,0 / 5');
    expect(rexView(rex('HLT-026'), 'fr').satisfaction[0].score).toBe('4,5');
    expect(oneDecimal(4, 'en')).toBe('4.0');
  });
});

// ── Client portal ──────────────────────────────────────────────────────────────────────────────────────

const chainOf = (c: Record<string, StepDecision>) => (['pm', 'director', 'client', 'ccb'] as ChangeStep[]).map((step) => ({ step, decision: c[step] ?? null }));
const crs = (): ChangeRequestLike[] =>
  (PROTO.HLT_CRS_X as any[]).map((c) => ({ id: c.id, title: c.title, types: c.types, amount: c.amt, days: c.days, status: changeStatus.code(c.status), date: c.date, chain: chainOf(c.chain) }));
const deliverables = (): DeliverableLike[] =>
  (PROTO.HLT_DELIVS as any[]).map((d) => ({
    number: d.id, title: d.title, typeLabel: d.type, revision: d.rev === '—' ? null : d.rev, status: deliverableStatus.code(d.status), dueOn: isoOfDisplayDate(d.due)!, acceptanceText: d.acc,
  }));
const proto = (code: string) => (code === 'HLT-026' ? PROTO.HLT_PD : PROTO_GEN.projectData[code]);
const evmOf = (code: string) => ({ pv: proto(code).PV, ev: proto(code).EV, bac: proto(code).BAC });
const msOf = (code: string) =>
  (proto(code).MILES as [string, number, number, string][]).map(([name, baselineMonth, forecastMonth, st]) => ({
    name, baselineMonth, forecastMonth, status: milestoneStatus.code(st), statusLabel: st,
  }));
const issues = () =>
  (PROTO.CLIENT_ISSUES as string[][]).map(([number, title, raised, status, response]) => ({
    number, title, raisedOn: isoOfDisplayDate(raised.replace('Raised ', ''))!, status: clientIssueStatus.code(status), response,
  }));

describe('client portal (03 §8)', () => {
  it('KPI tiles: progress vs plan, forecast handover vs contract date, milestones, awaiting decisions, open issues', () => {
    for (const [code, awaiting] of [['HLT-026', 3], ['NDC-031', 1]] as const) {
      const p = proto(code);
      const v = clientKpis({ evm: evmOf(code), schedule: p, awaiting, openIssues: openIssueCount(issues()) });
      expect(kpis(v)).toEqual(gk(G.client.en[code].kpis));
    }
    // Projects without schedule data (pipeline, EWA-051): no prototype fallback to Harbor Line (00 §7.16).
    expect(clientKpis({ evm: null, schedule: null, awaiting: 0, openIssues: 0 }).map((k) => [k.value, k.sub])).toEqual([
      ['—', ''], ['—', ''], ['—', ''], ['0', 'Change requests and deliverables'], ['0', 'Raised by you'],
    ]);
  });

  it('progress bars up to the data date and the milestone list', () => {
    for (const code of ['HLT-026', 'NDC-031']) {
      expect(clientProgress(proto(code).chartMonths, evmOf(code))).toEqual(G.client.en[code].progress);
      expect(clientMilestones(msOf(code), proto(code).start).map((m) => ({ name: m.name, baseDate: m.baseDate, fcDate: m.fcDate, status: m.status, tagClass: tag(m.tone) })))
        .toEqual(G.client.en[code].milestones);
    }
  });

  const decisionsOf = (c: ChangeRequestLike[], d: DeliverableLike[]) => {
    const v = clientDecisions(c, d, 'en');
    return {
      decisions: v.waiting.map((x) => ({ kind: x.kindLabel, id: x.id, title: x.title, sub: x.sub, when: x.when, approveLabel: x.approveLabel })),
      decided: v.decided.map((x) => ({ id: x.id, title: x.title, state: x.state, tagClass: tag(x.tone), when: x.when })),
    };
  };

  it('decisions waiting for the client and decided ones', () => {
    const g = G.client.en['HLT-026'];
    // Deviation P-6b (delivery 8, R-069): the chain is sequential — the client sees CR-008 only once the portfolio director
    // approved it (the prototype listed it while the director's step was still pending).
    expect(decisionsOf(crs(), deliverables())).toEqual({ decisions: g.decisions.filter((d: { id: string }) => d.id !== 'CR-008'), decided: g.decided });
    const afterDirector = crs();
    afterDirector.find((x) => x.id === 'CR-008')!.chain[1].decision = 'ok';
    expect(decisionsOf(afterDirector, deliverables())).toEqual({ decisions: g.decisions, decided: g.decided });
    // S-9a (docs/DECISIONS.md): the portal gains a "Schedule" tab after the prototype's first segment.
    expect(CLIENT_TABS.map((o) => o.label)).toEqual([g.seg[0], 'Schedule', ...g.seg.slice(1)]);
  });

  it('after the client approves CR-008, accepts D-014 and rejects D-016 (stamped by the data layer)', () => {
    const c = crs();
    c.find((x) => x.id === 'CR-008')!.chain[2].decision = 'ok';
    const d = deliverables();
    Object.assign(d.find((x) => x.number === 'D-014')!, { status: 'accepted', acceptanceText: '25 Sep · N. Bensaïd' });
    Object.assign(d.find((x) => x.number === 'D-016')!, { status: 'rejected', acceptanceText: '25 Sep · comments issued' });
    const g = G.client.en.afterDecide;
    expect(decisionsOf(c, d)).toEqual({ decisions: g.decisions, decided: g.decided });
    const r = crs();
    r.find((x) => x.id === 'CR-008')!.chain[2].decision = 'rejected';
    expect(decisionsOf(r, deliverables()).decided.slice(0, 3)).toEqual(G.client.en.afterRejectCr.decided.slice(0, 3));
  });

  it('invoices and contract summary (prototype BILLING rows as invoices; the screen reads the contract plan, A-5)', () => {
    const [, value, rows] = PROTO.BILLING['HLT-026'] as [string, number, [string, number, string][]];
    const inv = rows.map(([milestone, amountKeur, st], i) => ({
      milestone, amountKeur, status: st.toLowerCase() as 'paid' | 'invoiced' | 'planned', invoiceNumber: 'F-2026-' + (101 + i), dueOn: st === 'Invoiced' ? '2026-10-15' : null,
    }));
    expect(inv.map((i) => invoiceRow(i, 'en')).map((r) => ({
      no: r.no, name: r.name, amt: r.amount, status: r.status, tagClass: tag(r.tone), due: r.payment.kind === 'due' ? `Due ${r.payment.date}` : r.payment.text,
    }))).toEqual(G.client.en['HLT-026'].invoices.map((i: any) => ({ ...i })));
    const sum = (f: (s: string) => boolean) => rows.filter(([, , s]) => f(s)).reduce((a, [, x]) => a + x, 0);
    expect(contractSummary({ valueKeur: value, invoicedKeur: sum((s) => s !== 'Planned'), paidKeur: sum((s) => s === 'Paid'), approvedChangesKeur: PROTO.HLT_PD.recon.chg }, 'en'))
      .toEqual(G.client.en['HLT-026'].invKpis.map((g: any) => ({ k: g.k, v: g.v })));
    expect(contractSummary({ valueKeur: 2350, invoicedKeur: 890, paidKeur: 630, approvedChangesKeur: 0 }, 'en').map((r) => r.v))
      .toEqual(G.client.en['NDC-031'].invKpis.map((g: any) => g.v));
    // Not yet invoiced: no invoice number (the prototype pre-numbered planned milestones "F-2026-104"); an invoice without a due date reads "—".
    expect(invoiceRow({ milestone: 'M4', amountKeur: 1104, status: 'planned', invoiceNumber: null, dueOn: null }, 'en').no).toBe('—');
    expect(paymentOf({ status: 'invoiced', dueOn: null })).toEqual({ kind: 'text', text: '—' });
    expect(paymentOf({ status: 'invoiced', dueOn: '2026-11-10' })).toEqual({ kind: 'due', date: '10 Nov' });
  });

  it('issues: status tags, "Raised today" for issues raised on the status date', () => {
    expect(issues().map((i) => issueRow(i, STATUS_ISO)).map((r) => ({ id: r.id, title: r.title, when: r.when, status: r.status, resp: r.response, tagClass: tag(r.tone) })))
      .toEqual(G.client.en['HLT-026'].issues);
    const fresh = issueRow({ number: 'CI-08', title: 'Crane test witness slot', raisedOn: STATUS_ISO, status: 'open', response: 'Acknowledged — response within 2 working days' }, STATUS_ISO);
    const g = G.client.en.afterIssues.issues[2];
    expect({ when: fresh.when, status: fresh.status, resp: fresh.response, tagClass: tag(fresh.tone) }).toEqual({ when: g.when, status: g.status, resp: g.resp, tagClass: g.tagClass });
    // The prototype numbered the third new issue "CI-010" ('CI-0' + 10); the data layer pads to two digits (CI-10).
    expect(G.client.en.afterIssues.issues[0].id).toBe('CI-010');
    expect(openIssueCount(issues())).toBe(G.client.en['HLT-026'].kpis[4].value);
  });

  it('issue text, display tab, status report form', () => {
    expect(parseIssueText('  Training dates ')).toEqual({ ok: true, value: 'Training dates' });
    expect(parseIssueText('   ')).toEqual({ ok: false, error: 'Describe the issue or request' });
    expect(parseIssueText(['x'])).toEqual({ ok: false, error: 'Describe the issue or request' });
    expect(parseIssueText('x'.repeat(501))).toEqual({ ok: false, error: 'The description is too long' });
    expect([parseClientTab('docs'), parseClientTab('nope'), parseClientTab(undefined)]).toEqual(['docs', 'progress', 'progress']);
    expect(parseClientReport({})).toEqual({ ok: true, value: { period: 'month', format: 'pdf' } });
    expect(parseClientReport({ period: 'quarter', format: 'pptx' })).toEqual({ ok: true, value: { period: 'quarter', format: 'pptx' } });
    expect(parseClientReport({ period: 'Q3 2026' })).toEqual({ ok: false, error: 'Unknown period' });
    expect(parseClientReport({ format: 'docx' })).toEqual({ ok: false, error: 'Unknown format' });
    expect(REPORT_RESULT).toBe(G.toasts.client.en);
    // 03 OQ2: the prototype's ID header was the engineering register's "Column mapping".
    expect(G.labels['Column mapping']).toBe('Correspondance des colonnes');
    expect(DOCS_TAB.idHeader).toBe('Reference');
  });
});
