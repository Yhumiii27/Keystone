// Purchasing (docs/spec/11 §3.8 Rfq, PurchaseOrder, GoodsReceipt, SupplierInvoice; screens 08 §1–3): requests for
// quotation with their quotes and award, purchase orders and their lines, goods receipts with incoming quality control,
// and supplier invoices checked by the 3-way match. Amounts are full euros (`*_eur`). Sage X3 is the accounting
// reference: `x3_*` columns carry the ERP references once pushed.
import { date, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AwardRule, Incoterm, PoOrigin, PoStatus, ReceiptAttachmentKind, ReceiptStatus, RfqStatus, SupplierGrade, SupplierInvoiceStatus } from '../codes';
import { eur, id, num, timestamps } from './_common';
import { parts } from './catalogue';
import { storedFiles } from './files';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';
import { storageLocations, suppliers } from './suppliers';

/** Requests for quotation (RFQS 3526; New RFQ form AF.procurement). */
export const rfqs = pgTable('rfqs', {
  id: id(),
  /** "RFQ-2026-031". */
  number: text('number').notNull().unique(),
  /** Project the purchase is for; null for the seed RFQs (the prototype does not record it). */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  /** Article requested (seed RFQ-2026-031: title "Steel plate S355" but part KS-STL-0450, OPEN QUESTION SC-7 — kept as is). */
  partId: uuid('part_id').references(() => parts.id),
  /** Quantity requested; null when the New RFQ form named the articles in free text only. */
  quantity: num('quantity'),
  /** Quotes due. */
  replyDueOn: date('reply_due_on', { mode: 'string' }).notNull(),
  status: text('status').$type<RfqStatus>().notNull(),
  awardRule: text('award_rule').$type<AwardRule>().notNull(),
  /** Buyer (as cited: "Fabien Bertrand"). */
  ownerName: text('owner_name').notNull(),
  ownerPersonId: uuid('owner_person_id').references(() => persons.id),
  incoterm: text('incoterm').$type<Incoterm>(),
  /** Suppliers consulted, as typed in the New RFQ form (free text until a supplier picker exists, SC-4). */
  invitedSuppliers: text('invited_suppliers').array().notNull().default([]),
  /** Articles requested as typed in the New RFQ form when no catalogue part was picked. */
  articlesText: text('articles_text'),
  /** Quote chosen on award (`chosen`). */
  awardedQuoteId: uuid('awarded_quote_id').references((): AnyPgColumn => rfqQuotes.id),
  awardedByPersonId: uuid('awarded_by_person_id').references(() => persons.id),
  awardedAt: timestamp('awarded_at', { withTimezone: true }),
  /** Draft purchase order created by the award (SC-1). */
  purchaseOrderId: uuid('purchase_order_id').references((): AnyPgColumn => purchaseOrders.id, { onDelete: 'set null' }),
  /** RFQS order; RFQs created in Keystone are listed first (lower value). */
  position: integer('position').notNull(),
  ...timestamps,
});

/** Supplier quotes of an RFQ (`quotes: [supplier, unit price €, lead weeks, terms, grade, score]`). */
export const rfqQuotes = pgTable(
  'rfq_quotes',
  {
    id: id(),
    rfqId: uuid('rfq_id').notNull().references(() => rfqs.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    unitPriceEur: eur('unit_price_eur').notNull(),
    leadWeeks: integer('lead_weeks').notNull(),
    /** "Net 45". */
    paymentTerms: text('payment_terms').notNull(),
    /** Rating carried by the quote (not joined to the scorecard, as in the prototype). */
    grade: text('grade').$type<SupplierGrade>().notNull(),
    /** 0–100. */
    score: integer('score').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.rfqId, t.supplierId)],
);

/**
 * Purchase orders (HLT_POS 3406 + genPOs 3415 per project with data; drafts from the BOM shortfall assistant and RFQ
 * awards). Value = Σ line qty × line unit price (derived).
 */
export const purchaseOrders = pgTable('purchase_orders', {
  id: id(),
  /** "PO-1082"; drafts PO-1100…. */
  number: text('number').notNull().unique(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  status: text('status').$type<PoStatus>().notNull(),
  origin: text('origin').$type<PoOrigin>().notNull(),
  /** Order document date (`ordered`; the table shows "—" while Draft). */
  orderedOn: date('ordered_on', { mode: 'string' }),
  /** Expected delivery; null = "To confirm". */
  expectedOn: date('expected_on', { mode: 'string' }),
  /** Activity that needs the material (`act`, late-delivery risk). */
  neededForActivityId: uuid('needed_for_activity_id').references(() => activities.id, { onDelete: 'set null' }),
  /** "Site gate 2 · DAP · Net 30" (drawer "Delivery / terms"). */
  deliveryTerms: text('delivery_terms').notNull(),
  /** C-9 (R-075): currency of the order (EUR or the project currency); the line prices (`unit_price_eur`) are in it. */
  currency: text('currency').notNull().default('EUR'),
  createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
  submittedByPersonId: uuid('submitted_by_person_id').references(() => persons.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  /** Approver of "Approve & order" (or the rejecter when cancelled from the approval). */
  decidedByPersonId: uuid('decided_by_person_id').references(() => persons.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  /**
   * R-095 (SC-3a, P-5c): why a Keystone-drafted order was cancelled before it was placed — a Draft cancelled, an order
   * withdrawn from approval, or rejected in My approvals — by whom and when. Null for the seed's cancelled orders.
   */
  cancelReason: text('cancel_reason'),
  cancelledByPersonId: uuid('cancelled_by_person_id').references(() => persons.id),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  /** Sage X3 order reference once pushed. */
  x3Ref: text('x3_ref'),
  /** Order of the project's list (genPOs order; new orders appended). */
  position: integer('position').notNull(),
  ...timestamps,
});

/** Order lines (`lines: [ref, ordered qty, received qty]`). */
export const poLines = pgTable(
  'po_lines',
  {
    id: id(),
    poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id),
    orderedQty: num('ordered_qty').notNull(),
    /** Quantity received (accepted at goods receipt); the seed's value is the ERP's. */
    receivedQty: num('received_qty').notNull(),
    /**
     * Unit price of the line, € (A-11). The prototype values every order at the catalogue list price; the seed and the
     * shortfall drafts store that price, an RFQ award stores the quoted price.
     */
    unitPriceEur: eur('unit_price_eur').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.poId, t.partId)],
);

/** Goods receipts / deliveries (HLT_DELIV 3468 + genDeliv 4449; announced in Keystone: BL-2026-0600…). */
export const goodsReceipts = pgTable('goods_receipts', {
  id: id(),
  /** "BL-2026-0533". */
  number: text('number').notNull().unique(),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  status: text('status').$type<ReceiptStatus>().notNull(),
  /** Announced delivery date (status Announced). */
  expectedOn: date('expected_on', { mode: 'string' }),
  /** Delivered on (registered receipt). */
  receivedOn: date('received_on', { mode: 'string' }),
  /** Carrier ("DB Schenker"); null = "—". */
  carrier: text('carrier'),
  /** Supplier delivery-note number ("BX-55120"); null = "—". */
  supplierDeliveryNote: text('supplier_delivery_note'),
  receivedByPersonId: uuid('received_by_person_id').references(() => persons.id),
  /** Incoming inspection: inspector as cited, result text ("Passed with reserve", "Failed on 2 drums"), remarks. */
  qcByName: text('qc_by_name'),
  qcByPersonId: uuid('qc_by_person_id').references(() => persons.id),
  qcResult: text('qc_result'),
  qcRemarks: text('qc_remarks'),
  qcDecidedAt: timestamp('qc_decided_at', { withTimezone: true }),
  /** Order of the project's list (genDeliv order; announced receipts appended). */
  position: integer('position').notNull(),
  ...timestamps,
});

/** Receipt lines (`lines: [ref, ordered, delivered, accepted, rejected, location]`). */
export const receiptLines = pgTable(
  'receipt_lines',
  {
    id: id(),
    receiptId: uuid('receipt_id').notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id),
    orderedQty: num('ordered_qty').notNull(),
    deliveredQty: num('delivered_qty').notNull(),
    acceptedQty: num('accepted_qty').notNull(),
    rejectedQty: num('rejected_qty').notNull(),
    putAwayLocationId: uuid('put_away_location_id').notNull().references(() => storageLocations.id),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.receiptId, t.partId)],
);

/** Receipt documents (delivery note, certificates: `docs[]`) and photos (`photos` count; file names unknown in the seed). */
export const receiptAttachments = pgTable('receipt_attachments', {
  id: id(),
  receiptId: uuid('receipt_id').notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ReceiptAttachmentKind>().notNull(),
  fileName: text('file_name'),
  storageRef: text('storage_ref'),
  /** Photo stored by Keystone (R-126, SC-4a); null for the seed's counted photos and the delivery-note names. */
  fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
  addedByPersonId: uuid('added_by_person_id').references(() => persons.id),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Supplier invoices (INVOICES 3531) checked against the order and the goods receipt (3-way match `match3` 4663).
 * The PO and receipt amounts are the values the match compares; the receipt amount follows the accepted quantities
 * once the receipt is decided in Keystone.
 */
export const supplierInvoices = pgTable('supplier_invoices', {
  id: id(),
  /** "INV-HC-7781". */
  number: text('number').notNull().unique(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  /** Null = no PO referenced ("No PO"). */
  poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  /** Null = no goods receipt yet. */
  receiptId: uuid('receipt_id').references(() => goodsReceipts.id, { onDelete: 'set null' }),
  /** Amount invoiced, in `currency` (€ unless stated). */
  amountEur: eur('amount_eur').notNull(),
  /** C-9 (R-075): currency of the invoice as received from Sage X3 (amounts of this row are in it). */
  currency: text('currency').notNull().default('EUR'),
  /** Order amount the match compares with (`poAmt`; 0 when no PO). */
  poAmountEur: eur('po_amount_eur').notNull(),
  /** Value of the goods accepted at receipt (`grAmt`). */
  receiptAmountEur: eur('receipt_amount_eur').notNull(),
  /** Amount approved for payment ("Approve received part" = the receipt amount; a credit note is requested for the rest). */
  approvedAmountEur: eur('approved_amount_eur'),
  invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  /** "Net 30" (drawer "Terms"). */
  paymentTerms: text('payment_terms').notNull(),
  status: text('status').$type<SupplierInvoiceStatus>().notNull(),
  decidedByPersonId: uuid('decided_by_person_id').references(() => persons.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  /** Sage X3 accounts-payable reference and push time ("approved invoices are pushed to X3 accounts payable"). */
  x3ApRef: text('x3_ap_ref'),
  pushedToApAt: timestamp('pushed_to_ap_at', { withTimezone: true }),
  position: integer('position').notNull(),
  ...timestamps,
});
