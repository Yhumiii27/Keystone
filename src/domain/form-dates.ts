// Default dates of the add-forms (R-169). The prototype pre-filled literal dates ("5 Oct 2026", "30 Oct 2026",
// "6 Oct 2026") and fell back on literal week labels ("28 Sep", "5 Oct"); they are now computed from the data date (the
// project's, else the business date — R-013), so a form opened later never proposes a date in the past. On the seed (data
// date Fri 25 Sep 2026) every value is the prototype's. Pure module (pages, forms, tests).
import { addDaysIso, displayOfIso, dowOfIso, shortDateOfIso } from '@/server/db/codes';

/** The Monday strictly after `iso` (Fri 25 Sep → Mon 28 Sep; Mon 28 Sep → Mon 5 Oct). */
export const nextMondayIso = (iso: string) => addDaysIso(iso, ((8 - dowOfIso(iso)) % 7) || 7);

/** Plan "Add activity": starts on the Monday of the week after next, finishes on the Friday four weeks later (5 Oct → 30 Oct). */
export function newActivityDates(dataDate: string): { start: string; finish: string } {
  const start = addDaysIso(nextMondayIso(dataDate), 7);
  return { start, finish: addDaysIso(start, 25) };
}

/** Meetings "New meeting": the Tuesday of the week after next (6 Oct). */
export const newMeetingDateIso = (dataDate: string) => addDaysIso(nextMondayIso(dataDate), 8);

/** "5 Oct 2026": how the forms print a default date (English; the form translates it). */
export const formDateText = (iso: string) => displayOfIso(iso);

/** Week labels of the team-load columns when the pool has no weeks: next week and the one after ("28 Sep", "5 Oct"). */
export function nextWeekLabels(dataDate: string): [string, string] {
  const w0 = nextMondayIso(dataDate);
  return [shortDateOfIso(w0), shortDateOfIso(addDaysIso(w0, 7))];
}
