// Text people typed in Keystone or that Vigie / Cursus sent (titles, names of projects, clients, work packages and
// activities, contract clauses, change requests, comments…) is shown exactly as typed in both languages (NEW-D1-2 = a,
// X-12b = as_typed; R-148). It never goes through the prototype translator `t()`, whose segment, month and day rules
// alter typed text ("Sun Valley Farm" → "dim. Valley Farm", "Mon équipe" → "lun. équipe").
// The only exception is the demonstration data set: a seeded English string that has an entry of its own in the FR
// dictionary ("Harbor Line Terminal Expansion" → "Extension du terminal Harbor Line") is shown in French, so the demo
// reads as the prototype did. A partial match never applies.
import { frExact, type Lang } from './translate';

/** Typed / received text in the viewer's language: as typed, or the exact FR dictionary entry of a seeded string. */
export function dataText(s: string, lang: Lang): string;
export function dataText(s: string | null | undefined, lang: Lang): string | null | undefined;
export function dataText(s: string | null | undefined, lang: Lang): string | null | undefined {
  if (lang !== 'fr' || !s) return s;
  return frExact(s) ?? s;
}

/** `dataText` bound to a language, for `.map(dt)` and models that receive a translator. */
export const makeDataT = (lang: Lang) => (s: string) => dataText(s, lang);

/** "#026 · Harbor Line Terminal Expansion": the project number as is, the name as typed (or its demo entry). */
export const projectLabelText = (p: { displayId: string; name: string }, lang: Lang) => `${p.displayId} · ${dataText(p.name, lang)}`;
