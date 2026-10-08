// Contract and Billing screens rendered statically from the seeded in-memory database (EN and FR): labels and
// figures of the prototype (04 §3–4), Codex document links, edit controls only for editors (read-only viewers get
// disabled fields and no Add / Issue invoice / Mark paid buttons), outside-workspace roles of the two screens.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./actions', () => ({
  updateContractFieldAction: vi.fn(), addAmendmentAction: vi.fn(), addBondAction: vi.fn(), addPaymentMilestoneAction: vi.fn(), issueInvoiceAction: vi.fn(), markInvoicePaidAction: vi.fn(),
}));

import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isOutside } from '@/components/app/shell/nav-model';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContract, getContractHeader, type ProjectContract } from '@/server/dal/contract';
import type { RoleKey } from '@/config/screens';
import { BillingScreen } from './billing-view';
import { ContractScreen, docHref } from './contract-view';
import { amendmentFormDef, billingView, bondFormDef, contractView, invoiceFormDef, milestoneFormDef } from './model';
import { G } from './test-fixtures';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

let hlt: ProjectContract;
beforeAll(async () => {
  setDb(await openDatabase());
  hlt = (await getContract('HLT-026'))!;
}, 60_000);

function contract(lang: Lang, canEdit = true) {
  const t = makeT(lang);
  const forms = { amendment: amendmentFormDef(t), bond: bondFormDef(t), milestone: milestoneFormDef(t) };
  return html(h(ContractScreen, { view: contractView(hlt, t, lang), code: 'HLT-026', canEdit, context: '#026 · Harbor Line', forms, t }), lang);
}
function billing(lang: Lang, canEdit = true) {
  const t = makeT(lang);
  return html(h(BillingScreen, { view: billingView(hlt, t, lang), code: 'HLT-026', canEdit, context: '#026 · Harbor Line', invoiceForm: invoiceFormDef(hlt, t, lang), t }), lang);
}

describe('Contract screen', () => {
  it('EN: KPIs, sheet, amendments with the Codex link, guarantees, schedule and total', () => {
    const out = contract('en');
    const tx = text(out);
    for (const s of [
      'Contract value €5.52M €5.40M base · 1 signed amendment',
      'Amendments pending 1 €260k awaiting signature',
      'Guarantees in force 1 / 2 €540k outstanding',
      'Liquidated damages 0.5 % per week cap 10 % · 24 months from SAT',
      'Contract sheet Fill in the terms once · billing, change control and the client portal read from here Open contract',
      'Amendments Add amendment Amendment 1 — anti-collision lidar (CR-004) 8 Jul 2026 €120k Signed',
      'Amendment 2 — crane upgrade 250 t (CR-006) — €260k Awaiting signature',
      'Bonds & guarantees Add guarantee Performance bond €540k Valid → 30 Jun 2027 Advance payment bond €540k Released 12 Sep 2026',
      'Payment milestones Contractual schedule · invoicing is tracked on the Billing page Add payment milestone',
      'Milestone Share Amount Contractual date Condition',
      'M3 · Structure topped out (80 % erected) 25 % €1.38M 26 Sep 2026 —',
      'Total 100 % €5.52M',
    ])
      expect(tx).toContain(s);
    expect(out).toContain(`href="${docHref('HLT-026', 'CTR-HLT-001')}"`);
    expect(docHref('HLT-026', 'CTR-HLT-002')).toBe('/projects/HLT-026/documents?doc=CTR-HLT-002');
    expect(out).toContain('aria-label="Open document CTR-HLT-002"');
    // Sheet fields with their prototype values; the scope is a full-row textarea.
    for (const v of ['value="CTR-HLT-001"', 'value="Port authority"', 'value="14 Jan 2026"', 'value="5400"', 'value="Net 45 days"', 'value="0.5 % per week · cap 10 %"'])
      expect(out).toContain(v);
    expect(out).toMatch(/<option value="lump_sum_epc" selected="">Lump sum \(EPC\)<\/option>/);
    expect(out).toMatch(/<textarea[^>]*rows="2"[^>]*>Terminal extension: steel structure/);
    expect(out).not.toContain('disabled=""');
  });

  it('FR: the prototype’s French render', () => {
    const tx = text(contract('fr'));
    const g = G.scenarios['seed|contract|fr'];
    for (const k of g.kpis) expect(tx).toContain(`${k.label} ${k.value} ${k.sub}`);
    for (const s of ['Fiche contrat', 'Ouvrir le contrat', 'Avenants Ajouter un avenant', 'Cautions & garanties Ajouter une garantie', 'Caution de bonne exécution 540 k€ Valable → 30 juin 2027',
      'Jalons de paiement Échéancier contractuel · la facturation se suit sur la page Facturation Ajouter un jalon de paiement', 'M1 · Permis approuvés 10 % 552 k€ 12 mars 2026', 'Total 100 % 5,52 M€'])
      expect(tx).toContain(s);
    const out = contract('fr');
    for (const v of ['value="Autorité portuaire"', 'value="14 janv. 2026"', 'value="Net 45 jours"']) expect(out).toContain(v);
    expect(out).toMatch(/<option value="lump_sum_epc" selected="">Forfait \(EPC\)<\/option>/);
  });

  it('read-only: disabled fields, no Add buttons; "Open contract" and document links stay', () => {
    const out = contract('en', false);
    expect(out.match(/disabled=""/g)?.length).toBe(12);
    expect(text(out)).not.toMatch(/Add amendment|Add guarantee|Add payment milestone/);
    expect(text(out)).toContain('Open contract');
    expect(out).toContain('aria-label="Open document CTR-HLT-002"');
  });
});

describe('Billing screen', () => {
  it('EN: KPIs, progress and retention, To invoice with its buttons, invoices with Mark paid', () => {
    const out = billing('en');
    const tx = text(out);
    for (const s of [
      'Invoiced €3.04M 55 % of contract', 'Collected €1.66M 55 % of invoiced', 'Outstanding receivables €1.38M 1 invoice awaiting payment · Net 45 days',
      'Overdue receivables €0k no late payment', 'Next to invoice M4 Cranes operational · 14 Dec 2026 · €1.10M',
      'Billing progress Contract value · €5.52M', 'Collected 30.0 % €1.66M Invoiced, awaiting payment 25.0 % €1.38M Not yet invoiced 45.0 % €2.48M',
      'Retention held by client 5 % · Released at final acceptance + 12 months €83k',
      'To invoice Planned milestones in contractual order · a date already passed is flagged M4 · Cranes operational 14 Dec 2026 · 20 % €1.10M Issue invoice M5 · Handover (SAT) 14 Jan 2027 · 25 % €1.38M Issue invoice',
      'Invoice Milestone Issued on Amount Payment due Paid on Status',
      'INV-2026-001 M1 · Permits approved 12 Mar €552k 26 Apr 2 Apr Paid',
      'INV-2026-003 M3 · Structure topped out (80 % erected) 26 Sep €1.38M 10 Nov — Awaiting payment Mark paid',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('style="--w:30.0%"');
    expect(out).toContain('style="--w:25.0%"');
    expect(out).toContain('aria-label="Issue invoice M5"');
    expect(out).toContain('aria-label="Mark paid INV-2026-003"');
    expect(out.match(/class="tag tag-outline/g)?.length).toBe(1);
    expect(out.match(/class="tag tag-neutral/g)?.length).toBe(2);
  });

  it('FR: the prototype’s French render (decimal comma in the shares)', () => {
    const tx = text(billing('fr'));
    const g = G.scenarios['seed|billing|fr'];
    for (const k of g.kpis) expect(tx).toContain(`${k.label} ${k.value} ${k.sub}`);
    for (const s of ['Avancement de la facturation Montant du contrat · 5,52 M€', 'Encaissé 30,0 % 1,66 M€', 'Retenue de garantie 5 % · Libérée à la réception définitive + 12 mois 83 k€',
      'À facturer', 'M4 · Grues opérationnelles 14 déc. 2026 · 20 % 1,10 M€ Émettre la facture', 'INV-2026-003 M3 · Structure topped out (80 % erected) 26 sept. 1,38 M€ 10 nov. — En attente de paiement Marquer payé'])
      expect(tx).toContain(s);
  });

  it('read-only: no Issue invoice / Mark paid buttons', () => {
    const tx = text(billing('en', false));
    expect(tx).not.toMatch(/Issue invoice|Mark paid/);
    expect(tx).toContain('INV-2026-003');
  });
});

describe('data access and gating', () => {
  it('projects without a contract: no contract, no header extras (empty state on both screens)', async () => {
    expect(await getContract('NDC-031')).toBeNull();
    expect(await getContract('EWA-051')).toBeNull();
    expect(await getContractHeader('HLT-026')).toEqual({ reference: 'CTR-HLT-001', paymentTerms: 'Net 45 days' });
  });

  it('outside-workspace roles = the prototype for the 8 personas (contract: director, PM, procurement; billing: director, PM)', () => {
    for (const role of ['director', 'pm', 'procurement', 'client', 'depthead', 'member', 'englead', 'quality'] as RoleKey[])
      for (const screen of ['contract', 'billing'] as const)
        for (const lang of ['en', 'fr'] as const) {
          const g = G.scenarios[`${role === 'director' ? 'seed' : role}|${screen}|${lang}`];
          // HLT-026 is never read-only for these personas, so the edit rights are the workspace rule alone.
          expect([role, screen, !isOutside(role, screen)]).toEqual([role, screen, g.ctrCanEdit]);
          // The header primary of the prototype (`hasPrimary`) follows the same rule (Billing: a milestone is still planned).
          expect([role, screen, !isOutside(role, screen)]).toEqual([role, screen, g.hasPrimary]);
          // Outside viewers still see the figures.
          expect(g.kpis.length).toBe(screen === 'contract' ? 4 : 5);
        }
  });
});
