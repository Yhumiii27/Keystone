// Contract and Billing screens rendered statically from the seeded in-memory database (EN and FR): labels and
// figures of the prototype (04 §3–4), Codex document links, edit controls only for editors (read-only viewers get
// disabled fields and no Add / Issue invoice / Mark paid buttons), outside-workspace roles of the two screens.
// Delivery 7: NEW-D3-3 amounts (base milestones on the base amount, Amendment 1's own M6 — R-079), the currency, payment rule
// and days fields (C-9, C-6), the amendments' signature cycle and the guarantees' release, the "Currency & budget rate" card.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./actions', () => ({
  updateContractFieldAction: vi.fn(), addAmendmentAction: vi.fn(), addBondAction: vi.fn(), addPaymentMilestoneAction: vi.fn(), issueInvoiceAction: vi.fn(), markInvoicePaidAction: vi.fn(),
  sendAmendmentAction: vi.fn(), signAmendmentAction: vi.fn(), releaseBondAction: vi.fn(), setBudgetRateAction: vi.fn(),
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
import { amendmentFormDef, billingView, bondFormDef, contractView, invoiceFormDef, milestoneFormDef, releaseFormDef, signFormDef } from './model';
import { G } from './test-fixtures';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

let hlt: ProjectContract;
beforeAll(async () => {
  setDb(await openDatabase());
  hlt = (await getContract('HLT-026'))!;
}, 60_000);

function contract(lang: Lang, canEdit = true, canSetRate = false) {
  const t = makeT(lang);
  const forms = {
    amendment: amendmentFormDef(t), bond: bondFormDef(t), milestone: milestoneFormDef(t, hlt.amendments, lang), sign: (doc: string | null) => signFormDef(t, doc), release: releaseFormDef(t),
  };
  return html(h(ContractScreen, { view: contractView(hlt, t, lang), code: 'HLT-026', canEdit, canSetRate, context: '#026 · Harbor Line', forms, t }), lang);
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
      // R-079: "Mark signed" on the amendment awaiting signature; "Release" on the guarantee in force.
      'Amendment 2 — crane upgrade 250 t (CR-006) — €260k Awaiting signature Mark signed',
      'Bonds & guarantees Add guarantee Performance bond €540k Valid → 30 Jun 2027 Release Advance payment bond €540k Released 12 Sep 2026',
      'Payment milestones Contractual schedule · invoicing is tracked on the Billing page Add payment milestone',
      'Milestone Share Amount Contractual date Condition',
      // NEW-D3-3: base milestones on the base amount (the prototype: €1.38M = 25 % of €5.52M).
      'M3 · Structure topped out (80 % erected) 25 % €1.35M 26 Sep 2026 —',
      'Base contract 100 % €5.40M',
      'Amendment 1 — anti-collision lidar (CR-004) Signed M6 · Anti-collision lidar commissioned 100 % €120k 14 Dec 2026 Lidar tested on both cranes Amendment total 100 % €120k',
      'Total billable €5.52M',
      'Currency & budget rate Budget, cash flow and portfolio finance are consolidated in euros at this rate Project currency EUR 1 € = 1 €',
    ])
      expect(tx).toContain(s);
    expect(out).toContain(`href="${docHref('HLT-026', 'CTR-HLT-001')}"`);
    expect(docHref('HLT-026', 'CTR-HLT-002')).toBe('/projects/HLT-026/documents?doc=CTR-HLT-002');
    expect(out).toContain('aria-label="Open document CTR-HLT-002"');
    // Sheet fields with their prototype values; the scope is a full-row textarea.
    for (const v of ['value="CTR-HLT-001"', 'value="Port authority"', 'value="14 Jan 2026"', 'value="5400"', 'value="45"', 'value="0.5 % per week · cap 10 %"'])
      expect(out).toContain(v);
    expect(out).toMatch(/<option value="lump_sum_epc" selected="">Lump sum \(EPC\)<\/option>/);
    // C-6: the payment rule (net 45 = "Net 45 days"); C-9: the currency (EUR, the project's only choice).
    expect(out).toMatch(/<option value="net" selected="">N days from invoice date<\/option>/);
    expect(text(out)).toContain('Payment rule N days from invoice date N days end of month End of month + N days Net 45 days Payment days');
    expect(out).toMatch(/<option value="EUR" selected="">EUR<\/option>/);
    // The budget rate editor is the director's.
    expect(text(out)).not.toContain('Save rate');
    expect(text(contract('en', true, true))).toContain('Budget rate (€ per unit)');
    expect(out).toMatch(/<textarea[^>]*rows="2"[^>]*>Terminal extension: steel structure/);
    // Only the currency is locked for an editor (C-9: invoices are issued on the seed contract).
    expect(out.match(/disabled=""/g)?.length).toBe(1);
    expect(out).toMatch(/<select[^>]*disabled=""[^>]*><option value="EUR" selected="">EUR<\/option><\/select>/);
  });

  it('FR: the prototype’s French render', () => {
    const tx = text(contract('fr'));
    const g = G.scenarios['seed|contract|fr'];
    for (const k of g.kpis) expect(tx).toContain(`${k.label} ${k.value} ${k.sub}`);
    for (const s of ['Fiche contrat', 'Ouvrir le contrat', 'Avenants Ajouter un avenant', 'Cautions & garanties Ajouter une garantie', 'Caution de bonne exécution 540 k€ Valable → 30 juin 2027',
      'Jalons de paiement Échéancier contractuel · la facturation se suit sur la page Facturation Ajouter un jalon de paiement', 'M1 · Permis approuvés 10 % 540 k€ 12 mars 2026',
      'Contrat de base 100 % 5,40 M€', 'Total de l’avenant 100 % 120 k€', 'Total facturable 5,52 M€', 'Marquer signé', 'Libérer', 'Devise et taux budgétaire'])
      expect(tx).toContain(s);
    const out = contract('fr');
    for (const v of ['value="Autorité portuaire"', 'value="14 janv. 2026"', 'value="45"']) expect(out).toContain(v);
    expect(out).toMatch(/<option value="net" selected="">N jours date de facture<\/option>/);
    expect(out).toMatch(/<option value="lump_sum_epc" selected="">Forfait \(EPC\)<\/option>/);
  });

  it('read-only: disabled fields, no Add buttons; "Open contract" and document links stay', () => {
    const out = contract('en', false);
    expect(out.match(/disabled=""/g)?.length).toBe(14);
    expect(text(out)).not.toMatch(/Add amendment|Add guarantee|Add payment milestone|Mark signed|Send for signature|Release(?!d)/);
    expect(text(out)).toContain('Open contract');
    expect(out).toContain('aria-label="Open document CTR-HLT-002"');
  });
});

describe('Billing screen', () => {
  it('EN: KPIs, progress and retention, To invoice with its buttons, invoices with Mark paid', () => {
    const out = billing('en');
    const tx = text(out);
    for (const s of [
      // NEW-D3-3: the base contract's invoices on the base amount; Amendment 1's own M6 to invoice (prototype: €3.04M, 55 %, …).
      'Invoiced €2.97M 54 % of contract', 'Collected €1.62M 55 % of invoiced', 'Outstanding receivables €1.35M 1 invoice awaiting payment · Net 45 days',
      'Overdue receivables €0k no late payment', 'Next to invoice M4 Cranes operational · 14 Dec 2026 · €1.08M',
      'Billing progress Contract value · €5.52M', 'Collected 29.3 % €1.62M Invoiced, awaiting payment 24.5 % €1.35M Not yet invoiced 46.2 % €2.55M',
      'Retention held by client 5 % · Released at final acceptance + 12 months €81k',
      'To invoice Planned milestones in contractual order · a date already passed is flagged M4 · Cranes operational 14 Dec 2026 · 20 % €1.08M Issue invoice M5 · Handover (SAT) 14 Jan 2027 · 25 % €1.35M Issue invoice M6 · Anti-collision lidar commissioned 14 Dec 2026 · 100 % €120k Issue invoice',
      'Invoice Milestone Issued on Amount Payment due Paid on Status',
      'INV-2026-001 M1 · Permits approved 12 Mar €540k 26 Apr 2 Apr Paid',
      'INV-2026-003 M3 · Structure topped out (80 % erected) 26 Sep €1.35M 10 Nov — Awaiting payment Mark paid',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('style="--w:29.3%"');
    expect(out).toContain('style="--w:24.5%"');
    expect(out).toContain('aria-label="Issue invoice M5"');
    expect(out).toContain('aria-label="Mark paid INV-2026-003"');
    expect(out.match(/class="tag tag-outline/g)?.length).toBe(1);
    expect(out.match(/class="tag tag-neutral/g)?.length).toBe(2);
  });

  it('FR: the prototype’s French render (decimal comma in the shares)', () => {
    const tx = text(billing('fr'));
    const g = G.scenarios['seed|billing|fr'];
    // The prototype's labels; the amounts are NEW-D3-3's (base contract on the base amount).
    for (const k of g.kpis) expect(tx).toContain(k.label);
    for (const s of ['Facturé 2,97 M€ 54 % du contrat', 'Encaissé 1,62 M€ 55 % du facturé', 'Net 45 jours',
      'Avancement de la facturation Montant du contrat · 5,52 M€', 'Encaissé 29,3 % 1,62 M€', 'Retenue de garantie 5 % · Libérée à la réception définitive + 12 mois 81 k€',
      'À facturer', 'M4 · Grues opérationnelles 14 déc. 2026 · 20 % 1,08 M€ Émettre la facture', 'INV-2026-003 M3 · Structure topped out (80 % erected) 26 sept. 1,35 M€ 10 nov. — En attente de paiement Marquer payé'])
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
