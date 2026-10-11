// Sourcing view models on a seeded in-memory database, against the prototype's own render values in EN and FR
// (procurement.golden.json, scripts/proto-golden-procurement.ts): the three tabs, every RFQ drawer for the four award
// situations, every invoice drawer, the scorecard per current project, then the prototype's scenarios replayed through
// the purchasing writers (Send to suppliers, Compare quotes, Award, Approve received part, Reject invoice).
// Deliberate differences, asserted explicitly: dates without a leading zero ("5 Jul"), French singulars and the
// "Request" / "No quote yet" texts, the scorecard of a project without data (no Harbor Line fallback), viewers outside
// the workspace get no action, a rejected invoice is closed (KPIs, chip, no second rejection).
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoleKey } from '@/config/screens';
import { makeT, type Lang } from '@/i18n/translate';
import { canSee } from '@/config/screens';
import { and, eq, inArray, like } from 'drizzle-orm';
import { rfqAverageCycleDays } from '@/domain/kpis';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, rfqQuotes, rfqs, suppliers } from '@/server/db/schema';
import { recordReceiptQc } from '@/server/dal/deliveries';
import {
  approveInvoiceReceivedPart, awardRfq, compareRfqQuotes, countInvoicesToResolve, createRfq, getPurchaseOrder, invoiceQueue, listRfqs, listSupplierInvoices, rejectSupplierInvoice,
  rfqAwardQueue, sendRfq,
} from '@/server/dal/purchasing';
import { rfqKpiFacts } from '@/server/dal/kpis';
import { money } from '@/lib/format';
import { getSupplierScorecard } from '@/server/dal/suppliers';
import golden from './procurement.golden.json';
import { procT } from './i18n';
import {
  invoiceDrawerView, invoiceTabView, rfqDrawerView, rfqTabView, segView, supplierTabView, type InvoiceTabView, type KpiView, type RfqTabView, type SourcingCtx,
} from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const LANGS: Lang[] = ['en', 'fr'];
const ACCENT_300 = 'var(--color-accent-300)';

const ctxOf = (lang: Lang, role: RoleKey = 'director'): SourcingCtx => ({ t: procT(makeT(lang), lang), lang, role, canEdit: canSee(role, 'procurement') });
/** Prototype dates are zero-padded ("05 Jul"); the rebuild writes "5 Jul" / "5 juil." (data layer convention). */
const date = (s: string) => s.replace(/^0(\d)/, '$1');
const kpis = (ks: KpiView[]) => ks.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.color }));
/**
 * A-12 (chapter 4): "Savings vs list" and "Average cycle" are computed from the RFQs (`rfqKpiFacts`) instead of the
 * prototype's €12k and 9 d: the only awarded RFQ (RFQ-2026-029) went to Teufelberger at the catalogue price (€0k saved)
 * and no RFQ has both a "sent" and an award date ("—").
 */
// R-169 (A-12): "Award rule" counts the RFQs to award the PM decides (RFQ-2026-034 of 031 / 033 / 034: "1 / 3") instead of
// the prototype's constant "PM" · "Decided per RFQ by the project manager".
const AWARD_SUB: Record<Lang, string> = { en: 'RFQs to award decided by the project manager', fr: 'Consultations à attribuer décidées par le chef de projet' };
const protoRfqKpis = (ks: any[], lang: Lang, award = '1 / 3') =>
  ks.map((k, i) => ({
    label: k.label, value: i === 2 ? money(0, lang) : i === 3 ? '—' : i === 4 ? award : String(k.value), sub: i === 4 ? AWARD_SUB[lang] : k.sub, color: k.color,
  }));
const protoKpis = (ks: any[]) => ks.map((k) => ({ label: k.label, value: String(k.value), sub: k.sub, color: k.color }));

/** French texts this screen fixes (prototype → rebuild). */
const FR_FIX: Record<string, string> = { '1 prêtes à attribuer': '1 prête à attribuer', 'No quote yet': 'Aucun devis' };
const fix = (s: string, lang: Lang) => (lang === 'fr' ? (FR_FIX[s] ?? s) : s);

const rfqRows = (v: RfqTabView) =>
  v.rows.map((r) => ({
    id: r.number, title: r.title, part: r.part, qty: r.qty, due: r.due, owner: r.owner, quotesText: r.quotes, rule: r.rule, chosenText: r.awardedTo, status: r.status,
    tagClass: r.tagClass, selected: r.selected, canSend: r.canSend, canCompare: r.canCompare,
  }));
const protoRfqRows = (rows: any[], lang: Lang) =>
  rows.map((r) => ({
    id: r.id, title: r.title, part: r.part, qty: String(r.qty), due: date(r.due), owner: r.owner, quotesText: fix(r.quotesText, lang), rule: r.rule, chosenText: r.chosenText,
    status: r.status, tagClass: r.tagClass, selected: r.idColor === ACCENT_300, canSend: r.canSend, canCompare: r.canCompare,
  }));

const invRows = (v: InvoiceTabView) =>
  v.rows.map((r) => ({
    id: r.number, date: r.date, supplier: r.supplier, poText: r.po, grText: r.gr, amountText: r.amount, gapText: r.gap, gapColor: r.gapColor, dueDate: r.due, status: r.status,
    tagClass: r.tagClass, selected: r.selected, canApprove: r.canApprove, canPartial: r.canApprovePart, m: r.dots.map((d) => [d.label, d.color]),
  }));
const protoInvRows = (rows: any[]) =>
  rows.map((r) => ({
    id: r.id, date: date(r.date), supplier: r.supplier, poText: r.poText, grText: r.grText, amountText: r.amountText, gapText: r.gapText, gapColor: r.gapColor,
    dueDate: date(r.dueDate), status: r.status, tagClass: r.tagClass, selected: r.idColor === ACCENT_300, canApprove: r.canApprove, canPartial: r.canPartial, m: r.m,
  }));

const rfqDrawer = async (number: string, lang: Lang, role: RoleKey) => {
  const r = (await listRfqs()).find((x) => x.number === number)!;
  const order = r.purchaseOrderNumber ? await getPurchaseOrder(r.purchaseOrderNumber) : null;
  return rfqDrawerView(r, { ...ctxOf(lang, role), orderProject: order?.projectCode ?? null, currentProject: 'HLT-026' });
};
const protoRfqDrawer = (d: any, lang: Lang) => {
  const t = procT(makeT(lang), lang);
  return {
    title: d.title, status: d.status, tagClass: d.tagClass, noQuotes: d.noQuotes,
    footnote: [t('Best unit price and shortest lead time highlighted · rating from supplier performance ·'), d.hint].filter(Boolean).join(' '),
    meta: d.meta.map((m: any) => ({ k: m.k, v: date(m.v) })),
    quotes: d.quotes.map((q: any) => ({
      supplier: q.sup, awarded: q.chosen, price: q.price, best: q.priceColor === ACCENT_300, total: q.total, delta: q.delta, lead: q.lead, fastest: q.leadColor === ACCENT_300,
      terms: q.terms, rating: `${q.grade} · ${q.score}`, canAward: q.canAward,
    })),
  };
};
const ownRfqDrawer = (v: Awaited<ReturnType<typeof rfqDrawer>>) => ({
  title: v.title, status: v.status, tagClass: v.tagClass, noQuotes: v.noQuotes, footnote: v.footnote, meta: v.meta, quotes: v.quotes,
});

const invDrawer = async (number: string, lang: Lang, role: RoleKey = 'director') => {
  const i = (await listSupplierInvoices()).find((x) => x.number === number)!;
  return invoiceDrawerView(i, 'all', { ...ctxOf(lang, role), currentProject: 'HLT-026' });
};
const protoInvDrawer = (d: any) => ({
  supplier: d.supplier, status: d.status, tagClass: d.tagClass, canApprove: d.canApprove, canApprovePart: d.canPartial, canReject: d.canReject,
  legs: d.rows.map((r: any) => ({ label: r.k, ref: r.ref, amount: r.amt, dot: r.dot, state: r.state, color: r.color })),
  meta: d.meta.map((m: any) => ({ k: m.k, v: date(m.v), color: m.color })),
  hasPo: d.hasPO, hasGr: d.hasGR,
});
const ownInvDrawer = (v: Awaited<ReturnType<typeof invDrawer>>) => ({
  supplier: v.supplier, status: v.status, tagClass: v.tagClass, canApprove: v.canApprove, canApprovePart: v.canApprovePart, canReject: v.canReject, legs: v.legs, meta: v.meta,
  hasPo: !!v.poHref, hasGr: !!v.grHref,
});

describe('Sourcing view models vs the prototype', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  describe.each(LANGS)('seed (%s)', (lang) => {
    it('display switch', () => {
      expect(segView(ctxOf(lang).t).map((o) => o.label)).toEqual(G.seg[lang]);
      expect(segView(ctxOf(lang).t).map((o) => o.href)).toEqual(['/purchasing/sourcing', '/purchasing/sourcing?tab=inv', '/purchasing/sourcing?tab=sup']);
    });

    it('RFQ & quotes: KPI tiles and rows', async () => {
      const v = rfqTabView(await listRfqs(), null, ctxOf(lang), await rfqKpiFacts());
      const g = G.seed[lang].rfq;
      expect(kpis(v.kpis)).toEqual(protoRfqKpis(g.kpis, lang).map((k) => ({ ...k, sub: fix(k.sub, lang) })));
      expect(rfqRows(v)).toEqual(protoRfqRows(g.rows, lang));
      expect(v.rows.map((r) => r.href)).toEqual(['RFQ-2026-031', 'RFQ-2026-033', 'RFQ-2026-029', 'RFQ-2026-034'].map((n) => `/purchasing/sourcing?rfq=${n}`));
    });

    it('Invoices — 3-way match: KPI tiles, chips, rows and the status filters', async () => {
      const invoices = await listSupplierInvoices();
      const v = invoiceTabView(invoices, 'all', null, ctxOf(lang));
      const g = G.seed[lang].inv;
      expect(kpis(v.kpis)).toEqual(protoKpis(g.kpis));
      expect(v.chips.map((c) => [c.label, c.count])).toEqual(g.chips);
      expect(invRows(v)).toEqual(protoInvRows(g.rows));
      for (const [code, label] of [['blocked', 'Blocked'], ['awaiting_receipt', 'Awaiting receipt'], ['no_po', 'No PO'], ['approved_for_payment', 'Approved for payment'], ['paid', 'Paid']] as const) {
        const f = invoiceTabView(invoices, code, null, ctxOf(lang));
        expect(f.rows.map((r) => r.number)).toEqual(G.seed[lang].invFilters[label].ids);
        expect(f.rows.length === 0).toBe(G.seed[lang].invFilters[label].noInv);
      }
    });

    it('Supplier performance per current project (no Harbor Line fallback on a project without data)', async () => {
      for (const project of ['HLT-026', 'NDC-031', 'WSA-044', 'EWA-051']) {
        const v = supplierTabView(await getSupplierScorecard(project), ctxOf(lang));
        const g = G.sup[lang][project];
        const expected = protoKpis(g.kpis);
        if (project === 'EWA-051') expected[4].value = '0';
        expect([project, kpis(v.kpis)]).toEqual([project, expected]);
        expect(v.rows.map((r) => [r.name, r.onTime, r.onTimeWidth, r.onTimeColor, r.quality, r.qualityWidth, r.ncrRate, r.ncrRateColor, r.openPos, r.ncrs, r.grade, r.gradeClass])).toEqual(
          g.rows.map((r: any) => [r.name, r.otd, r.otdW, r.otdColor, r.qual, r.qualW, r.ncr, r.ncrColor, String(r.pos), String(r.ncrs), r.grade, r.gradeClass]),
        );
      }
    });

    it('RFQ drawers for the director, the project manager, procurement and the quality manager (outside)', async () => {
      for (const number of ['RFQ-2026-031', 'RFQ-2026-033', 'RFQ-2026-029', 'RFQ-2026-034']) {
        for (const role of ['director', 'pm', 'procurement', 'quality'] as const) {
          const v = await rfqDrawer(number, lang, role);
          const g = G.rfqDrawers[lang][number][role];
          const expected = protoRfqDrawer(g, lang);
          if (lang === 'fr' && number === 'RFQ-2026-031') expect(expected.meta[0].v).toBe('KS-STL-0450 · Structural steel column HEB 450');
          expect([number, role, ownRfqDrawer(v)]).toEqual([number, role, expected]);
          // Outside the workspace (quality): no "Send to suppliers" (the prototype offered it to every role).
          expect(v.canSend).toBe(role === 'quality' ? false : g.canSend);
        }
      }
      const d = await rfqDrawer('RFQ-2026-031', lang, 'pm');
      expect(d.partHref).toBe('/reference/parts?part=KS-STL-0450');
      expect(d.ordersHref).toBe('/projects/HLT-026/orders');
      expect(d.closeHref).toBe('/purchasing/sourcing');
    });

    it('invoice drawers (director)', async () => {
      for (const i of await listSupplierInvoices()) {
        const v = await invDrawer(i.number, lang);
        expect([i.number, ownInvDrawer(v)]).toEqual([i.number, protoInvDrawer(G.invDrawers[lang][i.number])]);
        if (i.canApprovePart) expect(v.partialLabel).toBe(G.invDrawers[lang][i.number].partialLabel);
      }
      const hc = await invDrawer('INV-HC-7781', lang);
      expect([hc.poHref, hc.grHref, hc.closeHref]).toEqual(['/projects/HLT-026/orders?po=PO-1052', '/projects/HLT-026/deliveries?receipt=BL-2026-0498', '/purchasing/sourcing?tab=inv']);
    });

    it('invoice decisions belong to procurement and the director; the project manager reads (P-5)', async () => {
      const invoices = await listSupplierInvoices();
      for (const role of ['procurement', 'pm', 'quality'] as const) {
        const v = invoiceTabView(invoices, 'all', null, ctxOf(lang, role));
        expect([role, v.rows.filter((r) => r.canApprovePart).map((r) => r.number)]).toEqual([role, role === 'procurement' ? ['INV-HC-7781', 'INV-BX-55120'] : []]);
        const d = await invDrawer('INV-LE-2210', lang, role);
        expect([role, d.canReject]).toEqual([role, role === 'procurement']);
      }
    });
  });

  it('French: "Request" is the noun heading, "Lead time" the quote column, singular forms', () => {
    const t = procT(makeT('fr'), 'fr');
    expect([t('Request'), t('Lead time'), t('1 ready to award'), t('3 ready to award'), t('1 rated A'), t('1 wk'), t('1 quote · from 900 €')]).toEqual([
      'Demande', 'Délai', '1 prête à attribuer', '3 prêtes à attribuer', '1 noté A', '1 sem.', '1 devis · à partir de 900 €',
    ]);
    expect(G.labels.Request).toBe('Demander');
    expect(G.labels['Discipline lead']).toBe('Référent');
  });

  describe('scenarios through the writers (prototype handlers replayed)', () => {
    it('"Send to suppliers" on RFQ-2026-034: Draft → Open', async () => {
      await sendRfq('RFQ-2026-034', 'Fabien Bertrand');
      for (const lang of LANGS) {
        const g = G.scenarios[lang].afterSend.rfq;
        const v = rfqTabView(await listRfqs(), null, ctxOf(lang), await rfqKpiFacts());
        expect(kpis(v.kpis)).toEqual(protoRfqKpis(g.kpis, lang).map((k) => ({ ...k, sub: fix(k.sub, lang) })));
        expect(rfqRows(v)).toEqual(protoRfqRows(g.rows, lang));
      }
      // The drawer after "Send to suppliers" (fresh prototype session) — same state.
      expect(ownRfqDrawer(await rfqDrawer('RFQ-2026-034', 'en', 'director'))).toEqual(protoRfqDrawer(G.scenarios.en.drawerSend, 'en'));
    });

    it('"Compare quotes" on RFQ-2026-033: Open → Comparing, award offered', async () => {
      await compareRfqQuotes('RFQ-2026-033', 'Fabien Bertrand');
      for (const lang of LANGS) {
        const g = G.scenarios[lang].afterCompare;
        const v = rfqTabView(await listRfqs(), 'RFQ-2026-033', ctxOf(lang), await rfqKpiFacts());
        expect(kpis(v.kpis)).toEqual(protoRfqKpis(g.rfq.kpis, lang).map((k) => ({ ...k, sub: fix(k.sub, lang) })));
        expect(rfqRows(v)).toEqual(protoRfqRows(g.rfq.rows, lang));
        expect(ownRfqDrawer(await rfqDrawer('RFQ-2026-033', lang, 'director'))).toEqual(protoRfqDrawer(g.drawer, lang));
      }
    });

    it('"Award" RFQ-2026-031 to Dillinger: Awarded, draft purchase order, leaves the award queue', async () => {
      const { purchaseOrderNumber } = await awardRfq('RFQ-2026-031', 'Dillinger', 'Romain Aubert');
      expect(purchaseOrderNumber).toMatch(/^PO-11\d\d$/);
      for (const lang of LANGS) {
        const g = G.scenarios[lang].afterAward;
        const v = rfqTabView(await listRfqs(), 'RFQ-2026-031', ctxOf(lang));
        expect(rfqRows(v)).toEqual(protoRfqRows(g.rfq.rows, lang));
        const d = await rfqDrawer('RFQ-2026-031', lang, 'director');
        expect(ownRfqDrawer(d)).toEqual(protoRfqDrawer(g.drawer, lang));
        expect(d.ordersHref).toBe(`/projects/HLT-026/orders?po=${purchaseOrderNumber}`);
      }
      const po = (await getPurchaseOrder(purchaseOrderNumber!))!;
      expect([po.projectCode, po.supplier, po.status, po.lines.map((l) => [l.ref, l.orderedQty, l.unitPriceEur])]).toEqual(['HLT-026', 'Dillinger', 'draft', [['KS-STL-0450', 192, 1195]]]);
      expect((await rfqAwardQueue()).map((r) => r.number)).toEqual(G.scenarios.en.afterAward.myapprovals.pm);
    });

    it('"Approve received part" on INV-HC-7781: approved at the receipt amount', async () => {
      await approveInvoiceReceivedPart('INV-HC-7781', 'Fabien Bertrand');
      for (const lang of LANGS) {
        const g = G.scenarios[lang].afterPartial;
        const v = invoiceTabView(await listSupplierInvoices(), 'all', 'INV-HC-7781', ctxOf(lang));
        expect(kpis(v.kpis)).toEqual(protoKpis(g.inv.kpis));
        expect(v.chips.map((c) => [c.label, c.count])).toEqual(g.inv.chips);
        expect(invRows(v)).toEqual(protoInvRows(g.inv.rows));
        expect(ownInvDrawer(await invDrawer('INV-HC-7781', lang))).toEqual(protoInvDrawer(g.drawer));
      }
    });

    it('"Reject invoice" on INV-LE-2210: closed — out of the KPIs, own chip, no second rejection (deviation, 08 OQ5)', async () => {
      await rejectSupplierInvoice('INV-LE-2210', 'Marie Lefebvre');
      const g = G.scenarios.en.afterReject;
      const v = invoiceTabView(await listSupplierInvoices(), 'all', 'INV-LE-2210', ctxOf('en'));
      expect(invRows(v)).toEqual(protoInvRows(g.inv.rows));
      const expected = protoKpis(g.inv.kpis);
      expect(expected.map((k) => k.value)).toEqual(['5', '1', '2', '1', '5']);
      expected[0] = { ...expected[0], value: '4', sub: '€1,690,480' };
      expected[4] = { ...expected[4], value: '4' };
      expect(kpis(v.kpis)).toEqual(expected);
      expect(v.chips.map((c) => [c.label, c.count])).toEqual([...g.inv.chips, ['Rejected', 1]]);
      const d = await invDrawer('INV-LE-2210', 'en');
      expect(ownInvDrawer(d)).toEqual({ ...protoInvDrawer(g.drawer), canReject: false });
      const fr = invoiceTabView(await listSupplierInvoices(), 'rejected', null, ctxOf('fr'));
      expect([fr.chips.at(-1)?.label, fr.rows.map((r) => r.number)]).toEqual(['Refusé', ['INV-LE-2210']]);
      // The writer refuses a second rejection too (not only the screen).
      await expect(rejectSupplierInvoice('INV-LE-2210', 'Marie Lefebvre')).rejects.toThrow(/can no longer be rejected/);
    });

    it('a partial receipt accepted in Deliveries blocks the "Awaiting receipt" invoice by the match (INV-NV-1190, SC-2): received part approvable, badge, My approvals', async () => {
      // Deliveries QC of BL-2026-0521 (2 transformers delivered on PO-1063): one accepted, one rejected → receipt €124,000.
      await recordReceiptQc('BL-2026-0521', { lines: [{ ref: 'EL-TRF-2MVA', accepted: 1, rejected: 1 }] }, 'Gabriel Comte');
      const nv = (await listSupplierInvoices()).find((i) => i.number === 'INV-NV-1190')!;
      expect([nv.status, nv.receiptAmountEur, nv.match, nv.gapEur]).toEqual(['blocked', 124_000, { po: 'ok', gr: 'partial' }, 124_000]);
      const d = await invDrawer('INV-NV-1190', 'en', 'procurement');
      expect([d.status, d.tagClass, d.canApprove, d.canApprovePart, d.partialLabel, d.canReject]).toEqual(['Blocked', 'tag tag-accent', false, true, 'Approve €124,000 · request credit note', true]);
      expect(d.legs[1]).toMatchObject({ amount: '€124,000', state: 'Partial receipt' });
      expect(d.meta.find((m) => m.k === 'Blocking reason')?.v).toBe('Invoiced quantity exceeds accepted receipt (rejected units)');
      expect((await invoiceQueue()).map((i) => i.number)).toEqual(['INV-NV-1190', 'INV-BX-55120']);
      expect(await countInvoicesToResolve()).toBe(2);
      const v = invoiceTabView(await listSupplierInvoices(), 'all', null, ctxOf('fr', 'procurement'));
      expect(v.kpis.map((k) => k.value)).toEqual(['4', '2', '1', '1', '4']);
      expect(v.rows.find((r) => r.number === 'INV-NV-1190')).toMatchObject({ status: 'Bloquée', canApprovePart: true });
      await approveInvoiceReceivedPart('INV-NV-1190', 'Fabien Bertrand');
      const after = (await listSupplierInvoices()).find((i) => i.number === 'INV-NV-1190')!;
      expect([after.status, after.amountEur, after.creditNoteEur, after.decidedBy]).toEqual(['approved_for_payment', 124_000, 124_000, 'Fabien Bertrand']);
      expect(await countInvoicesToResolve()).toBe(1);
    });

    it('A-12: an RFQ created in Keystone (Open, "RFQ sent to …") counts in "Average cycle": create → compare → award', async () => {
      // Before the fix only "status: Draft → Open" gave a send date, so an RFQ created Open never counted ("—").
      const number = await createRfq({ title: 'Column base plates', suppliers: 'Dillinger, Salzgitter', articles: 'KS-STL-0450', quantity: 12, replyDueOn: '2026-10-15', projectCode: 'HLT-026' }, 'Fabien Bertrand');
      const db = await getDb();
      const [r] = await db.select({ id: rfqs.id }).from(rfqs).where(eq(rfqs.number, number));
      // The clock is real: date the "sent" audit entry 14 Sep and the award 23 Sep (Paris) to get a stable 9-day cycle.
      await db.update(auditEntries).set({ occurredAt: new Date('2026-09-14T08:00:00Z') }).where(and(eq(auditEntries.entityId, r.id), like(auditEntries.change, 'RFQ sent to %')));
      // Suppliers quote outside Keystone (no writer yet): two quotes recorded directly.
      const sups = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.name, ['Dillinger', 'Salzgitter']));
      expect(sups).toHaveLength(2);
      await db.insert(rfqQuotes).values(sups.map((x, i) => ({ rfqId: r.id, supplierId: x.id, unitPriceEur: 1150 + 30 * i, leadWeeks: 4, paymentTerms: 'Net 45', grade: 'A' as const, score: 90 - i, position: i })));
      await compareRfqQuotes(number, 'Fabien Bertrand');
      await awardRfq(number, 'Dillinger', 'Romain Aubert');
      await db.update(rfqs).set({ awardedAt: new Date('2026-09-23T10:00:00Z') }).where(eq(rfqs.id, r.id));
      const facts = await rfqKpiFacts();
      expect(rfqAverageCycleDays(facts)).toBe(9);
      const cycle = rfqTabView(await listRfqs(), null, ctxOf('en'), facts).kpis.find((k) => k.label === 'Average cycle')!;
      expect(cycle.value).toBe('9 d');
    });
  });
});
