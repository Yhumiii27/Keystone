// Test fixtures of the Contract / Billing golden tests: CONTRACTS['HLT-026'] (prototype line 3713) loaded the way the
// DAL loads it, and the prototype states of scripts/proto-golden-contract.ts (the mutations the two screens offer)
// applied to that input. Used by src/domain/contract.test.ts and src/features/contract/model.test.ts.
//
// Delivery 7 — NEW-D3-3 (owner answer a, R-079): a signed amendment no longer re-prices the milestones. The seed (and so this
// fixture) prices the base contract's invoices on the base amount (INV-2026-001 €540k, was €552k) and gives Amendment 1 its own
// milestone M6 (100 % of €120k, 14 Dec 2026). `expectedFigures` restates the owner's rule independently of the domain, so the
// goldens' amounts can be replaced by the values the rule gives (the prototype re-priced everything on base + signed amendments).
import golden from './contract.golden.json';
import data from '@/server/prototype/prototype-data.json';
import { amendmentStatus, bondType, isoOfDemoDate, paymentMilestoneStatus } from '@/server/db/codes';
import type { ContractInput, InvoiceInput, MilestoneInput } from '@/domain/contract';
import { dataText } from '@/i18n/data-text';
import type { ContractData } from './model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const G = golden as any;
export const CT = (data as unknown as { CONTRACTS: Record<string, { ref: string; signed: string; amount: number; terms: string; retention: number; retentionNote: string; ld: string; warranty: string;
  amendments: [string, number, string, string, string][]; bonds: [string, number, string][]; milestones: [string, string, number, string, string, string, string][] }> }).CONTRACTS['HLT-026'];

const iso = (s: string) => (!s || s === '—' ? null : isoOfDemoDate(s));

/** Amendment 1's own milestone in the seed (NEW-D3-3, src/server/db/seed/contract.ts `AMENDMENT_MILESTONES`). */
export const M6: MilestoneInput = {
  number: 'M6', label: 'Anti-collision lidar commissioned', sharePct: 100, contractualDue: '2026-12-14', condition: 'Lidar tested on both cranes',
  status: 'planned', invoice: null, amendment: 0,
};

/** CONTRACTS['HLT-026'] as the DAL loads it (invoices INV-2026-001…003 numbered in milestone order, priced on the base amount). */
export function seedInput(): ContractInput {
  let seq = 0;
  return {
    sheet: {
      reference: CT.ref, baseAmountKeur: CT.amount, currency: 'EUR', paymentTerms: CT.terms, paymentRule: 'net', paymentDays: 45, retentionPct: CT.retention,
      retentionNote: CT.retentionNote, liquidatedDamages: CT.ld, warranty: CT.warranty,
    },
    amendments: CT.amendments.map(([label, amountKeur, status, date, doc], position) => ({
      position, label, amountKeur, status: amendmentStatus.code(status), signedOn: iso(date), documentRef: doc || null,
    })),
    bonds: CT.bonds.map(([label, amountKeur, state]) => ({
      type: bondType.code(label), issuer: null, amountKeur,
      validUntil: state.startsWith('Valid → ') ? iso(state.slice(8)) : null, releasedOn: state.startsWith('Released ') ? iso(state.slice(9)) : null,
    })),
    milestones: [
      ...CT.milestones.map(([number, label, sharePct, due, status, inv, paid]): MilestoneInput => {
        const st = paymentMilestoneStatus.code(status);
        return {
          number, label, sharePct, contractualDue: iso(due), condition: null, status: st, amendment: null,
          invoice: st === 'planned' ? null : {
            number: 'INV-2026-' + String(++seq).padStart(3, '0'), issuedOn: iso(inv)!, paidOn: st === 'paid' ? iso(paid) : null, note: null,
            amountKeur: Math.round((CT.amount * sharePct) / 100),
          },
        };
      }),
      M6,
    ],
  };
}

type Mutation = (c: ContractInput) => ContractInput;
export const ms = (c: ContractInput, number: string, patch: Partial<MilestoneInput>): ContractInput => ({
  ...c, milestones: c.milestones.map((m) => (m.number === number ? { ...m, ...patch } : m)),
});
/** Basis of a milestone under NEW-D3-3: the base amount, or its amendment's amount. */
const basisOf = (c: ContractInput, m: Pick<MilestoneInput, 'amendment'>) =>
  m.amendment == null ? c.sheet.baseAmountKeur : c.amendments.find((a) => a.position === m.amendment)?.amountKeur ?? 0;
/** An invoice issued now for milestone `number`: at the milestone's current amount (what `issueInvoice` records). */
export const invoiceOf = (c: ContractInput, number: string, invNo: string, issuedOn: string, note: string | null = null): InvoiceInput => {
  const m = c.milestones.find((x) => x.number === number)!;
  return { number: invNo, issuedOn, paidOn: null, note, amountKeur: Math.round((basisOf(c, m) * m.sharePct) / 100) };
};
const issue = (c: ContractInput, number: string, invNo: string, issuedOn: string, note: string | null = null) =>
  ms(c, number, { status: 'invoiced', invoice: invoiceOf(c, number, invNo, issuedOn, note) });
const pay = (c: ContractInput, number: string) => {
  const m = c.milestones.find((x) => x.number === number)!;
  return ms(c, number, { status: 'paid', invoice: { ...m.invoice!, paidOn: '2026-09-30' } });
};
/** A milestone of the base contract appended to the schedule (as `addPaymentMilestone` does: after M6, Amendment 1's). */
export const addMs = (c: ContractInput, m: Omit<MilestoneInput, 'status' | 'invoice'>) => ({
  ...c, milestones: [...c.milestones, { amendment: null, ...m, status: 'planned' as const, invoice: null }],
});

/** The prototype states of scripts/proto-golden-contract.ts, applied to the DAL-shaped input. */
export const SCENARIOS: Record<string, Mutation> = {
  seed: (c) => c,
  'issue-m4': (c) => issue(c, 'M4', 'INV-2026-004', '2026-09-30', 'Cranes 1–2 accepted'),
  'issue-m4-overdue': (c) => issue(c, 'M4', 'INV-2026-004', '2026-08-01'),
  'issue-all': (c) => issue(issue(c, 'M4', 'INV-2026-004', '2026-09-30'), 'M5', 'INV-2026-005', '2027-01-14'),
  'pay-m3': (c) => pay(c, 'M3'),
  'pay-all': (c) => pay(pay(issue(c, 'M4', 'INV-2026-004', '2026-09-30'), 'M3'), 'M4'),
  'amend-signed': (c) => ({
    ...c, amendments: [...c.amendments, { position: 2, label: 'Amendment 3 — extra lighting (CR-007)', amountKeur: 80, status: 'signed', signedOn: '2026-09-30', documentRef: 'CTR-HLT-003' }],
  }),
  'amend-draft': (c) => ({ ...c, amendments: [...c.amendments, { position: 2, label: 'Amendment 3 — extra lighting', amountKeur: 80, status: 'draft', signedOn: null, documentRef: null }] }),
  'amend-sign-all': (c) => ({ ...c, amendments: [...c.amendments, { position: 2, label: 'x', amountKeur: 0, status: 'signed', signedOn: null, documentRef: null }] }),
  bond: (c) => ({ ...c, bonds: [...c.bonds, { type: 'warranty', issuer: 'BNP Paribas', amountKeur: 280, validUntil: '2029-01-14', releasedOn: null }] }),
  milestone: (c) => addMs(c, { number: 'M7', label: 'Final acceptance', sharePct: 5, contractualDue: '2028-01-14', condition: 'Final acceptance certificate signed' }),
  'milestone-late': (c) => addMs(c, { number: 'M7', label: 'Design review', sharePct: 2.5, contractualDue: '2026-09-15', condition: null }),
  sheet: (c) => ({
    ...c,
    sheet: { ...c.sheet, reference: 'CTR-HLT-001-A', baseAmountKeur: 6000, paymentTerms: 'Net 30 days', paymentDays: 30, retentionPct: 10, liquidatedDamages: '1 % per week · cap 5 %', warranty: '36 months from SAT' },
  }),
  'sheet-terms60': (c) => ({ ...c, sheet: { ...c.sheet, paymentTerms: 'Net 60 days', paymentDays: 60 } }),
};

/**
 * NEW-D3-3 restated for the goldens: a milestone is worth its invoice once invoiced, else round(basis × share / 100) with the
 * basis = the base amount or its amendment's amount; only base milestones and those of signed amendments are billable.
 */
export function expectedFigures(c: ContractInput) {
  const signed = new Set(c.amendments.filter((a) => a.status === 'signed').map((a) => a.position));
  const amount = (m: MilestoneInput) => (m.status !== 'planned' && m.invoice ? m.invoice.amountKeur : Math.round((basisOf(c, m) * m.sharePct) / 100));
  const billable = c.milestones.filter((m) => m.amendment == null || signed.has(m.amendment));
  const sum = (xs: MilestoneInput[]) => xs.reduce((s, m) => s + amount(m), 0);
  const invoiced = sum(billable.filter((m) => m.status !== 'planned'));
  const paid = sum(billable.filter((m) => m.status === 'paid'));
  const value = c.sheet.baseAmountKeur + c.amendments.filter((a) => a.status === 'signed').reduce((s, a) => s + a.amountKeur, 0);
  return { amount, billable, invoiced, paid, value, schedule: sum(billable), next: billable.find((m) => m.status === 'planned') ?? null };
}

/** A scenario as the screens' view models receive it (the sheet fields the DAL adds; the next invoice number). */
export function scenarioData(name: string): ContractData {
  const c = SCENARIOS[name](seedInput());
  return {
    ...c,
    sheet: {
      ...c.sheet, client: 'Port authority', type: 'lump_sum_epc', signedOn: isoOfDemoDate(CT.signed),
      governingLaw: 'French law · Commercial court of Le Havre',
      scope: 'Terminal extension: steel structure, two 250 t gantry cranes, HV connection and yard works — design, supply, erection and commissioning.',
    },
    nextInvoiceNumber: 'INV-2026-' + String(c.milestones.filter((m) => m.invoice).length + 1).padStart(3, '0'),
    // R-013: the golden comparison keeps the prototype's "now" (PG_NOW / NOWD = 30 Sep 2026), passed explicitly.
    today: '2026-09-30',
  };
}

/**
 * R-148 (NEW-D1-2, X-12b): the contract sheet's typed fields are shown as typed — in French, the English value of the
 * same scenario through `dataText` (its seeded dictionary entry, if any) instead of the prototype's partial translation
 * ("Net 30 days" stays "Net 30 days", not "Net 30 jours").
 */
const TYPED_SHEET_FIELDS = new Set(['ref', 'client', 'terms', 'retentionNote', 'ld', 'warranty', 'law', 'scope']);
export function sheetFieldsExpected(scenario: string, lang: 'en' | 'fr'): [string, string][] {
  const g = G.scenarios[`${scenario}|contract|${lang}`];
  const en = G.scenarios[`${scenario}|contract|en`];
  return g.fields.map(([k, x]: [string, string]) => [k, lang === 'fr' && TYPED_SHEET_FIELDS.has(k) ? dataText(en.fields.find((f: [string, string]) => f[0] === k)[1], 'fr') : x]);
}
