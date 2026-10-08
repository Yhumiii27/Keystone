// Purchasing seed (docs/spec/11 §8.5): RFQs with their quotes (RFQS 3526), purchase orders (HLT_POS 3406 and the
// generated `genPOs` 3415 of the other projects with data — PROTO_GEN.genPOs), goods receipts (HLT_DELIV 3468 and
// `genDeliv` 4449, materialised here with the prototype's rules) and supplier invoices (INVOICES 3531). PO lines are
// priced at the catalogue list price, as the prototype values orders (A-11). Projects without data get nothing.
import { eq } from 'drizzle-orm';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { awardRule, isoOfDisplayDate, poStatus, receiptStatus, rfqStatus, supplierInvoiceStatus, type ReceiptStatus } from '../codes';
import { goodsReceipts, poLines, purchaseOrders, receiptAttachments, receiptLines, rfqQuotes, rfqs, supplierInvoices } from '../schema';
import type { Tx } from '../types';
import type { ProtoPart } from './catalogue';
import { must, newId, personIdOrNull, type SeedCtx } from './context';

/** Delivery / terms of every prototype order (poVals 4336). */
export const PO_DELIVERY_TERMS = 'Site gate 2 · DAP · Net 30';
/**
 * Buyer who raised the seed orders and registered the seed receipts: the prototype shows him as the submitter of every
 * PO and receipt awaiting a decision (apprItems 4723, 4725). Orders and receipts created in Keystone record the viewer.
 */
export const SEED_BUYER = 'Fabien Bertrand';
/** Payment terms of every prototype supplier invoice (invVals 4671). */
export const INVOICE_TERMS = 'Net 30';

interface ProtoPo { id: string; supplier: string; lines: [string, number, number][]; status: string; ordered: string; expected: string; act: string | null }
export interface ProtoReceipt {
  id: string; po: string; supplier: string; date: string; carrier: string; note: string; status: string;
  lines: [string, number, number, number, number, string][]; qc: { by: string; result: string; remarks: string }; docs: string[]; photos: number;
}

const dash = (s: string | null | undefined) => (!s || s === '—' ? null : s);

/** Generated receipts of a project with data (genDeliv 4449): one per received / partially received PO. */
export function generatedReceipts(code: string, pos: ProtoPo[], defIdx: number): ProtoReceipt[] {
  const p3 = code.slice(0, 3);
  return pos
    .filter((o) => o.status === 'Received' || o.status === 'Partially received')
    .map((o, i) => {
      const received = o.status === 'Received';
      return {
        id: 'BL-2026-0' + (300 + defIdx * 10 + i), po: o.id, supplier: o.supplier, date: o.expected, carrier: '—',
        note: o.supplier.slice(0, 2).toUpperCase() + '-' + (4100 + i * 7), status: received ? 'Accepted' : 'QC pending',
        lines: o.lines.map((l) => [l[0], l[1], l[2], received ? l[2] : 0, 0, 'Magasin chantier — ' + (p3 === 'MSR' ? 'Marseille' : 'Lyon')] as ProtoReceipt['lines'][number]),
        qc: received ? { by: 'Hélène Sauvage', result: 'Passed', remarks: 'Visual + documentary check' } : { by: '—', result: 'Pending', remarks: 'Inspection to schedule' },
        docs: ['Delivery note.pdf'], photos: received ? 2 : 0,
      };
    });
}

/** Receipts of a project (HLT_DELIV for Harbor Line, generated elsewhere; none without data). */
export function receiptsOfProject(code: string): ProtoReceipt[] {
  if (code === 'HLT-026') return PROTO.HLT_DELIV as ProtoReceipt[];
  const idx = PROTO.DEFS[code]?.idx as number | undefined;
  return idx == null ? [] : generatedReceipts(code, (PROTO_GEN.genPOs[code] ?? []) as ProtoPo[], idx);
}

export async function seedPurchasing(tx: Tx, ctx: SeedCtx): Promise<void> {
  const price = new Map((PROTO.PARTS as ProtoPart[]).map((p) => [p.ref, p.price]));
  const buyer = personIdOrNull(ctx, SEED_BUYER);

  // Purchase orders and lines, per project with data, genPOs order.
  const poOf = new Map<string, { id: string; projectId: string }>();
  for (const [code, list] of Object.entries(PROTO_GEN.genPOs as Record<string, ProtoPo[]>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const acts = ctx.activity.get(code);
    for (const [position, o] of list.entries()) {
      const id = newId();
      const supplierId = must(ctx.supplierByName, o.supplier, 'supplier');
      ctx.purchaseOrder.set(o.id, id);
      await tx.insert(purchaseOrders).values({
        id, number: o.id, projectId, supplierId, status: poStatus.code(o.status), origin: 'x3', orderedOn: isoOfDisplayDate(o.ordered), expectedOn: isoOfDisplayDate(o.expected),
        neededForActivityId: (o.act && acts?.get(o.act)) || null, deliveryTerms: PO_DELIVERY_TERMS, createdByPersonId: buyer,
        submittedByPersonId: o.status === 'Draft' ? null : buyer, position,
      });
      await tx.insert(poLines).values(o.lines.map(([ref, ordered, received], i) => ({
        id: newId(), poId: id, partId: must(ctx.partByRef, ref, 'part'), orderedQty: ordered, receivedQty: received, unitPriceEur: price.get(ref) ?? 0, position: i,
      })));
      poOf.set(o.id, { id, projectId });
    }
  }

  // Goods receipts.
  for (const code of Object.keys(PROTO_GEN.genPOs)) {
    for (const [position, d] of receiptsOfProject(code).entries()) {
      const po = poOf.get(d.po);
      if (!po) throw new Error(`Seed: receipt ${d.id} cites unknown order ${d.po}`);
      const id = newId();
      ctx.receipt.set(d.id, id);
      const status: ReceiptStatus = receiptStatus.code(d.status);
      const date = isoOfDisplayDate(d.date);
      await tx.insert(goodsReceipts).values({
        id, number: d.id, poId: po.id, projectId: po.projectId, supplierId: must(ctx.supplierByName, d.supplier, 'supplier'), status,
        expectedOn: status === 'announced' ? date : null, receivedOn: status === 'announced' ? null : date, carrier: dash(d.carrier),
        supplierDeliveryNote: dash(d.note), receivedByPersonId: status === 'announced' ? null : buyer, qcByName: dash(d.qc.by), qcByPersonId: personIdOrNull(ctx, dash(d.qc.by)), qcResult: dash(d.qc.result),
        qcRemarks: dash(d.qc.remarks), position,
      });
      await tx.insert(receiptLines).values(d.lines.map(([ref, ordered, delivered, accepted, rejected, loc], i) => ({
        id: newId(), receiptId: id, partId: must(ctx.partByRef, ref, 'part'), orderedQty: ordered, deliveredQty: delivered, acceptedQty: accepted, rejectedQty: rejected,
        putAwayLocationId: must(ctx.locationByName, loc, 'storage location'), position: i,
      })));
      const att = [
        ...d.docs.map((fileName) => ({ kind: 'document' as const, fileName })),
        ...Array.from({ length: d.photos }, () => ({ kind: 'photo' as const, fileName: null })),
      ];
      if (att.length) await tx.insert(receiptAttachments).values(att.map((a, i) => ({ id: newId(), receiptId: id, ...a, position: i })));
    }
  }

  // RFQs and quotes.
  for (const [position, r] of (PROTO.RFQS as { id: string; title: string; part: string; qty: number; due: string; status: string; rule: string; owner: string; quotes: [string, number, number, string, 'A' | 'B' | 'C', number][]; chosen: string | null }[]).entries()) {
    const id = newId();
    const quotes = r.quotes.map(([sup, unitPriceEur, leadWeeks, paymentTerms, grade, score], i) => ({
      id: newId(), rfqId: id, supplierId: must(ctx.supplierByName, sup, 'supplier'), unitPriceEur, leadWeeks, paymentTerms, grade, score, position: i,
    }));
    await tx.insert(rfqs).values({
      id, number: r.id, title: r.title, partId: must(ctx.partByRef, r.part, 'part'), quantity: r.qty, replyDueOn: isoOfDisplayDate(r.due)!, status: rfqStatus.code(r.status),
      awardRule: awardRule.code(r.rule), ownerName: r.owner, ownerPersonId: personIdOrNull(ctx, r.owner), invitedSuppliers: r.quotes.map((q) => q[0]), position,
    });
    if (quotes.length) await tx.insert(rfqQuotes).values(quotes);
    const chosen = r.chosen ? quotes[r.quotes.findIndex((q) => q[0] === r.chosen)] : null;
    if (chosen) await tx.update(rfqs).set({ awardedQuoteId: chosen.id }).where(eq(rfqs.id, id));
  }

  // Supplier invoices.
  await tx.insert(supplierInvoices).values((PROTO.INVOICES as { id: string; supplier: string; po: string; gr: string; amount: number; poAmt: number; grAmt: number; date: string; dueDate: string; status: string }[]).map((i, position) => ({
    id: newId(), number: i.id, supplierId: must(ctx.supplierByName, i.supplier, 'supplier'), poId: i.po ? must(ctx.purchaseOrder, i.po, 'purchase order') : null,
    receiptId: i.gr ? must(ctx.receipt, i.gr, 'goods receipt') : null, amountEur: i.amount, poAmountEur: i.poAmt, receiptAmountEur: i.grAmt,
    invoiceDate: isoOfDisplayDate(i.date)!, dueDate: isoOfDisplayDate(i.dueDate)!, paymentTerms: INVOICE_TERMS, status: supplierInvoiceStatus.code(i.status), position,
  })));
}
