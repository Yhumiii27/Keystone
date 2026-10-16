// Seed date helpers for Delivery 5 data. The prototype writes dates without a year ("14 Jan", "30 Oct"); its data set is
// frozen at the status date (Fri 25 Sep 2026) and every year-less date is read as 2026 — except forward-looking dates
// (a due date or a planned step not done yet) that would fall more than six months before the status date: those are
// next year's ("Client acceptance — PV de réception provisoire" due 14 Jan, handover "Planned · 14 Jan" → 2027).
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { addDaysIso, isoOfDemoDate } from '../codes';

const SIX_MONTHS_BEFORE = addDaysIso(DEMO_TODAY_ISO, -183);

/** "14 Jan" → "2027-01-14" when the item is still to come; "28 Feb" of an accepted deliverable stays 2026. */
export function forwardIso(text: string, done: boolean): string {
  const iso = isoOfDemoDate(text);
  if (!iso) throw new Error(`Seed: unparseable date "${text}"`);
  if (done || /\d{4}$|’\d\d$/.test(text.trim()) || iso >= SIX_MONTHS_BEFORE) return iso;
  return `${+iso.slice(0, 4) + 1}${iso.slice(4)}`;
}

/** Optional date: '' / '—' → null. */
export function optionalIso(text: string | null | undefined, done = false): string | null {
  return text && text.trim() && text.trim() !== '—' ? forwardIso(text, done) : null;
}
