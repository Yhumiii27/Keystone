// Contract & billing seed: the HLT-026 client contract (CONTRACTS 3713) with its amendments, bonds, payment
// milestones and the customer invoices of the milestones already invoiced (INV-2026-001…003, numbered in milestone
// order as `ctrInvoices` does); the legacy billing plans (BILLING 3541) of the projects without a contract,
// migrated into payment milestones (A-5, 11 §7 #3); and the portfolio cash forecast (CASH_M 3542 + logic 4518).
import { PROTO } from '@/server/prototype';
import {
  amendmentStatus, billingModel, bondType, contractType, isoOfDisplayDate, paymentMilestoneStatus, type PaymentMilestoneStatus,
} from '../codes';
import {
  billingPlans, contractAmendments, contractBonds, contracts, customerInvoices, paymentMilestones, portfolioCashForecasts,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';

export interface ProtoContract {
  ref: string; client: string; signed: string; amount: number; terms: string; retention: number; retentionNote: string; ld: string; warranty: string;
  type: string; law: string; scope: string;
  /** [label, amount, status, signature date, document ref] */
  amendments: [string, number, string, string, string][];
  /** [label, amount, "Valid → 30 Jun 2027" | "Released 12 Sep 2026"] */
  bonds: [string, number, string][];
  /** [id, label, share %, contractual date, status, invoice date, paid date] */
  milestones: [string, string, number, string, string, string, string][];
}

/**
 * Portfolio cash forecast of the next 6 months: the prototype's planning figures (`cashIn` / `cashOut`, logic 4518)
 * for CASH_M (Oct 2026 … Mar 2027), k€.
 */
export const CASH_FORECAST: readonly { month: string; cashIn: number; cashOut: number }[] = [
  { month: '2026-10-01', cashIn: 1350, cashOut: 820 },
  { month: '2026-11-01', cashIn: 0, cashOut: 760 },
  { month: '2026-12-01', cashIn: 1080, cashOut: 700 },
  { month: '2027-01-01', cashIn: 0, cashOut: 640 },
  { month: '2027-02-01', cashIn: 1350, cashOut: 560 },
  { month: '2027-03-01', cashIn: 585, cashOut: 520 },
];

const dateOrNull = (s: string | null | undefined) => (!s || s === '—' ? null : isoOfDisplayDate(s));
/** "Amendment 1 — anti-collision lidar (CR-004)" → subject + change request reference. */
export function splitAmendmentLabel(label: string): { subject: string; crRef: string | null } {
  const m = /^(.*) \((CR-\d+)\)$/.exec(label);
  return m ? { subject: m[1], crRef: m[2] } : { subject: label, crRef: null };
}
/** "Valid → 30 Jun 2027" / "Released 12 Sep 2026". */
export function parseBondState(state: string): { validUntil: string | null; releasedOn: string | null } {
  const v = /^Valid → (.+)$/.exec(state);
  const r = /^Released (.+)$/.exec(state);
  return { validUntil: v ? dateOrNull(v[1]) : null, releasedOn: r ? dateOrNull(r[1]) : null };
}

export async function seedContract(tx: Tx, ctx: SeedCtx): Promise<void> {
  const all = PROTO.CONTRACTS as Record<string, ProtoContract>;
  for (const [code, ct] of Object.entries(all)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const contractId = newId();
    await tx.insert(contracts).values({
      id: contractId, projectId, reference: ct.ref, documentId: ctx.document.get(ct.ref) ?? null, clientName: ct.client,
      clientId: ctx.clientByName.get(ct.client) ?? null, type: contractType.code(ct.type), signedOn: dateOrNull(ct.signed), baseAmountKeur: ct.amount,
      paymentTerms: ct.terms, retentionPct: ct.retention, retentionNote: ct.retentionNote, liquidatedDamages: ct.ld, warranty: ct.warranty,
      governingLaw: ct.law, scope: ct.scope,
    });
    const crs = ctx.changeRequest.get(code);
    await tx.insert(contractAmendments).values(
      ct.amendments.map(([label, amount, status, date, doc], position) => {
        const { subject, crRef } = splitAmendmentLabel(label);
        return {
          id: newId(), contractId, position, subject, changeRequestRef: crRef, changeRequestId: (crRef && crs?.get(crRef)) || null, amountKeur: amount,
          status: amendmentStatus.code(status), signedOn: dateOrNull(date), documentRef: doc || null, documentId: (doc && ctx.document.get(doc)) || null,
        };
      }),
    );
    await tx.insert(contractBonds).values(
      ct.bonds.map(([label, amount, state], position) => ({ id: newId(), contractId, position, type: bondType.code(label), issuer: null, amountKeur: amount, ...parseBondState(state) })),
    );
    // Contract value at seed time (base + signed amendments) prices the invoices already issued.
    const value = ct.amount + ct.amendments.filter((a) => a[2] === 'Signed').reduce((s, a) => s + a[1], 0);
    let seq = 0;
    for (const [number, label, pct, due, status, inv, paid] of ct.milestones) {
      const msId = newId();
      const st = paymentMilestoneStatus.code(status);
      await tx.insert(paymentMilestones).values({
        id: msId, projectId, contractId, number, label, sharePct: pct, amountKeur: null, contractualDue: dateOrNull(due), condition: null, status: st,
        position: ct.milestones.findIndex((m) => m[0] === number),
      });
      if (st !== 'planned')
        await tx.insert(customerInvoices).values({
          id: newId(), paymentMilestoneId: msId, number: 'INV-2026-' + String(++seq).padStart(3, '0'), issuedOn: dateOrNull(inv)!,
          amountKeur: Math.round((value * pct) / 100), paidOn: st === 'paid' ? dateOrNull(paid) : null, note: null,
        });
    }
  }

  // Billing plans: model + legacy contract value (null when the contract is the source) and the legacy milestones.
  const billing = PROTO.BILLING as Record<string, [string, number, [string, number, string][]]>;
  for (const [code, [model, value, rows]] of Object.entries(billing)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const hasContract = !!all[code];
    await tx.insert(billingPlans).values({ projectId, model: billingModel.code(model), contractValueKeur: hasContract ? null : value });
    if (hasContract || !rows.length) continue;
    await tx.insert(paymentMilestones).values(
      rows.map(([label, amount, status], position) => ({
        id: newId(), projectId, contractId: null, number: null, label, sharePct: null, amountKeur: amount, contractualDue: null, condition: null,
        status: paymentMilestoneStatus.code(status) as PaymentMilestoneStatus, position,
      })),
    );
  }

  const labels = PROTO.CASH_M as string[];
  if (labels.length !== CASH_FORECAST.length) throw new Error('Seed: CASH_M does not match the cash forecast');
  await tx.insert(portfolioCashForecasts).values(CASH_FORECAST.map((m, position) => ({ month: m.month, cashInKeur: m.cashIn, cashOutKeur: m.cashOut, position })));
}
