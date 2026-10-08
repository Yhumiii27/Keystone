// Requests-specific translation helpers. English stays the prototype's source text (docs/spec/08 §5–§6, 01 §12).
// - `reqT` fixes shared FR dictionary entries that are wrong in this feature's context: "Request" is the column
//   noun ("Demande", not the verb "Demander", 08 OQ26), request statuses agree with "demande" (feminine), and the
//   "procurement" target of "Approve & send to …" (contract roles, 08 OQ20).
// - Parameterised sentences the shared FR rule engine does not cover (the prototype leaves them in English).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';

const FR_OVERRIDES: Record<string, string> = {
  Request: 'Demande',
  Approved: 'Approuvées',
  Rejected: 'Refusée',
  procurement: 'les achats',
};

/** `t` with the feature's FR overrides. */
export const reqT = (t: T, lang: Lang): T => (s) => (lang === 'fr' && Object.hasOwn(FR_OVERRIDES, s) ? FR_OVERRIDES[s] : t(s));

const fr = (lang: Lang) => lang === 'fr';
/** FR percentage spacing ("90 %"), as the FR rules write it. */
const pc = (v: number, lang: Lang) => (fr(lang) ? `${v} %` : `${v}%`);

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };
/**
 * Free text typed by people (request title, note for the department head): FR only on an exact dictionary match
 * (seeded prototype strings). The segment / month / rule engine is not applied, so a title typed in French is never
 * altered ("Mon équipe…" would become "lun. équipe…") and seeded titles are not half-translated by other features'
 * segment entries ("… — seconde équipe").
 */
export const dataText = (s: string, lang: Lang) => (fr(lang) && s && Object.hasOwn(DICT, s) ? DICT[s] : s);

/** Hour figures: "12.5" EN, "12,5" FR (requests accept decimal hours). */
export const hoursNum = (h: number, lang: Lang) => (fr(lang) ? String(h).replace('.', ',') : String(h));
/** Row hours "16 h". */
export const hoursText = (h: number, lang: Lang) => `${hoursNum(h, lang)} h`;

/** KPI sub "64 h requested". */
export const hoursRequestedText = (h: number, lang: Lang) => (fr(lang) ? `${hoursNum(h, lang)} h demandées` : `${h} h requested`);

/** Stepper caption of an approved request: "In Julien’s list". */
export const inListText = (who: string, lang: Lang) => (fr(lang) ? `Dans la liste de ${who}` : `In ${who}’s list`);

/** Capacity KPI sub "Committed 1110 h". */
export const committedText = (h: number, lang: Lang) => (fr(lang) ? `Engagé ${h} h` : `Committed ${h} h`);

/** Decided KPI sub "1 approved · 1 rejected". */
export const decidedSubText = (a: number, r: number, lang: Lang) =>
  fr(lang) ? `${a} approuvée${a > 1 ? 's' : ''} · ${r} refusée${r > 1 ? 's' : ''}` : `${a} approved · ${r} rejected`;

/** "w/c 28 Sep" → FR "sem. du 28 sept." (the prototype leaves "w/c" in French). `label` is the EN "w/c …" text. */
export const weekOfText = (label: string, t: T, lang: Lang) => (fr(lang) ? t(label.replace(/^w\/c /, 'sem. du ')) : label);

/** KPI label "Team load w/c 28 Sep" (date = "28 Sep"). */
export const teamLoadLabel = (date: string, t: T, lang: Lang) => (fr(lang) ? `Charge équipe sem. du ${t(date)}` : `Team load w/c ${date}`);

/** Impact line "Julien at 90% w/c 28 Sep → 120% with this request" (`week` = EN "w/c 28 Sep"). */
export const impactText = (first: string, load: number, week: string, after: number, t: T, lang: Lang) =>
  fr(lang)
    ? `${first} à ${pc(load, lang)} ${weekOfText(week, t, lang)} → ${pc(after, lang)} avec cette demande`
    : `${first} at ${load}% ${week} → ${after}% with this request`;

/** Dialog sub-line "Harbor Line Terminal Expansion · sent by R. Aubert" (project name already translated). */
export const sentByText = (projectName: string, sender: string, lang: Lang) =>
  fr(lang) ? `${projectName} · envoyée par ${sender}` : `${projectName} · sent by ${sender}`;

/** Routing panel of the New resource request dialog (department already translated by the caller when FR). */
export function routingText(r: { head: string; department: string; first: string | null; load: number | null }, t: T, lang: Lang): string {
  const tail = t('The task appears in the person’s list only once approved.');
  if (fr(lang)) {
    const who = r.first != null && r.load != null ? `${r.first} est à ${pc(r.load, lang)} cette semaine-là` : 'embauche sous contrat — pas de charge actuelle';
    return `Envoyée à ${r.head} (${t(r.department)}) pour approbation · ${who}. ${tail}`;
  }
  const who = r.first != null && r.load != null ? `${r.first} is at ${r.load}% that week` : 'contract hire — no current load';
  return `Goes to ${r.head} (${r.department}) for approval · ${who}. ${tail}`;
}

/** "Approve & send to Julien"; a contract role goes to procurement (08 OQ20): FR "Approuver et envoyer aux achats". */
export const approveLabelText = (first: string | null, t: T, lang: Lang) =>
  first == null && fr(lang) ? 'Approuver et envoyer aux achats' : `${t('Approve & send to')} ${first ?? t('procurement')}`;

/** Page title "Approvals — Engineering" (the shared FR rule leaves the department in English). */
export const approvalsTitle = (dept: string, t: T) => `${t('Approvals')} — ${t(dept)}`;

/** "Nothing waiting — every request for Engineering is decided" (template: two keys around the department). */
export const nothingWaitingText = (dept: string, t: T) => `${t('Nothing waiting — every request for')} ${t(dept)} ${t('is decided')}`;

/** Breadcrumb extra of the Requests screen: "R. Aubert, project manager" (EN; translated by the header). */
export const requestsCrumb = (viewer: { short: string; title: string }, all: boolean) =>
  all ? 'all project managers' : `${viewer.short}, ${viewer.title.charAt(0).toLowerCase()}${viewer.title.slice(1)}`;

const RESPONSE_FR: Record<string, string> = {
  Approved: 'Approuvée',
  Rejected: 'Refusée',
  'Reschedule proposed': 'Replanification proposée',
  'Withdrawn by PM': 'Retirée par le chef de projet',
  'accepted by PM': 'acceptée par le chef de projet',
  assigned: 'affectée',
};

/**
 * Decision line of a request ("Approved · Ines Duarte · Thu 24 Sep", "Reschedule proposed · Sophie Renard · Thu 24 Sep —
 * {reason}", "Withdrawn by PM · Fri 25 Sep", "Rescheduled to 12 Oct – 16 Oct · accepted by PM · assigned"). Each
 * system segment is translated; the reason after " — " is the decider's own text and stays as typed.
 */
export function responseText(response: string, t: T, lang: Lang): string {
  if (!fr(lang) || !response) return response;
  const cut = response.indexOf(' — ');
  const head = cut >= 0 ? response.slice(0, cut) : response;
  const note = cut >= 0 ? response.slice(cut) : '';
  const seg = (s: string) => {
    if (Object.hasOwn(RESPONSE_FR, s)) return RESPONSE_FR[s];
    const m = /^Rescheduled to (.+) – (.+)$/.exec(s);
    if (m) return `Replanifiée du ${t(m[1])} au ${t(m[2])}`;
    return t(s);
  };
  return head.split(' · ').map(seg).join(' · ') + note;
}
