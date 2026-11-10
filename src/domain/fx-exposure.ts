// R-162 (P4, owner's answer D9-34, 10 Nov 2026: « Lancer après la devise par contrat (R-075) ») — reference exchange rates,
// FX exposure per project and hedging alerts. Pure and deterministic; `today` is always passed in (R-013).
//
// - Reference rates: dated rows (euros per unit of a currency, valid from a date), entered in Settings by Finance and the
//   portfolio director. The rate of a currency at a date is the row with the latest `validFrom` on or before it.
// - Exposure of a project (R-075: its documents are in EUR or in the project currency): per currency other than EUR,
//   - receivable = the contract value still to collect (base + signed amendments − paid invoices), split into "to invoice"
//     and "invoiced, unpaid";
//   - payable = the open purchase orders (ordered, partially or fully received) still to pay (order value − paid supplier
//     invoices of the order in that currency);
//   - net = receivable − payable (positive = long in the currency: EPC2i loses when it falls);
//   - valued in euros at the project's budget rate and at the reference rate; the difference is the gain (+) or loss (−) the
//     rate move has made on the open net position; the drift is (reference − budget) / budget.
// - Hedging alerts (thresholds in Settings, like S-25): the net exposure at the reference rate is at least the exposure
//   threshold (k€), OR the rate has drifted by at least the drift threshold (%) against the budget rate while the project still
//   has an open position. No hedge is recorded in Keystone: the alert says the position is open, Finance decides.
import { BASE_CURRENCY, currencyOf, type CurrencyCode } from './currency';
import { isIsoDate } from './clock';

export interface ReferenceRate {
  currency: CurrencyCode;
  /** Euros per unit. */
  rate: number;
  /** First day the rate applies (ISO). */
  validFrom: string;
}

/** The reference rate of `currency` at `on`: the row with the latest validFrom ≤ on (ties: the later row); null when none. */
export function referenceRateOn(rates: readonly ReferenceRate[], currency: string, on: string): ReferenceRate | null {
  const c = currencyOf(currency);
  if (c === BASE_CURRENCY) return { currency: c, rate: 1, validFrom: on };
  let best: ReferenceRate | null = null;
  for (const r of rates) if (r.currency === c && r.validFrom <= on && (!best || r.validFrom >= best.validFrom)) best = r;
  return best;
}

// ── Reference rate input ──────────────────────────────────────────────────────────────────────────────────────────────────

export type FxError = 'currency' | 'rate' | 'date' | 'duplicate' | 'threshold';
export const FX_ERRORS: Record<FxError, string> = {
  currency: 'Choose a currency other than the euro',
  rate: 'A rate is a positive number of euros per unit (10 000 at most)',
  date: 'Enter a valid date',
  duplicate: 'This currency already has a rate from that date',
  threshold: 'Enter a value within the allowed range',
};

/** A rate as typed ("0.92", "0,92"): positive, ≤ 10 000, 6 decimals; null when invalid. */
export function parseRate(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/[\s  ]/g, '').replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(Number(s) * 1e6) / 1e6;
  return v > 0 && v <= 10_000 ? v : null;
}

/** "Add rate" form → a reference rate (currency ≠ EUR, rate, valid from — default today). */
export function parseReferenceRate(v: Record<string, unknown>, today: string): { ok: true; value: ReferenceRate } | { ok: false; error: FxError } {
  const cur = typeof v.currency === 'string' ? v.currency : '';
  if (!cur || currencyOf(cur) !== cur || cur === BASE_CURRENCY) return { ok: false, error: 'currency' };
  const rate = parseRate(v.rate);
  if (rate == null) return { ok: false, error: 'rate' };
  const raw = typeof v.validFrom === 'string' ? v.validFrom.trim() : '';
  if (raw && !isIsoDate(raw)) return { ok: false, error: 'date' };
  return { ok: true, value: { currency: cur as CurrencyCode, rate, validFrom: raw || today } };
}

// ── Thresholds (Settings) ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface FxThresholds {
  /** Net exposure at the reference rate, k€, from which a hedging alert is raised. */
  exposureKeur: number;
  /** Drift of the reference rate against the budget rate, %, from which an alert is raised. */
  driftPct: number;
}
/** Defaults (décision prise sans demander): 500 k€ and 5 %. */
export const FX_THRESHOLDS_STANDARD: FxThresholds = { exposureKeur: 500, driftPct: 5 };
export type FxThresholdKey = keyof FxThresholds;
export const FX_THRESHOLD_KEYS: readonly FxThresholdKey[] = ['exposureKeur', 'driftPct'];
export const isFxThresholdKey = (v: unknown): v is FxThresholdKey => typeof v === 'string' && (FX_THRESHOLD_KEYS as readonly string[]).includes(v);
export const FX_THRESHOLD_BOUNDS: Record<FxThresholdKey, { min: number; max: number }> = {
  exposureKeur: { min: 1, max: 1_000_000 },
  driftPct: { min: 0.1, max: 100 },
};
/** EN labels of the Settings fields. */
export const FX_THRESHOLD_LABEL: Record<FxThresholdKey, string> = {
  exposureKeur: 'Net exposure from which a hedging alert is raised (k€)',
  driftPct: 'Rate drift against the budget rate from which an alert is raised (%)',
};

/** A threshold as typed: a number within its bounds (one decimal for the drift, whole k€ for the exposure); null otherwise. */
export function parseFxThreshold(key: FxThresholdKey, raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = key === 'exposureKeur' ? Math.round(Number(s)) : Math.round(Number(s) * 10) / 10;
  const b = FX_THRESHOLD_BOUNDS[key];
  return v >= b.min && v <= b.max ? v : null;
}

/** Stored value → thresholds; a missing or invalid field gives its default. */
export function usableFxThresholds(v: unknown): FxThresholds {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...FX_THRESHOLDS_STANDARD };
  for (const k of FX_THRESHOLD_KEYS) {
    const p = parseFxThreshold(k, o[k]);
    if (p != null) out[k] = p;
  }
  return out;
}

// ── Exposure ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FxDocuments {
  /** The contract (thousands of its currency): value = base + signed amendments, invoiced and paid so far. */
  contract: { currency: string; valueKeur: number; invoicedKeur: number; paidKeur: number } | null;
  /** Open orders (thousands of their currency): value and paid supplier invoices of the order. */
  orders: readonly { number: string; currency: string; valueKeur: number; paidKeur: number }[];
}

export interface FxCurrencyExposure {
  currency: CurrencyCode;
  /** Thousands of the currency. */
  toInvoiceKeur: number;
  invoicedUnpaidKeur: number;
  receivableKeur: number;
  payableKeur: number;
  netKeur: number;
  /** Euros per unit: the project's budget rate, the reference rate at `today` (null when none). */
  budgetRate: number | null;
  referenceRate: number | null;
  referenceFrom: string | null;
  /** Net position in k€ at the budget rate and at the reference rate (the reference falls back on the budget rate). */
  netAtBudgetKeur: number;
  netAtReferenceKeur: number;
  /** Gain (+) / loss (−) of the rate move on the open net position, k€; null without both rates. */
  gainLossKeur: number | null;
  /** (reference − budget) / budget × 100; null without both rates. */
  driftPct: number | null;
}

export type FxAlertKind = 'exposure' | 'drift';
export interface FxAlert {
  kind: FxAlertKind;
  currency: CurrencyCode;
}

export interface ProjectFxExposure {
  currencies: FxCurrencyExposure[];
  alerts: FxAlert[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The FX exposure of a project at `today`: one entry per non-EUR currency used by its contract or open orders, valued at its
 * budget rate (`budgetRate`, euros per unit of the project currency) and at the reference rate.
 */
export function projectFxExposure(
  docs: FxDocuments,
  project: { currency: string; budgetRate: number | null },
  rates: readonly ReferenceRate[],
  thresholds: FxThresholds,
  today: string,
): ProjectFxExposure {
  const by = new Map<CurrencyCode, { toInvoice: number; unpaid: number; payable: number }>();
  const slot = (c: CurrencyCode) => by.get(c) ?? (by.set(c, { toInvoice: 0, unpaid: 0, payable: 0 }), by.get(c)!);
  if (docs.contract) {
    const c = currencyOf(docs.contract.currency);
    if (c !== BASE_CURRENCY) {
      const s = slot(c);
      s.toInvoice += Math.max(0, docs.contract.valueKeur - docs.contract.invoicedKeur);
      s.unpaid += Math.max(0, docs.contract.invoicedKeur - docs.contract.paidKeur);
    }
  }
  for (const o of docs.orders) {
    const c = currencyOf(o.currency);
    if (c !== BASE_CURRENCY) slot(c).payable += Math.max(0, o.valueKeur - o.paidKeur);
  }
  const projectCurrency = currencyOf(project.currency);
  const currencies: FxCurrencyExposure[] = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, s]) => {
    const budgetRate = currency === projectCurrency ? project.budgetRate : null;
    const ref = referenceRateOn(rates, currency, today);
    const receivable = s.toInvoice + s.unpaid;
    const net = receivable - s.payable;
    const atBudget = budgetRate ?? ref?.rate ?? 0;
    const atRef = ref?.rate ?? budgetRate ?? 0;
    const both = budgetRate != null && ref != null;
    return {
      currency, toInvoiceKeur: r2(s.toInvoice), invoicedUnpaidKeur: r2(s.unpaid), receivableKeur: r2(receivable), payableKeur: r2(s.payable), netKeur: r2(net),
      budgetRate, referenceRate: ref?.rate ?? null, referenceFrom: ref?.validFrom ?? null,
      netAtBudgetKeur: r2(net * atBudget), netAtReferenceKeur: r2(net * atRef),
      gainLossKeur: both ? r2(net * (ref!.rate - budgetRate!)) : null,
      driftPct: both ? Math.round(((ref!.rate - budgetRate!) / budgetRate!) * 1000) / 10 : null,
    };
  });
  return { currencies, alerts: fxAlerts(currencies, thresholds) };
}

/** The hedging alerts of a project's exposure (see the header): exposure ≥ threshold, or |drift| ≥ threshold on an open position. */
export function fxAlerts(currencies: readonly FxCurrencyExposure[], t: FxThresholds): FxAlert[] {
  const out: FxAlert[] = [];
  for (const c of currencies) {
    if (Math.abs(c.netAtReferenceKeur) >= t.exposureKeur) out.push({ kind: 'exposure', currency: c.currency });
    if (c.driftPct != null && c.netKeur !== 0 && Math.abs(c.driftPct) >= t.driftPct) out.push({ kind: 'drift', currency: c.currency });
  }
  return out;
}

/** Fixed EN titles of the alert notices (FR in d9-fx.json); project, currency and figure follow after " · ". */
export const FX_ALERT_TITLE: Record<FxAlertKind, string> = { exposure: 'FX exposure above threshold', drift: 'Exchange rate drift above threshold' };
export function fxAlertTitle(kind: FxAlertKind, project: string, c: FxCurrencyExposure): string {
  const figure = kind === 'exposure' ? `${Math.round(c.netAtReferenceKeur)} k€` : `${c.driftPct! > 0 ? '+' : ''}${c.driftPct} %`;
  return `${FX_ALERT_TITLE[kind]} · ${project} · ${c.currency} · ${figure}`;
}
