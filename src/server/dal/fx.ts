import 'server-only';
// R-162 (P4, D9-34) — reference exchange rates (Settings), the hedging alert thresholds (app_settings "finance.fxAlerts") and the
// FX exposure of the projects (src/domain/fx-exposure.ts): the contract still to collect and the open purchase orders still to
// pay, per currency other than the euro, valued at the project's budget rate (R-075) and at the reference rate. Writers: Finance
// and the portfolio director (`canEditFxRates`), one transaction, audit with the values before / after, activity event.
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { BASE_CURRENCY, currencyOf } from '@/domain/currency';
import {
  FX_THRESHOLD_LABEL, parseFxThreshold, parseReferenceRate, projectFxExposure, usableFxThresholds, type FxDocuments, type FxError, type FxThresholdKey, type FxThresholds,
  type ProjectFxExposure, type ReferenceRate,
} from '@/domain/fx-exposure';
import { canEditFxRates } from '@/domain/rights';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { APP_SETTING_FX_ALERTS } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { appSettings, fxReferenceRates, poLines, projects, purchaseOrders, supplierInvoices } from '@/server/db/schema';
import { getBillingPlan } from './cashflow';
import type { Actor } from './ops-common';
import { actorSees } from './team-guard';

type Q = DB | Tx;

export class FxWriteError extends Error {
  constructor(readonly code: FxError | 'rights' | 'unknown') {
    super(code);
  }
}

export interface ReferenceRateRow extends ReferenceRate {
  id: string;
  by: string;
}

/** Every reference rate, by currency then date (latest first). */
export async function listReferenceRates(q?: Q): Promise<ReferenceRateRow[]> {
  const db = q ?? (await getDb());
  const rows = await db.select().from(fxReferenceRates).orderBy(asc(fxReferenceRates.currency), asc(fxReferenceRates.validFrom));
  return rows
    .map((r) => ({ id: r.id, currency: currencyOf(r.currency), rate: r.rate, validFrom: r.validFrom, by: r.createdByName }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.validFrom.localeCompare(a.validFrom));
}

/** The thresholds stored over the defaults. */
export async function readFxThresholds(q?: Q): Promise<FxThresholds> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_FX_ALERTS));
  return usableFxThresholds(row?.v ?? null);
}

async function who(q: Q, actor: Actor) {
  if (!canEditFxRates(actor.role) || !actorSees(actor, 'settings')) throw new FxWriteError('rights');
  const p = await findPerson(q, actor.name);
  return { name: p ? nameOf(p) : actor.name, personId: p?.id ?? null };
}

/** Adds a reference rate (currency ≠ EUR, euros per unit, valid from a date — default today); one per currency and date. */
export async function addReferenceRate(input: Record<string, unknown>, today: string, actor: Actor): Promise<void> {
  const parsed = parseReferenceRate(input, today);
  if (!parsed.ok) throw new FxWriteError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const w = await who(tx, actor);
    const [dup] = await tx.select({ id: fxReferenceRates.id }).from(fxReferenceRates).where(and(eq(fxReferenceRates.currency, v.currency), eq(fxReferenceRates.validFrom, v.validFrom)));
    if (dup) throw new FxWriteError('duplicate');
    const [row] = await tx.insert(fxReferenceRates).values({ currency: v.currency, rate: v.rate, validFrom: v.validFrom, createdByName: w.name, createdByPersonId: w.personId })
      .returning({ id: fxReferenceRates.id });
    const text = `1 ${v.currency} = ${v.rate} € from ${v.validFrom}`;
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: 'Reference exchange rates', change: `rate added · ${text}`, area: 'Settings', entityType: 'fx_reference_rate',
      entityId: row.id, after: { currency: v.currency, rate: v.rate, validFrom: v.validFrom },
    });
    await recordActivity(tx, { actorName: w.name, actorPersonId: w.personId, text: `Reference exchange rate · ${text}`, kind: 'change' });
  });
}

/** Removes a reference rate entered by mistake (the audit keeps its values). */
export async function removeReferenceRate(id: string, actor: Actor): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new FxWriteError('unknown');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const w = await who(tx, actor);
    const [cur] = await tx.select().from(fxReferenceRates).where(eq(fxReferenceRates.id, id));
    if (!cur) throw new FxWriteError('unknown');
    await tx.delete(fxReferenceRates).where(eq(fxReferenceRates.id, id));
    const text = `1 ${cur.currency} = ${cur.rate} € from ${cur.validFrom}`;
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: 'Reference exchange rates', change: `rate removed · ${text}`, area: 'Settings', entityType: 'fx_reference_rate',
      entityId: id, before: { currency: cur.currency, rate: cur.rate, validFrom: cur.validFrom },
    });
    await recordActivity(tx, { actorName: w.name, actorPersonId: w.personId, text: `Reference exchange rate removed · ${text}`, kind: 'change' });
  });
}

/** One hedging alert threshold (Finance, the director). Returns the stored value. */
export async function setFxThreshold(key: FxThresholdKey, raw: unknown, actor: Actor): Promise<number> {
  const v = parseFxThreshold(key, raw);
  if (v == null) throw new FxWriteError('threshold');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const w = await who(tx, actor);
    const cur = await readFxThresholds(tx);
    if (cur[key] === v) return v;
    const value = { ...cur, [key]: v };
    await tx.insert(appSettings).values({ key: APP_SETTING_FX_ALERTS, value, updatedAt: new Date(), updatedByName: w.name, updatedByPersonId: w.personId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedByName: w.name, updatedByPersonId: w.personId } });
    const change = `${FX_THRESHOLD_LABEL[key]}: ${cur[key]} → ${v}`;
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: 'FX hedging alert thresholds', change, area: 'Settings', entityType: 'app_setting',
      before: { [key]: cur[key] }, after: { [key]: v },
    });
    await recordActivity(tx, { actorName: w.name, actorPersonId: w.personId, text: `FX hedging alert thresholds · ${change}`, kind: 'change' });
    return v;
  });
}

// ── Exposure ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Purchase order statuses whose amount is committed (drafts, orders awaiting approval and cancelled ones are not). */
const OPEN_ORDER_STATUSES = ['ordered', 'partially_received', 'received'] as const;

/** The FX documents of projects (by id): the contract (billing plan in its currency) and the open non-EUR orders. */
async function documentsOf(q: Q, rows: readonly { id: string; code: string }[]): Promise<Map<string, FxDocuments>> {
  const out = new Map<string, FxDocuments>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const [orders, lines, paid] = await Promise.all([
    q.select({ id: purchaseOrders.id, projectId: purchaseOrders.projectId, number: purchaseOrders.number, currency: purchaseOrders.currency }).from(purchaseOrders)
      .where(and(inArray(purchaseOrders.projectId, ids), ne(purchaseOrders.currency, BASE_CURRENCY), inArray(purchaseOrders.status, [...OPEN_ORDER_STATUSES]))),
    q.select({ poId: poLines.poId, qty: poLines.orderedQty, price: poLines.unitPriceEur }).from(poLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).where(inArray(purchaseOrders.projectId, ids)),
    q.select({ poId: supplierInvoices.poId, amount: supplierInvoices.amountEur, currency: supplierInvoices.currency }).from(supplierInvoices)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierInvoices.poId))
      .where(and(inArray(purchaseOrders.projectId, ids), eq(supplierInvoices.status, 'paid'), isNotNull(supplierInvoices.poId))),
  ]);
  for (const r of rows) {
    const plan = await getBillingPlan(r.code);
    out.set(r.id, {
      contract: plan && plan.fromContract ? { currency: plan.currency, valueKeur: plan.contractValueKeur, invoicedKeur: plan.invoicedKeur, paidKeur: plan.paidKeur } : null,
      orders: orders.filter((o) => o.projectId === r.id).map((o) => ({
        number: o.number, currency: o.currency,
        valueKeur: lines.filter((l) => l.poId === o.id).reduce((s, l) => s + l.qty * l.price, 0) / 1000,
        paidKeur: paid.filter((p) => p.poId === o.id && p.currency === o.currency).reduce((s, p) => s + p.amount, 0) / 1000,
      })),
    });
  }
  return out;
}

/** The FX exposure of one project at `today` (Contract screen); empty for a project in euros. */
export async function getProjectFxExposure(projectCode: string, today: string): Promise<ProjectFxExposure & { thresholds: FxThresholds }> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id, code: projects.code, currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.code, projectCode));
  const [rates, thresholds] = await Promise.all([listReferenceRates(db), readFxThresholds(db)]);
  if (!p) return { currencies: [], alerts: [], thresholds };
  const docs = (await documentsOf(db, [p])).get(p.id)!;
  return { ...projectFxExposure(docs, { currency: p.currency ?? BASE_CURRENCY, budgetRate: p.budgetRate }, rates, thresholds, today), thresholds };
}

export interface PortfolioFxLine extends ProjectFxExposure {
  code: string;
  name: string;
}

/**
 * The FX exposure of the portfolio at `today` (Cash flow line; the daily alerts): every project whose currency is not the euro,
 * or with a non-EUR document, in the register's order; projects without an open position are left out.
 */
export async function getPortfolioFxExposure(today: string, q?: Q): Promise<{ lines: PortfolioFxLine[]; thresholds: FxThresholds }> {
  const db = q ?? (await getDb());
  const [rows, rates, thresholds] = await Promise.all([
    db.select({ id: projects.id, code: projects.code, name: projects.name, currency: projects.currency, budgetRate: projects.budgetRate }).from(projects)
      .where(and(isNotNull(projects.currency), ne(projects.currency, BASE_CURRENCY))).orderBy(asc(projects.sortOrder)),
    listReferenceRates(db),
    readFxThresholds(db),
  ]);
  const docs = await documentsOf(db, rows);
  const lines = rows
    .map((p) => ({ code: p.code, name: p.name, ...projectFxExposure(docs.get(p.id)!, { currency: p.currency ?? BASE_CURRENCY, budgetRate: p.budgetRate }, rates, thresholds, today) }))
    .filter((l) => l.currencies.some((c) => c.netKeur !== 0 || c.receivableKeur !== 0 || c.payableKeur !== 0));
  return { lines, thresholds };
}
