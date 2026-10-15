// Delivery 8, lot cost-change — R-077 (C-7, C-7a) on the rendered screens: the Contract schedule's "Edit · Remove" row actions
// for editors on planned milestones only (an actions column, colspans following), none for read-only viewers; the group hint
// "invoicing blocked" over 100 %; Billing's "Issue invoice" disabled with the reason on a blocked milestone (EN / FR).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));

import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPaymentMilestone, getContract, type ProjectContract } from '@/server/dal/contract';
import { BillingScreen } from './billing-view';
import { ContractScreen } from './contract-view';
import { amendmentFormDef, billingView, bondFormDef, contractView, editMilestoneFormDef, invoiceFormDef, milestoneFormDef, releaseFormDef, signFormDef } from './model';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function contract(c: ProjectContract, lang: Lang, canEdit = true) {
  const t = makeT(lang);
  const forms = {
    amendment: amendmentFormDef(t), bond: bondFormDef(t), milestone: milestoneFormDef(t, c.amendments, lang), sign: (doc: string | null) => signFormDef(t, doc), release: releaseFormDef(t),
    editMilestone: (onAmendment: boolean) => editMilestoneFormDef(t, onAmendment),
  };
  return html(h(ContractScreen, { view: contractView(c, t, lang), code: 'HLT-026', canEdit, canSetRate: false, context: '#026 · Harbor Line', forms, t }), lang);
}
function billing(c: ProjectContract, lang: Lang, canEdit = true) {
  const t = makeT(lang);
  return html(h(BillingScreen, { view: billingView(c, t, lang), code: 'HLT-026', canEdit, context: '#026 · Harbor Line', invoiceForm: invoiceFormDef(c, t, lang), t }), lang);
}

let seed: ProjectContract;
beforeAll(async () => {
  setDb(await openDatabase());
  seed = (await getContract('HLT-026'))!;
}, 60_000);

describe('R-077 — Contract schedule row actions', () => {
  it('editors: Edit · Remove on each planned milestone (M4, M5, M6), not on invoiced ones; an actions column', () => {
    const out = contract(seed, 'en');
    expect(out.match(/aria-label="Edit payment milestone M\d+"/g)).toEqual(['aria-label="Edit payment milestone M4"', 'aria-label="Edit payment milestone M5"', 'aria-label="Edit payment milestone M6"']);
    expect(out.match(/aria-label="Remove M\d+"/g)).toHaveLength(3);
    expect(out).not.toContain('aria-label="Edit payment milestone M1"');
    expect(out).toContain('aria-label="Actions"');
    expect(out).toContain('colSpan="6"');
    const fr = contract(seed, 'fr');
    expect(fr).toContain('aria-label="Modifier le jalon de paiement M4"');
    expect(text(fr)).toContain('Modifier');
  });

  it('read-only viewers: no actions column, the prototype colspans', () => {
    const out = contract(seed, 'en', false);
    expect(out).not.toContain('Edit payment milestone');
    expect(out).not.toContain('aria-label="Actions"');
    expect(out).not.toContain('colSpan="6"');
  });
});

describe('R-077 — blocked above 100 %', () => {
  it('the base group hint and Billing’s disabled "Issue invoice" with the reason (EN / FR); the amendment’s M6 stays invoiceable', async () => {
    expect(text(billing(seed, 'en'))).not.toContain('invoicing is blocked');
    await addPaymentMilestone('HLT-026', { label: 'Extra', sharePct: 5, contractualDue: '2027-02-01' }, 'Romain Aubert');
    const c = (await getContract('HLT-026'))!;
    expect(text(contract(c, 'en'))).toContain('Shares total 105 % · invoicing blocked');
    expect(text(contract(c, 'fr'))).toContain('Total des parts 105 % · facturation bloquée');
    const b = billing(c, 'en');
    const reason = 'Payment milestones exceed 100 % — invoicing is blocked until the schedule is corrected';
    expect(b.match(new RegExp(`disabled="" title="${reason}"`, 'g'))?.length).toBe(c.milestones.filter((m) => m.status === 'planned' && m.amendment == null).length);
    expect(text(b)).toContain(reason);
    const bfr = text(billing(c, 'fr'));
    expect(bfr).toContain('Les jalons de paiement dépassent 100 % — la facturation est bloquée jusqu’à la correction de l’échéancier');
    // M6 (Amendment 1, its own group at 100 %) keeps an enabled button.
    expect(b).toMatch(/aria-label="Issue invoice M6"(?![^>]*disabled)/);
  });
});
