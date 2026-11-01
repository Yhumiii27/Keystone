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
  // R-121, owner's answer of 17 Oct 2026 (third round): a new risk raised from a late client prerequisite that already had one.
  'site.prerequisiteRiskRaisedAgain': def(
    { risk: 'ref', previous: 'ref', prerequisite: 'data' },
    (p) => `Raised ${p.risk} from a late client prerequisite (after ${p.previous}) · ${p.prerequisite}`,
    (p, f) => `Risque ${p.risk} ouvert depuis un prérequis client en retard (après ${p.previous}) · ${f.data(p.prerequisite)}`,
  ),
  // R-190 (Arche K-05): the project's CAPEX link set on the Contract screen (audit trail and activity feed; '—' = none).
  'project.capexLink': def(
    { from: 'ref', to: 'ref' },
    (p) => `CAPEX link: ${p.from} → ${p.to}`,
    (p) => `Rattachement CAPEX : ${p.from} → ${p.to}`,
  ),
  // R-189 (Arche K-04): the CAPEX milestone a schedule milestone is, set on the Schedule screen (labels of
  // src/domain/capex-milestones.ts; 'Not a CAPEX milestone' = none).
  'milestone.capexCode': def(
    { milestone: 'data', from: 'label', to: 'label' },
    (p) => `CAPEX milestone of ${p.milestone}: ${p.from} → ${p.to}`,
    (p, f) => `Jalon CAPEX de ${f.data(p.milestone)} : ${f.label(p.from)} → ${f.label(p.to)}`,
  ),
  // R-198: edits made on the Schedule screen's interactive Gantt (activity feed; "FS+5" relationship labels as the Plan writes them).
  'gantt.moved': def(
    { activity: 'ref', date: 'date' },
    (p) => `Moved ${p.activity} on the Gantt · start no earlier than ${p.date}`,
    (p, f) => `${p.activity} déplacée sur le Gantt · début au plus tôt le ${f.date(p.date)}`,
  ),
  'gantt.durationChanged': def(
    { activity: 'ref', days: 'count' },
    (p) => `Changed the duration of ${p.activity} on the Gantt · ${p.days} working days`,
    (p, f) => `Durée de ${p.activity} modifiée sur le Gantt · ${f.plural(p.days, 'jour ouvré', 'jours ouvrés')}`,
  ),
  'gantt.constraintCleared': def(
    { activity: 'ref' },
    (p) => `Removed the date constraint of ${p.activity} on the Gantt`,
    (p) => `Contrainte de date de ${p.activity} retirée sur le Gantt`,
  ),
  'gantt.linkAdded': def(
    { pred: 'ref', succ: 'ref', link: 'ref' },
    (p) => `Linked ${p.pred} → ${p.succ} on the Gantt · ${p.link}`,
    (p) => `Lien ${p.pred} → ${p.succ} créé sur le Gantt · ${p.link}`,
  ),
  'gantt.linkChanged': def(
    { pred: 'ref', succ: 'ref', link: 'ref' },
    (p) => `Changed the link ${p.pred} → ${p.succ} on the Gantt · ${p.link}`,
    (p) => `Lien ${p.pred} → ${p.succ} modifié sur le Gantt · ${p.link}`,
  ),
  'gantt.linkRemoved': def(
    { pred: 'ref', succ: 'ref' },
    (p) => `Removed the link ${p.pred} → ${p.succ} on the Gantt`,
    (p) => `Lien ${p.pred} → ${p.succ} supprimé sur le Gantt`,
  ),
  // R-190: the project's client flagged as a group subsidiary (internal client) or back to external ('—' = subsidiary code not known).
  'client.internalSet': def(
    { client: 'data', subsidiary: 'ref' },
    (p) => `Client ${p.client} marked internal · group subsidiary ${p.subsidiary}`,
    (p, f) => `Client ${f.data(p.client)} marqué interne · filiale du groupe ${p.subsidiary}`,
  ),
  'client.internalCleared': def(
    { client: 'data' },
    (p) => `Client ${p.client} marked external`,
    (p, f) => `Client ${f.data(p.client)} marqué externe`,
  ),
  // R-185: the project's equipment lines edited on the Contract screen (audit trail and activity feed; "3 × MEMU").
  'project.equipmentAdded': def(
    { ref: 'ref', equipment: 'ref' },
    (p) => `Equipment ${p.ref} added · ${p.equipment}`,
    (p) => `Équipement ${p.ref} ajouté · ${p.equipment}`,
  ),
  'project.equipmentChanged': def(
    { ref: 'ref', from: 'ref', to: 'ref' },
    (p) => `Equipment ${p.ref}: ${p.from} → ${p.to}`,
    (p) => `Équipement ${p.ref} : ${p.from} → ${p.to}`,
  ),
  'project.equipmentRemoved': def(
    { ref: 'ref', equipment: 'ref' },
    (p) => `Equipment ${p.ref} removed · ${p.equipment}`,
    (p) => `Équipement ${p.ref} retiré · ${p.equipment}`,
  ),
  // R-186: the machine catalogue on the Machine types screen ("EMP-40T v2"; audit trail, activity feed on publish and retire).
  'catalogue.created': def(
    { ref: 'ref', label: 'data' },
    (p) => `Catalogue entry ${p.ref} created (draft) · ${p.label}`,
    (p, f) => `Fiche catalogue ${p.ref} créée (brouillon) · ${f.data(p.label)}`,
  ),
  'catalogue.versionCreated': def({ ref: 'ref' }, (p) => `Catalogue version ${p.ref} created (draft)`, (p) => `Version catalogue ${p.ref} créée (brouillon)`),
  'catalogue.draftSaved': def({ ref: 'ref' }, (p) => `Catalogue draft ${p.ref} saved`, (p) => `Brouillon catalogue ${p.ref} enregistré`),
  'catalogue.published': def({ ref: 'ref' }, (p) => `Catalogue ${p.ref} published`, (p) => `Catalogue ${p.ref} publié`),
  'catalogue.publishedSuperseding': def(
    { ref: 'ref', previous: 'ref' },
    (p) => `Catalogue ${p.ref} published · ${p.previous} retired`,
    (p) => `Catalogue ${p.ref} publié · ${p.previous} retiré`,
  ),
  'catalogue.retired': def({ ref: 'ref' }, (p) => `Catalogue ${p.ref} retired`, (p) => `Catalogue ${p.ref} retiré`),
  'catalogue.discarded': def({ ref: 'ref' }, (p) => `Catalogue draft ${p.ref} discarded`, (p) => `Brouillon catalogue ${p.ref} abandonné`),
  // R-187 (Arche K-02, K-10): Keystone's answers to the subsidiaries' machine needs, and the project at the order.
  'needAnswer.recorded': def(
    { number: 'ref', need: 'ref', nature: 'label' },
    (p) => `Answer ${p.number} to need ${p.need} recorded · ${p.nature}`,
    (p, f) => `Réponse ${p.number} au besoin ${p.need} enregistrée · ${f.label(p.nature)}`,
  ),
  'needAnswer.edited': def({ number: 'ref', need: 'ref' }, (p) => `Answer ${p.number} to need ${p.need} edited`, (p) => `Réponse ${p.number} au besoin ${p.need} modifiée`),
  'needAnswer.status': def(
    { number: 'ref', need: 'ref', from: 'label', to: 'label' },
    (p) => `Answer ${p.number} to need ${p.need}: ${p.from} → ${p.to}`,
    (p, f) => `Réponse ${p.number} au besoin ${p.need} : ${f.label(p.from)} → ${f.label(p.to)}`,
  ),
  'needAnswer.projectCreated': def(
    { need: 'ref', project: 'ref' },
    (p) => `Project ${p.project} created from ordered need ${p.need}`,
    (p) => `Projet ${p.project} créé à partir du besoin commandé ${p.need}`,
  ),
  'needAnswer.lineAdded': def(
    { need: 'ref', project: 'ref', ref: 'ref' },
    (p) => `Ordered need ${p.need} added to project ${p.project} as ${p.ref}`,
    (p) => `Besoin commandé ${p.need} ajouté au projet ${p.project} en ${p.ref}`,
  ),
  // R-185 / R-186: a standard phase flagged specific to an equipment (generated once per equipment line) or common to the project.
  'machineType.phaseScope': def(
    { type: 'ref', phase: 'data', perEquipment: 'label' },
    (p) => `Machine type ${p.type} · phase ${p.phase}: ${p.perEquipment}`,
    (p, f) => `Type de machine ${p.type} · phase ${f.data(p.phase)} : ${f.label(p.perEquipment)}`,
  ),
  // R-191: the standard list of the engineering pack of a machine type (weights and minimums, "pid 20 % · min 1 · …").
  'machineType.pack': def(
    { type: 'ref', list: 'ref' },
    (p) => `Machine type ${p.type} · engineering pack: ${p.list}`,
    (p) => `Type de machine ${p.type} · pack ingénierie : ${p.list}`,
  ),
  // R-158 lot A: the Incoterms of Settings (split "S S S S B …" in INCOTERM_STEPS order) and the contract's Incoterm.
  'incoterm.added': def({ code: 'ref', split: 'ref' }, (p) => `Incoterm ${p.code} added · ${p.split}`, (p) => `Incoterm ${p.code} ajouté · ${p.split}`),
  'incoterm.edited': def({ code: 'ref', split: 'ref' }, (p) => `Incoterm ${p.code} edited · ${p.split}`, (p) => `Incoterm ${p.code} modifié · ${p.split}`),
  'incoterm.deleted': def({ code: 'ref' }, (p) => `Incoterm ${p.code} deleted`, (p) => `Incoterm ${p.code} supprimé`),
  'incoterm.deactivated': def(
    { code: 'ref', contracts: 'count' },
    (p) => `Incoterm ${p.code} deactivated · used by ${p.contracts} contract(s)`,
    (p, f) => `Incoterm ${p.code} désactivé · utilisé par ${f.plural(p.contracts, 'contrat', 'contrats')}`,
  ),
  'incoterm.reactivated': def({ code: 'ref' }, (p) => `Incoterm ${p.code} reactivated`, (p) => `Incoterm ${p.code} réactivé`),
  'contract.incoterm': def(
    { project: 'ref', incoterm: 'ref', place: 'data' },
    (p) => `${p.project} · contract Incoterm: ${p.incoterm || 'none'}${p.place ? ` ${p.place}` : ''}`,
    (p, f) => `${p.project} · Incoterm du contrat : ${p.incoterm || 'aucun'}${p.place ? ` ${f.data(p.place)}` : ''}`,
  ),
  // R-158 lot A: the shipments (Shipments screen). `what` / statuses / steps are Keystone labels (EN source strings).
  'shipment.created': def({ project: 'ref', ref: 'ref', equipment: 'dataList' }, (p) => `${p.project} · shipment ${p.ref} created · ${p.equipment.join(', ')}`,
    (p) => `${p.project} · expédition ${p.ref} créée · ${p.equipment.join(', ')}`),
  'shipment.edited': def({ project: 'ref', ref: 'ref' }, (p) => `${p.project} · shipment ${p.ref} edited`, (p) => `${p.project} · expédition ${p.ref} modifiée`),
  'shipment.removed': def({ project: 'ref', ref: 'ref' }, (p) => `${p.project} · shipment ${p.ref} removed`, (p) => `${p.project} · expédition ${p.ref} supprimée`),
  'shipment.content': def(
    { project: 'ref', ref: 'ref', what: 'label', item: 'data' },
    (p) => `${p.project} · shipment ${p.ref} · ${p.what}${p.item ? ` · ${p.item}` : ''}`,
    (p, f) => `${p.project} · expédition ${p.ref} · ${f.label(p.what)}${p.item ? ` · ${f.data(p.item)}` : ''}`,
  ),
  'shipment.gapJustified': def(
    { project: 'ref', ref: 'ref', item: 'data', reason: 'data' },
    (p) => `${p.project} · shipment ${p.ref} · gap justified · ${p.item} · ${p.reason}`,
    (p, f) => `${p.project} · expédition ${p.ref} · écart justifié · ${f.data(p.item)} · ${f.data(p.reason)}`,
  ),
  'shipment.status': def(
    { project: 'ref', ref: 'ref', from: 'label', to: 'label' },
    (p) => `${p.project} · shipment ${p.ref} · status: ${p.from} → ${p.to}`,
    (p, f) => `${p.project} · expédition ${p.ref} · statut : ${f.label(p.from)} → ${f.label(p.to)}`,
  ),
  'shipment.step': def(
    { project: 'ref', ref: 'ref', step: 'label' },
    (p) => `${p.project} · shipment ${p.ref} · step updated · ${p.step}`,
    (p, f) => `${p.project} · expédition ${p.ref} · étape mise à jour · ${f.label(p.step)}`,
  ),
  // R-158 lot B: the site reception, the documents filed in Codex and the freight-delay risk.
  'shipment.reception': def(
    { project: 'ref', ref: 'ref', what: 'label', item: 'data' },
    (p) => `${p.project} · shipment ${p.ref} · reception · ${p.what}${p.item ? ` · ${p.item}` : ''}`,
    (p, f) => `${p.project} · expédition ${p.ref} · réception · ${f.label(p.what)}${p.item ? ` · ${f.data(p.item)}` : ''}`,
  ),
  'shipment.documentFiled': def(
    { project: 'ref', ref: 'ref', document: 'label', number: 'ref', revision: 'ref' },
    (p) => `${p.project} · shipment ${p.ref} · ${p.document} filed in Codex · ${p.number} rev ${p.revision}`,
    (p, f) => `${p.project} · expédition ${p.ref} · ${f.label(p.document)} versé dans Codex · ${p.number} ind. ${p.revision}`,
  ),
  'shipment.riskRaised': def(
    { project: 'ref', ref: 'ref', risk: 'ref' },
    (p) => `${p.project} · shipment ${p.ref} · freight delay · risk ${p.risk} raised`,
    (p) => `${p.project} · expédition ${p.ref} · retard de fret · risque ${p.risk} ouvert`,
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
