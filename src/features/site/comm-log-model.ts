// Texts of the client communication log drawer (chapter 4) that need a plural or a parameter in French. Pure.
import type { Lang } from '@/i18n/translate';

/** "3 exchanges · 1 follow-up open" / « 3 échanges · 1 relance ouverte ». */
export function clientLogCountsText(n: { exchanges: number; openFollowUps: number }, lang: Lang): string {
  const { exchanges: e, openFollowUps: f } = n;
  return lang === 'fr'
    ? `${e} échange${e > 1 ? 's' : ''} · ${f} relance${f > 1 ? 's' : ''} ouverte${f > 1 ? 's' : ''}`
    : `${e} exchange${e === 1 ? '' : 's'} · ${f} follow-up${f === 1 ? '' : 's'} open`;
}

/** "Follow-up · Romain Aubert · due 2 Oct" — `due` already translated. */
export function followUpText(owner: string, due: string, lang: Lang): string {
  return lang === 'fr' ? `Relance · ${owner} · échéance ${due}` : `Follow-up · ${owner} · due ${due}`;
}
