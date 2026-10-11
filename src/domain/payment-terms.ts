// C-6 (owner answer a, R-076): each contract chooses how its invoices fall due — "N days from invoice date" (net),
// "N days end of month" (invoice date + N, then the last day of that month: the French "45 jours fin de mois") or
// "End of month + N days" (last day of the invoice month, then + N). Calendar days. The Billing due dates, the overdue flags,
// the client portal's "Due …", the Cash flow receipts and Budget › Cash & recovery all derive from `paymentDueOn`.
// The prototype only added the first integer of a free text to the invoice date (`termsDays`, src/domain/evm.ts), which is
// the 'net' rule; the seed's "Net 45 days" therefore keeps every date. Golden values: src/domain/payment-terms.test.ts.
import type { Lang } from '@/i18n/translate';
import { addDaysIso, paymentRule, type PaymentRule } from '@/server/db/codes';

export type { PaymentRule };
export const PAYMENT_RULES: readonly PaymentRule[] = paymentRule.codes;
export const isPaymentRule = (v: unknown): v is PaymentRule => paymentRule.isCode(v);

/** Default rule of a contract (and of the migration of the existing ones): net 45 days, the seed contract's terms. */
export const DEFAULT_PAYMENT_RULE: PaymentRule = 'net';
export const DEFAULT_PAYMENT_DAYS = 45;
/** Bounds of N (calendar days). French law caps domestic terms at 60 days (45 end of month); export contracts may go further. */
export const MAX_PAYMENT_DAYS = 180;

export interface PaymentTerms {
  rule: PaymentRule;
  days: number;
}

/** Last day of the month of an ISO date. */
function endOfMonthIso(iso: string): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** Payment due date of an invoice issued on `issuedOn` (ISO) under the contract's terms. */
export function paymentDueOn(issuedOn: string, terms: PaymentTerms): string {
  const n = Math.max(0, Math.round(terms.days));
  switch (terms.rule) {
    case 'days_eom':
      return endOfMonthIso(addDaysIso(issuedOn, n));
    case 'eom_days':
      return addDaysIso(endOfMonthIso(issuedOn), n);
    default:
      return addDaysIso(issuedOn, n);
  }
}

/** The terms in words — "Net 45 days", "45 days end of month", "End of month + 30 days" (EN) / "Net 45 jours", "45 jours fin de mois", "Fin de mois + 30 jours" (FR). */
export function paymentTermsText(terms: PaymentTerms, lang: Lang = 'en'): string {
  const n = Math.max(0, Math.round(terms.days));
  const fr = lang === 'fr';
  const days = fr ? (n > 1 ? 'jours' : 'jour') : n === 1 ? 'day' : 'days';
  switch (terms.rule) {
    case 'days_eom':
      return fr ? `${n} ${days} fin de mois` : `${n} ${days} end of month`;
    case 'eom_days':
      if (!n) return fr ? 'Fin de mois' : 'End of month';
      return fr ? `Fin de mois + ${n} ${days}` : `End of month + ${n} ${days}`;
    default:
      return `Net ${n} ${days}`;
  }
}

/** N as typed in the contract sheet ("45"): a whole number of days 0–180; null when invalid. */
export function parsePaymentDays(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_PAYMENT_DAYS ? n : null;
}

/**
 * Terms of a free text as the prototype stored them ("Net 45 days", "30 days end of month", "fin de mois + 30 jours") — used
 * to migrate a contract's text into the rule; first integer = N (default 45), "end of month" / "fin de mois" picks the rule.
 */
export function termsOfText(text: string | null | undefined): PaymentTerms {
  const s = String(text ?? '').toLowerCase();
  const m = /\d+/.exec(s);
  const days = m ? Math.min(MAX_PAYMENT_DAYS, parseInt(m[0], 10)) : DEFAULT_PAYMENT_DAYS;
  const eom = /end of month|fin de mois|\beom\b|\bfdm\b/.test(s);
  if (!eom) return { rule: 'net', days };
  const eomFirst = /^(end of month|fin de mois)/.test(s.trim());
  return { rule: eomFirst ? 'eom_days' : 'days_eom', days };
}
