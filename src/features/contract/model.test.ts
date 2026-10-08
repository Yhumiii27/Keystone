// Contract & Billing view models against the prototype's own renderVals() (EN and FR), for the seed and every
// mutation the two screens offer (scripts/proto-golden-contract.ts → contract.golden.json). The deliberate
// differences are applied to the prototype values explicitly (see `deviate`).
import { describe, expect, it } from 'vitest';
import { makeT, type Lang } from '@/i18n/translate';
import { displayOfIso, isoOfDisplayDate } from '@/server/db/codes';
import { amendmentFormDef, billingView, bondFormDef, contractView, invoiceFormDef, milestoneFormDef, RESULT, type ContractData } from './model';
import { CT, G, SCENARIOS, seedInput } from './test-fixtures';

const LANGS: Lang[] = ['en', 'fr'];
const data = (name: string): ContractData => {
  const c = SCENARIOS[name](seedInput());
  return {
    ...c,
    sheet: {
      ...c.sheet, client: 'Port authority', type: 'lump_sum_epc', signedOn: isoOfDisplayDate(CT.signed),
      governingLaw: 'French law · Commercial court of Le Havre',
      scope: 'Terminal extension: steel structure, two 250 t gantry cranes, HV connection and yard works — design, supply, erection and commissioning.',
    },
    nextInvoiceNumber: 'INV-2026-' + String(c.milestones.filter((m) => m.invoice).length + 1).padStart(3, '0'),
  };
};

/**
 * Deliberate differences with the prototype render:
 * - French decimal comma in shares and percentages ("2,5 %", "30,0 %"; the prototype kept "2.5 %" in French);
 * - English plural for zero invoices ("0 invoices awaiting payment").
 */
const deviate = (s: string, lang: Lang) =>
  lang === 'fr' ? s.replace(/^(\d+)\.(\d+) %$/, '$1,$2 %') : s.replace(/^0 invoice awaiting payment/, '0 invoices awaiting payment');

describe('Contract view = prototype render (EN, FR)', () => {
  for (const name of Object.keys(SCENARIOS))
    for (const lang of LANGS)
      it(`${name} · ${lang}`, () => {
        const g = G.scenarios[`${name}|contract|${lang}`];
        const v = contractView(data(name), makeT(lang), lang);
        expect(v.kpis).toEqual(g.kpis);
        expect(v.fields.map((f) => [f.key, f.type === 'select' ? f.options!.find((o) => o.value === f.value)!.label : f.value])).toEqual(
          g.fields.map(([k, value]: [string, string]) => [k, value]),
        );
        expect(v.amendments.map((a) => [a.label, a.amount, a.status, a.date, a.doc ?? '', a.tagClass])).toEqual(
          g.amendments.map((a: Record<string, string>) => [a.label, a.amtText, a.status, a.date, a.doc, a.stClass]),
        );
        expect(v.bonds.map((b) => [b.label, b.amount, b.state, b.released])).toEqual(g.bonds.map((b: Record<string, string>) => [b.label, b.amtText, b.state, b.released]));
        expect(v.milestones.map((m) => [m.id, m.label, m.share, m.amount, m.due, m.condition])).toEqual(
          g.milestones.map((m: Record<string, string>) => [m.id, m.label, deviate(m.pctText, lang), m.amtText, m.due, m.condText]),
        );
        expect([v.total.share, v.total.amount, v.total.ok ? 'var(--color-text)' : 'var(--color-accent-300)', v.total.hint]).toEqual([
          deviate(g.schedTotal.pct, lang), g.schedTotal.amt, g.schedTotal.color, g.schedTotal.hint,
        ]);
        expect(v.reference).toBe(g.crumb.split(' · ').at(-1));
      });
});

describe('Billing view = prototype render (EN, FR)', () => {
  for (const name of Object.keys(SCENARIOS))
    for (const lang of LANGS)
      it(`${name} · ${lang}`, () => {
        const g = G.scenarios[`${name}|billing|${lang}`];
        const v = billingView(data(name), makeT(lang), lang);
        expect(v.kpis).toEqual(g.kpis.map((k: Record<string, string>) => ({ ...k, sub: deviate(k.sub, lang) })));
        const p = v.progress;
        expect([p.paidW, p.invW, p.retention, p.retentionNote, p.total]).toEqual([g.bill.paidW, g.bill.invW, g.bill.retention, g.bill.retNote, g.bill.total]);
        expect(p.rows.map((r) => [r.label, r.amount, r.dot, r.share])).toEqual(g.bill.rows.map((r: Record<string, string>) => [r.k, r.v, r.dot, deviate(r.pct, lang)]));
        const late = makeT(lang)('Late');
        expect(v.toInvoice.map((m) => [m.id, m.label, m.line, m.late, m.amount])).toEqual(
          g.toInvoice.map((m: Record<string, string>) => [m.id, m.label, `${m.due} · ${deviate(m.pctText, lang)}${m.late ? ` · ${late}` : ''}`, m.late, m.amtText]),
        );
        expect(v.toInvoice.map((m) => (m.late ? 'var(--color-accent-300)' : 'var(--color-text)'))).toEqual(g.toInvoice.map((m: Record<string, string>) => m.dueColor));
        expect(v.invoices.map((i) => [i.number, i.milestone, i.label, i.issued, i.amount, i.due, i.overdue ? 'var(--color-accent-300)' : 'var(--color-text)', i.paid, i.status, i.tagClass, i.canPay, i.note ?? ''])).toEqual(
          g.invoices.map((i: Record<string, string>) => [i.no, i.msId, i.label, i.issued, i.amtText, i.due, i.dueColor, i.paid, i.status, i.stClass, i.canPay, i.note]),
        );
        expect(String(v.figures.lateCount || '')).toBe(g.badge);
        expect(v.toInvoice.length === 0).toBe(g.noToInvoice);
        expect(v.invoices.length === 0).toBe(g.noInvoices);
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
      const inv = invoiceFormDef(data('seed'), t, lang);
      const gInv = G.dialogs[`billing-primary|${lang}`];
      expect([inv.title, inv.submit, inv.kind]).toEqual([gInv.title, gInv.submit, 'run']);
      expect(fields(inv)).toEqual(proto(`billing-primary|${lang}`));
      expect(inv.fields[0].options!.map((o) => (o as { label: string }).label)).toEqual(gInv.fields[0].options.map((o: { v: string }) => o.v));
      expect(inv.fields[0].options!.map((o) => (o as { value: string }).value)).toEqual(['M4', 'M5']);
      // Row "Issue invoice" pre-selects its milestone (afOpenWith('billing', {ms})).
      expect(G.dialogs[`billing-row-m5|${lang}`].fields[0].value).toBe(`M5 · ${lang === 'fr' ? 'Handover (SAT)' : 'Handover (SAT)'}`);
      // Toasts (AF_RESULT, translated per " · " segment by showToast).
      expect(`INV-2026-004 · M4 · ${t(RESULT.billing[0])} · ${t(RESULT.billing[1])}`).toBe(G.toasts[`issue-m4|${lang}`]);
      expect(`Amendment 3 — extra lighting · ${t(RESULT.amendment)}`).toBe(G.toasts[`amend-signed|${lang}`]);
      expect(`${t('Warranty bond')} · ${t(RESULT.bond)}`).toBe(G.toasts[`bond|${lang}`]);
      expect(t(RESULT.milestone)).toBe(G.toasts[`milestone|${lang}`]);
      expect(displayOfIso('2026-09-30')).toBe('30 Sep 2026');
    });

  it('contract-sheet fields: labels, controls, full-row textarea and contract types = the prototype (EN, FR)', () => {
    for (const lang of LANGS) {
      const v = contractView(data('seed'), makeT(lang), lang);
      const kind = (f: { isSelect: boolean; isNumber: boolean; isTextarea: boolean }) => (f.isSelect ? 'select' : f.isNumber ? 'number' : f.isTextarea ? 'textarea' : 'text');
      expect(v.fields.map((f) => [f.key, f.label, f.type, f.type === 'textarea' ? '1 / -1' : 'auto'])).toEqual(
        G[`fieldDefs|${lang}`].map((f: { k: string; label: string; isSelect: boolean; isNumber: boolean; isTextarea: boolean; span: string }) => [f.k, f.label, kind(f), f.span]),
      );
      expect(v.fields.find((f) => f.key === 'type')!.options!.map((o) => o.label)).toEqual(
        G[`fieldDefs|${lang}`].find((f: { k: string }) => f.k === 'type').options.map((o: { v: string }) => o.v),
      );
    }
  });

  it('every template label of the two screens has the prototype’s French', () => {
    const t = makeT('fr');
    const missing = Object.entries(G.labels as Record<string, string>).filter(([en, fr]) => t(en) !== fr);
    expect(missing).toEqual([]);
  });
});
