// French forms of the chapter-4 New project wizard texts (A-2 / L-3) the shared dictionary lacks: the template copy
// items ("6 phases · 6 work packages", "6 activities · 5 links") and the calendar's working time. Exact strings go
// through t() (src/i18n/extra/ch4-settings.json).
import type { Lang, T } from '@/i18n/translate';

const fr = (lang: Lang) => lang === 'fr';

/** Copy items of a template: "Empty" / "None" / "6 phases · 6 work packages" / "6 activities · 5 links". */
export function templateTextT(text: string, t: T, lang: Lang): string {
  if (!fr(lang)) return text;
  if (text === 'Empty') return 'Vide';
  if (text === 'None') return 'Aucune';
  const wbs = /^(\d+) (?:phase|phases) · (\d+) (?:work package|work packages)$/.exec(text);
  if (wbs) return `${wbs[1]} phase${+wbs[1] > 1 ? 's' : ''} · ${wbs[2]} lot${+wbs[2] > 1 ? 's' : ''}`;
  const acts = /^(\d+) (?:activity|activities) · (\d+) (?:link|links)$/.exec(text);
  if (acts) return `${acts[1]} activité${+acts[1] > 1 ? 's' : ''} · ${acts[2]} lien${+acts[2] > 1 ? 's' : ''}`;
  return t(text);
}

const DAYS_FR: Record<string, string> = { Mon: 'lun.', Tue: 'mar.', Wed: 'mer.', Thu: 'jeu.', Fri: 'ven.', Sat: 'sam.', Sun: 'dim.' };

/** "Mon–Fri · 8 h a day" → « lun.–ven. · 8 h par jour ». */
export function workingTimeT(text: string, lang: Lang): string {
  if (!fr(lang)) return text;
  const m = /^(.+) · (\d+(?:\.\d+)?) h a day$/.exec(text);
  if (!m) return text;
  const span = m[1] === '7 days' ? '7 jours sur 7' : m[1].replace(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/g, (d) => DAYS_FR[d]);
  return `${span} · ${m[2].replace('.', ',')} h par jour`;
}
