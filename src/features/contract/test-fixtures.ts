// Test fixtures of the Contract / Billing golden tests: CONTRACTS['HLT-026'] (prototype line 3713) loaded the way the
// DAL loads it, and the prototype states of scripts/proto-golden-contract.ts (the mutations the two screens offer)
// applied to that input. Used by src/domain/contract.test.ts and src/features/contract/model.test.ts.
import golden from './contract.golden.json';
import data from '@/server/prototype/prototype-data.json';
import { amendmentStatus, bondType, isoOfDisplayDate, paymentMilestoneStatus } from '@/server/db/codes';
import type { ContractInput, MilestoneInput } from '@/domain/contract';
import { dataText } from '@/i18n/data-text';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const G = golden as any;
export const CT = (data as unknown as { CONTRACTS: Record<string, { ref: string; signed: string; amount: number; terms: string; retention: number; retentionNote: string; ld: string; warranty: string;
  amendments: [string, number, string, string, string][]; bonds: [string, number, string][]; milestones: [string, string, number, string, string, string, string][] }> }).CONTRACTS['HLT-026'];

const iso = (s: string) => (!s || s === '—' ? null : isoOfDisplayDate(s));

/** CONTRACTS['HLT-026'] as the DAL loads it (invoices INV-2026-001…003 numbered in milestone order). */
export function seedInput(): ContractInput {
  let seq = 0;
  return {
    sheet: {
      reference: CT.ref, baseAmountKeur: CT.amount, paymentTerms: CT.terms, retentionPct: CT.retention, retentionNote: CT.retentionNote,
      liquidatedDamages: CT.ld, warranty: CT.warranty,
    },
    amendments: CT.amendments.map(([label, amountKeur, status, date, doc]) => ({ label, amountKeur, status: amendmentStatus.code(status), signedOn: iso(date), documentRef: doc || null })),
    bonds: CT.bonds.map(([label, amountKeur, state]) => ({
      type: bondType.code(label), issuer: null, amountKeur,
      validUntil: state.startsWith('Valid → ') ? iso(state.slice(8)) : null, releasedOn: state.startsWith('Released ') ? iso(state.slice(9)) : null,
    })),
    milestones: CT.milestones.map(([number, label, sharePct, due, status, inv, paid]) => {
      const st = paymentMilestoneStatus.code(status);
      return {
        number, label, sharePct, contractualDue: iso(due), condition: null, status: st,
        invoice: st === 'planned' ? null : { number: 'INV-2026-' + String(++seq).padStart(3, '0'), issuedOn: iso(inv)!, paidOn: st === 'paid' ? iso(paid) : null, note: null },
      };
    }),
  };
}

type Mutation = (c: ContractInput) => ContractInput;
export const ms = (c: ContractInput, number: string, patch: Partial<MilestoneInput>): ContractInput => ({
  ...c, milestones: c.milestones.map((m) => (m.number === number ? { ...m, ...patch } : m)),
});
export const invoice = (number: string, issuedOn: string, note: string | null = null) => ({ number, issuedOn, paidOn: null, note });
const pay = (c: ContractInput, number: string) => {
  const m = c.milestones.find((x) => x.number === number)!;
  return ms(c, number, { status: 'paid', invoice: { ...m.invoice!, paidOn: '2026-09-30' } });
};
export const addMs = (c: ContractInput, m: Omit<MilestoneInput, 'status' | 'invoice'>) => ({ ...c, milestones: [...c.milestones, { ...m, status: 'planned' as const, invoice: null }] });

/** The prototype states of scripts/proto-golden-contract.ts, applied to the DAL-shaped input. */
export const SCENARIOS: Record<string, Mutation> = {
  seed: (c) => c,
  'issue-m4': (c) => ms(c, 'M4', { status: 'invoiced', invoice: invoice('INV-2026-004', '2026-09-30', 'Cranes 1–2 accepted') }),
  'issue-m4-overdue': (c) => ms(c, 'M4', { status: 'invoiced', invoice: invoice('INV-2026-004', '2026-08-01') }),
  'issue-all': (c) =>
    ms(ms(c, 'M4', { status: 'invoiced', invoice: invoice('INV-2026-004', '2026-09-30') }), 'M5', { status: 'invoiced', invoice: invoice('INV-2026-005', '2027-01-14') }),
  'pay-m3': (c) => pay(c, 'M3'),
  'pay-all': (c) => pay(pay(ms(c, 'M4', { status: 'invoiced', invoice: invoice('INV-2026-004', '2026-09-30') }), 'M3'), 'M4'),
  'amend-signed': (c) => ({
    ...c, amendments: [...c.amendments, { label: 'Amendment 3 — extra lighting (CR-007)', amountKeur: 80, status: 'signed', signedOn: '2026-09-30', documentRef: 'CTR-HLT-003' }],
  }),
  'amend-draft': (c) => ({ ...c, amendments: [...c.amendments, { label: 'Amendment 3 — extra lighting', amountKeur: 80, status: 'draft', signedOn: null, documentRef: null }] }),
  'amend-sign-all': (c) => ({ ...c, amendments: [...c.amendments, { label: 'x', amountKeur: 0, status: 'signed', signedOn: null, documentRef: null }] }),
  bond: (c) => ({ ...c, bonds: [...c.bonds, { type: 'warranty', issuer: 'BNP Paribas', amountKeur: 280, validUntil: '2029-01-14', releasedOn: null }] }),
  milestone: (c) => addMs(c, { number: 'M6', label: 'Final acceptance', sharePct: 5, contractualDue: '2028-01-14', condition: 'Final acceptance certificate signed' }),
  'milestone-late': (c) => addMs(c, { number: 'M6', label: 'Design review', sharePct: 2.5, contractualDue: '2026-09-15', condition: null }),
  sheet: (c) => ({
    ...c,
    sheet: { ...c.sheet, reference: 'CTR-HLT-001-A', baseAmountKeur: 6000, paymentTerms: 'Net 30 days', retentionPct: 10, liquidatedDamages: '1 % per week · cap 5 %', warranty: '36 months from SAT' },
  }),
  'sheet-terms60': (c) => ({ ...c, sheet: { ...c.sheet, paymentTerms: 'Net 60 days' } }),
};


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
