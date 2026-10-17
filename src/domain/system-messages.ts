// R-184 (NEW-D1-2, X-12b, R-148): Keystone's system texts — activity feed and audit trail — as a message key with typed
// parameters, shown in the viewer's language. The writer stores both: the English text the template builds (what older
// readers, exports and text-matching queries read) and the key with its parameters (what the screens render).
// - The English templates are byte-identical to the texts readers match: kpis.ts 'status: Draft → Open' and 'RFQ sent to %',
//   quality.ts 'status: Submitted → ' (tested).
// - French renders from the parameters: data (names, titles, notes typed in Keystone or received from Vigie, Cursus, Codex)
//   as typed or its exact demo entry (dataText); references (CR-008, PO-1082) as is; Keystone's own labels (statuses, roles)
//   through t(); dates and counts with Intl, with French plurals.
// - Rows written before the key existed (or by writers not converted yet) have no key: the readers show their English text
//   as typed (fieldsText), never through the segment translator.
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';

/** Parameter kinds: typed data, references, Keystone labels (EN source strings), lists of them, counts and ISO dates. */
type Kind = 'data' | 'ref' | 'label' | 'labels' | 'dataList' | 'count' | 'date';
type ValueOf<K extends Kind> = K extends 'labels' | 'dataList' ? string[] : K extends 'count' ? number : string;
type Spec = Record<string, Kind>;
type Values<S extends Spec> = { [P in keyof S]: ValueOf<S[P]> };

/** French formatting helpers handed to the French templates. */
export interface MessageFormat {
  /** Typed data: as typed, or its exact demo entry. */
  data: (s: string) => string;
  /** Keystone's own label (EN source string) in the viewer's language. */
  label: (s: string) => string;
  /** ISO date "2026-10-15" → "15 oct. 2026". */
  date: (iso: string) => string;
  /** 1234 → "1 234". */
  count: (n: number) => string;
  /** "1 machine" / "2 machines" — French takes the singular for 0 and 1. */
  plural: (n: number, one: string, many: string) => string;
}

interface MessageDef<S extends Spec> {
  params: S;
  en: (p: Values<S>) => string;
  fr: (p: Values<S>, f: MessageFormat) => string;
}
const def = <S extends Spec>(params: S, en: MessageDef<S>['en'], fr: MessageDef<S>['fr']): MessageDef<S> => ({ params, en, fr });

const MESSAGES = {
  // Generic audit change of status: 'status: Draft → Open' (kpis.ts), 'status: Submitted → Accepted' (quality.ts).
  'audit.status': def({ from: 'label', to: 'label' }, (p) => `status: ${p.from} → ${p.to}`, (p, f) => `statut : ${f.label(p.from)} → ${f.label(p.to)}`),
  // An RFQ sent to its suppliers (purchasing.ts; kpis.ts matches 'RFQ sent to %').
  'rfq.sent': def(
    { suppliers: 'dataList', replyDue: 'date', incoterm: 'label' },
    (p) => `RFQ sent to ${p.suppliers.join(', ')} · reply ${p.replyDue} · ${p.incoterm}`,
    (p, f) => `RFQ envoyée à ${p.suppliers.map(f.data).join(', ')} · réponse le ${f.date(p.replyDue)} · ${f.label(p.incoterm)}`,
  ),
  // Sign-in audit rows (src/server/dal/users.ts, area "Sign-in").
  'signin.signedIn': def({ roles: 'labels' }, (p) => `Signed in · ${p.roles.join(' / ')}`, (p, f) => `Connexion · ${p.roles.map(f.label).join(' / ')}`),
  'signin.refused': def({ reason: 'label' }, (p) => `Sign-in refused · ${p.reason}`, (p, f) => `Connexion refusée · ${f.label(p.reason)}`),
  'signin.signedOut': def({}, () => 'Signed out', () => 'Déconnexion'),
  'signin.activeRole': def({ from: 'label', to: 'label' }, (p) => `Active role · ${p.from} → ${p.to}`, (p, f) => `Rôle actif · ${f.label(p.from)} → ${f.label(p.to)}`),
  // R-121 (D-4 'a'): a risk raised by a lead from a client prerequisite late at J-15 (activity feed, src/server/dal/prerequisite-alerts.ts).
  'site.prerequisiteRiskRaised': def(
    { risk: 'ref', prerequisite: 'data' },
    (p) => `Raised ${p.risk} from a late client prerequisite · ${p.prerequisite}`,
    (p, f) => `Risque ${p.risk} ouvert depuis un prérequis client en retard · ${f.data(p.prerequisite)}`,
  ),
  // R-121, owner's answer of 17 Oct 2026 (second round): the same, from a client prerequisite still pending before J-15.
  'site.pendingPrerequisiteRiskRaised': def(
    { risk: 'ref', prerequisite: 'data' },
    (p) => `Raised ${p.risk} from a client prerequisite not confirmed yet · ${p.prerequisite}`,
    (p, f) => `Risque ${p.risk} ouvert depuis un prérequis client pas encore confirmé · ${f.data(p.prerequisite)}`,
  ),
} as const;

export type MessageKey = keyof typeof MESSAGES;
type ParamsOf<K extends MessageKey> = (typeof MESSAGES)[K] extends MessageDef<infer S> ? Values<S> : never;

/** A system message as stored: key + parameters (jsonb). */
export interface SystemMessage {
  key: MessageKey;
  params: Record<string, unknown>;
}

/** A system message with parameters checked against its key's template. */
export const systemMessage = <K extends MessageKey>(key: K, params: ParamsOf<K>): SystemMessage => ({ key, params: { ...params } });

export const isMessageKey = (k: unknown): k is MessageKey => typeof k === 'string' && Object.hasOwn(MESSAGES, k);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (kind: Kind, v: unknown): boolean => {
  if (kind === 'labels' || kind === 'dataList') return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (kind === 'count') return typeof v === 'number' && Number.isFinite(v);
  if (kind === 'date') return typeof v === 'string' && ISO.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`));
  return typeof v === 'string';
};

/** The parameters stored with a key match its template (rows are data: never trusted blindly). */
function checked(key: string | null | undefined, params: unknown): { d: MessageDef<Spec>; p: Record<string, unknown> } | null {
  if (!isMessageKey(key) || !params || typeof params !== 'object' || Array.isArray(params)) return null;
  const d = MESSAGES[key] as unknown as MessageDef<Spec>;
  const p = params as Record<string, unknown>;
  for (const [name, kind] of Object.entries(d.params)) if (!valid(kind, p[name])) return null;
  return { d, p };
}

/** The English text of a message (what the writer stores in `text` / `change`). */
export function messageText(m: SystemMessage): string {
  const c = checked(m.key, m.params);
  if (!c) throw new Error(`Invalid system message ${String(m.key)}`);
  return c.d.en(c.p as Values<Spec>);
}

const FORMATTERS = new Map<Lang, { nf: Intl.NumberFormat; df: Intl.DateTimeFormat }>();
const formattersOf = (lang: Lang) => {
  let f = FORMATTERS.get(lang);
  if (!f) {
    f = { nf: new Intl.NumberFormat(intlLocale(lang)), df: new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) };
    FORMATTERS.set(lang, f);
  }
  return f;
};

/** Formatting helpers of the viewer's language and translator. */
export function messageFormat(t: T, lang: Lang): MessageFormat {
  const { nf, df } = formattersOf(lang);
  return {
    data: (s) => dataText(s, lang),
    label: (s) => t(s),
    date: (iso) => df.format(new Date(`${iso}T00:00:00Z`)),
    count: (n) => nf.format(n),
    plural: (n, one, many) => `${nf.format(n)} ${Math.abs(n) > 1 ? many : one}`,
  };
}

/**
 * A stored message in the viewer's language; null when the row has no key, an unknown key or parameters that do not match
 * its template (the reader then shows the stored English text as typed).
 */
export function renderMessage(key: string | null | undefined, params: unknown, t: T, lang: Lang): string | null {
  const c = checked(key, params);
  if (!c) return null;
  return lang === 'fr' ? c.d.fr(c.p as Values<Spec>, messageFormat(t, lang)) : c.d.en(c.p as Values<Spec>);
}
