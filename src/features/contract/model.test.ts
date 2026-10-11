// Contract & Billing view models against the prototype's own renderVals() (EN and FR), for the seed and every
// mutation the two screens offer (scripts/proto-golden-contract.ts → contract.golden.json). The deliberate
// differences are applied to the prototype values explicitly (see `deviate`), and the amounts follow the owner's decisions:
// - NEW-D3-3 (R-079): an amendment carries its own milestones; nothing is re-priced (amounts from `expectedFigures`);
// - C-6 (R-076): the free "Payment terms" field becomes the payment rule and its days (the seed's net 45: same dates);
// - C-9 (R-075): the contract has a currency field (EUR on the seed: every amount prints as before).
import { describe, expect, it } from 'vitest';
import {
  allInvoicedSub, collectedSub, invoicedSub, outstandingSub, overdueSub, progressCss, progressText,
} from '@/domain/contract';
import { makeT, type Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { displayOfIso } from '@/server/db/codes';
import {
  amendmentFormDef, billingView, bondFormDef, contractView, invoiceFormDef, milestoneFormDef, releaseFormDef, RESULT, sentText, signFormDef,
} from './model';
import { dataText } from './i18n';
import { G, SCENARIOS, expectedFigures, scenarioData } from './test-fixtures';

const LANGS: Lang[] = ['en', 'fr'];
const data = scenarioData;

/**
 * Deliberate differences with the prototype render:
 * - French decimal comma in shares and percentages ("2,5 %", "30,0 %"; the prototype kept "2.5 %" in French);
 * - English plural for zero invoices ("0 invoices awaiting payment").
 */
const deviate = (s: string, lang: Lang) =>
  lang === 'fr' ? s.replace(/^(\d+)\.(\d+) %$/, '$1,$2 %') : s.replace(/^0 invoice awaiting payment/, '0 invoices awaiting payment');
/** The golden's added milestone "M6" is M7 here (M6 is Amendment 1's own milestone, NEW-D3-3). */
const gid = (name: string, id: string) => (name.startsWith('milestone') && id === 'M6' ? 'M7' : id);

describe('Contract view = prototype render (EN, FR)', () => {
  for (const name of Object.keys(SCENARIOS))
    for (const lang of LANGS)
      it(`${name} · ${lang}`, () => {
        const g = G.scenarios[`${name}|contract|${lang}`];
        const d = data(name);
        const x = expectedFigures(d);
        const f = (k: number) => money(k, lang);
        const v = contractView(d, makeT(lang), lang);
        expect(v.kpis).toEqual(g.kpis);
        // The prototype's fields, the free "Payment terms" (C-6) replaced by the currency, the rule and its days.
        const shown = (f: (typeof v.fields)[number]) => (f.type === 'select' ? f.options!.find((o) => o.value === f.value)!.label : f.value);
        expect(v.fields.filter((f) => !['currency', 'rule', 'days'].includes(f.key)).map((f) => [f.key, shown(f)])).toEqual(
          g.fields.filter(([k]: [string]) => k !== 'terms').map(([k, value]: [string, string]) => [k, value]),
        );
        expect(v.fields.filter((f) => ['currency', 'rule', 'days'].includes(f.key)).map((f) => [f.key, f.value])).toEqual([
          ['currency', 'EUR'], ['rule', 'net'], ['days', String(d.sheet.paymentDays)],
        ]);
        expect(v.amendments.map((a) => [a.label, a.amount, a.status, a.date, a.doc ?? '', a.tagClass])).toEqual(
          g.amendments.map((a: Record<string, string>) => [a.label, a.amtText, a.status, a.date, a.doc, a.stClass]),
        );
        expect(v.bonds.map((b) => [b.label, b.amount, b.state, b.released])).toEqual(g.bonds.map((b: Record<string, string>) => [b.label, b.amtText, b.state, b.released]));
        // Base milestones as the prototype lists them, amounts by NEW-D3-3; the amendments' own milestones follow in their group.
        const baseRows = v.milestones.filter((m) => m.group == null);
        expect(baseRows.map((m) => [m.id, m.label, m.share, m.due, m.condition])).toEqual(
          g.milestones.map((m: Record<string, string>) => [gid(name, m.id), m.label, deviate(m.pctText, lang), m.due, m.condText]),
        );
        expect(v.milestones.map((m) => m.amount)).toEqual(d.milestones.map((m) => f(x.amount(m))));
        expect([v.total.share, v.total.ok ? 'var(--color-text)' : 'var(--color-accent-300)', v.total.hint]).toEqual([
          deviate(g.schedTotal.pct, lang), g.schedTotal.color, g.schedTotal.hint,
        ]);
        expect(v.total.amount).toBe(f(x.schedule));
        expect(v.reference).toBe(g.crumb.split(' · ').at(-1));
      });

  it('NEW-D3-3 groups: Amendment 1’s M6 under its amendment; an unsigned amendment’s milestones are not billable', () => {
    const t = makeT('en');
    const v = contractView(data('seed'), t, 'en');
    expect(v.groups).toEqual([{
      key: 0, label: 'Amendment 1 — anti-collision lidar (CR-004)', status: 'Signed', tagClass: 'tag tag-neutral', billable: true, note: '', share: '100 %', amount: '€120k', ok: true, hint: '',
    }]);
    expect([v.baseTotal.amount, v.total.amount]).toEqual(['€5.40M', '€5.52M']);
    const d = data('seed');
    const withPending = { ...d, milestones: [...d.milestones, { number: 'M7', label: 'Crane upgrade delivered', sharePct: 100, contractualDue: '2027-01-14', condition: null, status: 'planned' as const, invoice: null, amendment: 1 }] };
    const fr = contractView(withPending, makeT('fr'), 'fr');
    expect(fr.groups[1]).toMatchObject({ key: 1, status: 'En attente de signature', billable: false, note: 'Non facturable avant signature', amount: '260 k€' });
    expect(fr.milestones.at(-1)).toMatchObject({ id: 'M7', billable: false, group: 1 });
    // An amendment signed without its own milestones: hint.
    const bare = contractView({ ...d, milestones: d.milestones.filter((m) => m.amendment == null) }, t, 'en');
    expect(bare.groups[0]).toMatchObject({ key: 0, ok: false, hint: 'No payment milestone for this amendment' });
    expect(sentText('30 sept. 2026', 'fr')).toBe('Envoyé pour signature le 30 sept. 2026');
  });

  it('C-9: amounts in the contract’s currency, the euro equivalent at the budget rate beside the value', () => {
    const d = { ...data('seed'), sheet: { ...data('seed').sheet, currency: 'USD' as const }, fx: { currency: 'USD' as const, budgetRate: 0.9 } };
    const en = contractView(d, makeT('en'), 'en');
    expect(en.kpis[0]).toMatchObject({ value: '$5.52M', sub: '$5.40M base · 1 signed amendment · ≈ €4.97M' });
    expect(en.fields.find((f) => f.key === 'amount')!.label).toBe('Base amount (k$)');
    expect(en.fields.find((f) => f.key === 'currency')!.options!.map((o) => o.value)).toEqual(['EUR', 'USD']);
    const fr = contractView({ ...d, hasInvoices: true }, makeT('fr'), 'fr');
    expect(fr.kpis[0].value).toBe('5,52 M$');
    expect(fr.fields.find((f) => f.key === 'amount')!.label).toBe('Montant de base (k$)');
    expect(fr.fields.find((f) => f.key === 'currency')).toMatchObject({ locked: true, hint: 'Factures émises · la devise est figée' });
    expect(fr.fx).toMatchObject({ currency: 'USD', rate: '0.9', rateText: '1 USD = 0,9 €' });
    expect(billingView(d, makeT('en'), 'en').kpis[0].value).toBe('$2.97M');
  });
});

describe('Billing view = prototype render (EN, FR)', () => {
  for (const name of Object.keys(SCENARIOS))
    for (const lang of LANGS)
      it(`${name} · ${lang}`, () => {
        const g = G.scenarios[`${name}|billing|${lang}`];
        const d = data(name);
        const x = expectedFigures(d);
        const t = makeT(lang);
        const f = (k: number) => money(k, lang);
        const v = billingView(d, t, lang);
        // Labels and colours are the prototype's; the amounts are NEW-D3-3's.
        expect(v.kpis.map((k) => [k.label, k.color])).toEqual(g.kpis.map((k: Record<string, string>) => [k.label, k.color]));
        const awaiting = d.milestones.filter((m) => m.status === 'invoiced').length;
        const overdue = v.figures.invoices.filter((i) => i.overdue);
        expect(v.kpis.map((k) => [k.value, k.sub])).toEqual([
          [f(x.invoiced), t(invoicedSub(x.invoiced, x.value))],
          [f(x.paid), t(collectedSub(x.paid, x.invoiced, lang))],
          [f(x.invoiced - x.paid), t(outstandingSub(awaiting, lang === 'fr' ? `Net ${d.sheet.paymentDays} jours` : `Net ${d.sheet.paymentDays} days`, lang))],
          [f(overdue.reduce((s, i) => s + i.amountKeur, 0)), t(overdueSub(overdue.length, lang))],
          [x.next ? x.next.number : '—', x.next ? `${dataText(x.next.label, lang)} · ${t(displayOfIso(x.next.contractualDue!))} · ${f(x.amount(x.next))}` : t(allInvoicedSub(lang))],
        ]);
        const p = v.progress;
        expect([p.paidW, p.invW, p.retention, p.retentionNote, p.total]).toEqual([
          progressCss(x.paid, x.value), progressCss(x.invoiced - x.paid, x.value), f(Math.round((x.paid * d.sheet.retentionPct) / 100)), g.bill.retNote, f(x.value),
        ]);
        expect(p.rows.map((r) => [r.label, r.dot])).toEqual(g.bill.rows.map((r: Record<string, string>) => [r.k, r.dot]));
        expect(p.rows.map((r) => [r.amount, r.share])).toEqual([
          [f(x.paid), progressText(x.paid, x.value, lang)], [f(x.invoiced - x.paid), progressText(x.invoiced - x.paid, x.value, lang)],
          [f(x.value - x.invoiced), progressText(x.value - x.invoiced, x.value, lang)],
        ]);
        const late = t('Late');
        // The prototype's planned milestones (M6, Amendment 1's own, follows them — NEW-D3-3).
        expect(v.toInvoice.filter((m) => m.id !== 'M6').map((m) => [m.id, m.label, m.line, m.late])).toEqual(
          g.toInvoice.map((m: Record<string, string>) => [gid(name, m.id), m.label, `${m.due} · ${deviate(m.pctText, lang)}${m.late ? ` · ${late}` : ''}`, m.late]),
        );
        expect(v.toInvoice.map((m) => m.amount)).toEqual(x.billable.filter((m) => m.status === 'planned').map((m) => f(x.amount(m))));
        expect(v.invoices.map((i) => [i.number, i.milestone, i.label, i.issued, i.due, i.overdue ? 'var(--color-accent-300)' : 'var(--color-text)', i.paid, i.status, i.tagClass, i.canPay, i.note ?? ''])).toEqual(
          g.invoices.map((i: Record<string, string>) => [i.no, i.msId, i.label, i.issued, i.due, i.dueColor, i.paid, i.status, i.stClass, i.canPay, i.note]),
        );
        expect(v.invoices.map((i) => i.amount)).toEqual(d.milestones.filter((m) => m.invoice && m.status !== 'planned').map((m) => f(m.invoice!.amountKeur)));
        expect(String(v.figures.lateCount || '')).toBe(g.badge);
        expect(v.invoices.length === 0).toBe(g.noInvoices);
        expect(v.terms).toBe(lang === 'fr' ? `Net ${d.sheet.paymentDays} jours` : `Net ${d.sheet.paymentDays} days`);
      });
});

describe('add-forms and toasts = prototype dialogs (EN, FR)', () => {
  const fields = (d: ReturnType<typeof amendmentFormDef>) =>
    d.fields.map((f) => ({ id: f.id, label: f.label, req: !!f.required, value: f.type === 'select' ? (f.options![0] as { label: string }).label : (f.defaultValue ?? '') }));
  const proto = (key: string) =>
    G.dialogs[key].fields.map((f: { id: string; label: string; req: boolean; value: string }) => ({ id: f.id, label: f.label, req: f.req, value: f.value }));
  for (const lang of LANGS)
    it(lang, () => {
      const t = makeT(lang);
      for (const [key, def] of [['amendment', amendmentFormDef(t)], ['bond', bondFormDef(t)], ['milestone', milestoneFormDef(t)]] as const) {
        expect([def.title, def.submit, def.kind === 'run']).toEqual([G.dialogs[`${key}|${lang}`].title, G.dialogs[`${key}|${lang}`].submit, G.dialogs[`${key}|${lang}`].isRun]);
        expect(fields(def)).toEqual(proto(`${key}|${lang}`));
        const opts = def.fields.find((f) => f.type === 'select')?.options?.map((o) => (o as { label: string }).label);
        const gOpts = G.dialogs[`${key}|${lang}`].fields.find((f: { options: unknown[] }) => f.options.length)?.options.map((o: { v: string }) => o.v);
        expect(opts).toEqual(gOpts);
      }
      // NEW-D3-3: with amendments the milestone form starts with "Applies to" (base contract or an amendment).
      const withAmendments = milestoneFormDef(t, data('seed').amendments, lang);
      expect(withAmendments.fields.map((f) => f.id)).toEqual(['basis', 'label', 'pct', 'due', 'cond']);
      expect(withAmendments.fields[0].options!.map((o) => (o as { value: string }).value)).toEqual(['base', '0', '1']);
      const inv = invoiceFormDef(data('seed'), t, lang);
      const gInv = G.dialogs[`billing-primary|${lang}`];
      expect([inv.title, inv.submit, inv.kind]).toEqual([gInv.title, gInv.submit, 'run']);
      expect(fields(inv)).toEqual(proto(`billing-primary|${lang}`));
      // The prototype's planned milestones, then Amendment 1's own M6 (NEW-D3-3).
      expect(inv.fields[0].options!.map((o) => (o as { label: string }).label).slice(0, 2)).toEqual(gInv.fields[0].options.map((o: { v: string }) => o.v));
      expect(inv.fields[0].options!.map((o) => (o as { value: string }).value)).toEqual(['M4', 'M5', 'M6']);
      // Row "Issue invoice" pre-selects its milestone (afOpenWith('billing', {ms})).
      expect(G.dialogs[`billing-row-m5|${lang}`].fields[0].value).toBe(`M5 · ${lang === 'fr' ? 'Handover (SAT)' : 'Handover (SAT)'}`);
      // Toasts (AF_RESULT, translated per " · " segment by showToast).
      expect(`INV-2026-004 · M4 · ${t(RESULT.billing[0])} · ${t(RESULT.billing[1])}`).toBe(G.toasts[`issue-m4|${lang}`]);
      expect(`Amendment 3 — extra lighting · ${t(RESULT.amendment)}`).toBe(G.toasts[`amend-signed|${lang}`]);
      expect(`${t('Warranty bond')} · ${t(RESULT.bond)}`).toBe(G.toasts[`bond|${lang}`]);
      expect(t(RESULT.milestone)).toBe(G.toasts[`milestone|${lang}`]);
      expect(displayOfIso('2026-09-30')).toBe('30 Sep 2026');
      // R-079 dialogs.
      expect(signFormDef(t, 'CTR-HLT-004').fields.map((f) => [f.id, f.defaultValue])).toEqual([['date', t('30 Sep 2026')], ['doc', 'CTR-HLT-004']]);
      expect(releaseFormDef(t).fields.map((f) => f.id)).toEqual(['date']);
      expect(amendmentFormDef(t, 'USD').fields.find((f) => f.id === 'amt')!.label).toBe(lang === 'fr' ? 'Montant (k$)' : 'Amount (k$)');
    });

  it('contract-sheet fields: labels, controls, full-row textarea and contract types = the prototype (EN, FR) + currency, rule, days', () => {
    for (const lang of LANGS) {
      const v = contractView(data('seed'), makeT(lang), lang);
      const kind = (f: { isSelect: boolean; isNumber: boolean; isTextarea: boolean }) => (f.isSelect ? 'select' : f.isNumber ? 'number' : f.isTextarea ? 'textarea' : 'text');
      expect(v.fields.filter((f) => !['currency', 'rule', 'days'].includes(f.key)).map((f) => [f.key, f.label, f.type, f.type === 'textarea' ? '1 / -1' : 'auto'])).toEqual(
        G[`fieldDefs|${lang}`].filter((f: { k: string }) => f.k !== 'terms')
          .map((f: { k: string; label: string; isSelect: boolean; isNumber: boolean; isTextarea: boolean; span: string }) => [f.k, f.label, kind(f), f.span]),
      );
      expect(v.fields.find((f) => f.key === 'type')!.options!.map((o) => o.label)).toEqual(
        G[`fieldDefs|${lang}`].find((f: { k: string }) => f.k === 'type').options.map((o: { v: string }) => o.v),
      );
      const rule = v.fields.find((f) => f.key === 'rule')!;
      expect([rule.label, rule.options!.map((o) => o.label), rule.hint]).toEqual(lang === 'fr'
        ? ['Règle de paiement', ['N jours date de facture', 'N jours fin de mois', 'Fin de mois + N jours'], 'Net 45 jours']
        : ['Payment rule', ['N days from invoice date', 'N days end of month', 'End of month + N days'], 'Net 45 days']);
    }
  });

  it('every template label of the two screens has the prototype’s French', () => {
    const t = makeT('fr');
    const missing = Object.entries(G.labels as Record<string, string>).filter(([en, fr]) => t(en) !== fr);
    expect(missing).toEqual([]);
  });
});
