// Administration translation helpers. English stays the prototype's source text (docs/spec/10 §1–2, 09 §9); the French
// comes from the prototype dictionary through t() (and src/i18n/extra/admin.json), except where the prototype's French
// was wrong or missing:
// - "Request" chip: the noun "Demande" (the shared entry is the verb "Demander");
// - list sub-lines and counts have their singular forms ("1 système ITP");
// - texts the rebuild adds: connector modes and outboxes, Vigie / Codex volumes, sync toasts, rule messages;
// - R-184 (NEW-D1-2): the activity feed and the audit trail, rendered from their message key when the row has one, else
//   from the stored English without the segment translator (typed values as typed).
import { parseChange, type ChangeWord } from '@/domain/audit-trail';
import { renderMessage } from '@/domain/system-messages';
import { dataText, fieldsText } from '@/i18n/data-text';
import { frExact, type Lang, type T } from '@/i18n/translate';

const fr = (lang: Lang) => lang === 'fr';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Activity source chip label ("Sync", "Eco", "Request" → FR "Synchro", "ECO", "Demande"). */
export const activityChipT = (label: string, t: T, lang: Lang) => (fr(lang) && label === 'Request' ? 'Demande' : t(label));

/** Machine-type list sub-line: "6 phases · 7 cost categories · 6 ITP systems" (singular when 1). */
export function mtListSubT(phases: number, cats: number, itp: number, lang: Lang): string {
  if (!fr(lang)) return `${plural(phases, 'phase', 'phases')} · ${plural(cats, 'cost category', 'cost categories')} · ${plural(itp, 'ITP system', 'ITP systems')}`;
  return `${plural(phases, 'phase', 'phases')} · ${plural(cats, 'catégorie de coûts', 'catégories de coûts')} · ${plural(itp, 'système ITP', 'systèmes ITP')}`;
}

/** Connector-layer mode line under the system name (Codex, Vigie, Cursus). */
export const connectorModeT = (mode: 'mock' | 'http', t: T) => t(mode === 'http' ? 'Live connector · HTTP API' : 'Mock connector · local mirror');

/**
 * Line under the system name from the real link (R-021): the connector layer's mode (live, mock), "File exchange · no live
 * connection" for MS Project; nothing for a connector that does not exist (its status says "Not connected").
 */
export function connectorLinkT(link: 'live' | 'mock' | 'file' | 'none', t: T): string | null {
  if (link === 'live') return connectorModeT('http', t);
  if (link === 'mock') return connectorModeT('mock', t);
  return link === 'file' ? t('File exchange · no live connection') : null;
}

/** "Connectors" KPI sub-line (src/domain/admin.ts `plumbingKpis`) in French: "1 connecté · 3 simulés · 5 non connectés". */
export function connectorsSubT(sub: string, t: T, lang: Lang): string {
  const m = /^(\d+) connected · (\d+) mock · (\d+) not connected(?: · (\d+) warning)?$/.exec(sub);
  if (!m || !fr(lang)) return t(sub);
  // French takes the singular for 0 and 1.
  const n = (x: string, one: string, many: string) => `${x} ${+x > 1 ? many : one}`;
  const parts = [n(m[1], 'connecté', 'connectés'), n(m[2], 'simulé', 'simulés'), n(m[3], 'non connecté', 'non connectés')];
  if (m[4]) parts.push(`${m[4]} en alerte`);
  return parts.join(' · ');
}

/** Outbox note appended to the volume: "2 pending sync · 1 failed". */
export function outboxT(pending: number, failed: number, lang: Lang): string {
  const parts: string[] = [];
  if (pending) parts.push(fr(lang) ? `${pending} en attente de synchro` : `${pending} pending sync`);
  if (failed) parts.push(fr(lang) ? plural(failed, 'en échec', 'en échec') : `${failed} failed`);
  return parts.join(' · ');
}

/** Volume texts built by the connector layer (Vigie, Codex, sync runs) and the prototype's stored ones (through t). */
export function volumeT(text: string, t: T, lang: Lang): string {
  if (!fr(lang)) return text;
  const vigie = /^(\d+) ECOs · (\d+) NCRs · (\d+) HSE items$/.exec(text);
  if (vigie) return `${vigie[1]} ECO · ${vigie[2]} NCR · ${plural(+vigie[3], 'élément HSE', 'éléments HSE')}`;
  const run = /^(\d+) sent · (\d+) pending · (\d+) refreshed$/.exec(text);
  if (run) return `${plural(+run[1], 'envoyé', 'envoyés')} · ${run[2]} en attente · ${plural(+run[3], 'actualisé', 'actualisés')}`;
  const codex = /^(\d+) records( · (\d+) linked to (\S+))?$/.exec(text);
  if (codex) return `${plural(+codex[1], 'fiche', 'fiches')}${codex[2] ? ` · ${plural(+codex[3], 'liée', 'liées')} à ${codex[4]}` : ''}`;
  // R-180: "· 12 tasks sent" / "· 3 tasks pending" — the Cursus task push of "Sync now".
  const cursus = /^(\d+) approvals received(?: · (\d+) tasks (sent|pending))?$/.exec(text);
  if (cursus) {
    const tasks = cursus[2] == null ? '' : ` · ${plural(+cursus[2], 'tâche', 'tâches')} ${cursus[3] === 'sent' ? (+cursus[2] === 1 ? 'envoyée' : 'envoyées') : 'en attente'}`;
    return `${plural(+cursus[1], 'approbation reçue', 'approbations reçues')}${tasks}`;
  }
  if (text === 'First sync scheduled') return 'Première synchro planifiée';
  return t(text);
}

/**
 * "Sync now" toast ("Vigie synced · 2 sent · 0 pending · 1 refreshed"; no volume for a connector that exchanged nothing yet).
 * R-021: a mock connector's run says it is simulated ("Codex · simulated sync (mock connector) · 412 records").
 */
export function syncToastT(name: string, r: { ok: boolean; volume: string; error: string | null; simulated?: boolean }, t: T, lang: Lang): string {
  if (r.ok) {
    const head = r.simulated
      ? fr(lang) ? `${name} · synchro simulée (connecteur simulé)` : `${name} · simulated sync (mock connector)`
      : fr(lang) ? `${name} synchronisé` : `${name} synced`;
    return r.volume ? `${head} · ${fr(lang) ? volumeT(r.volume, t, lang) : r.volume}` : head;
  }
  return fr(lang) ? `${name} · échec de la synchro · ${r.error ?? ''}` : `${name} · sync failed · ${r.error ?? ''}`;
}

/** "Data" cell of a connector added in Keystone (no data scope yet): direction and technical owner. */
export const addedConnectorDataT = (direction: string | null, owner: string | null, t: T) =>
  [direction ? t(direction) : null, owner ? `${t('Technical owner')} · ${owner}` : null].filter(Boolean).join(' · ');

/**
 * Audit area of a row ("Change control", "Settings"…). "Integrations" — the area of connector runs and additions — is
 * translated here, not in the shared dictionary, where it would also rename the ERP-202 work package of that name.
 */
export const auditAreaT = (area: string, t: T, lang: Lang) => (fr(lang) && area === 'Integrations' ? 'Intégrations' : t(area));

/** A row of the feed or the trail: its stored English text and, when written from a system message, its key (R-184). */
interface Keyed {
  messageKey?: string | null;
  messageParams?: unknown;
}

/** French of a connector run's head ("sync (simulated) failed"): R-021 says a mock's run is simulated. */
const runHeadFr = (simulated: boolean, failed: boolean) => `synchro${simulated ? ' (simulée)' : ''}${failed ? ' en échec' : ''}`;

/**
 * Activity feed text in the viewer's language (R-184, R-157 item 2): from its message key; else the demo's exact entry; else
 * the connector texts Keystone writes ("Vigie sync (simulated) · 2 sent · 0 pending · 1 refreshed", "Connector X added by
 * IT · not connected yet") with the connector name as typed; else the stored English as typed (fieldsText: only the values
 * Keystone formats are translated).
 */
export function activityWhatT(a: Keyed & { what: string }, t: T, lang: Lang): string {
  const keyed = renderMessage(a.messageKey, a.messageParams, t, lang);
  if (keyed != null) return keyed;
  if (!fr(lang)) return a.what;
  const exact = frExact(a.what);
  if (exact !== undefined) return exact;
  const run = /^(.+?) sync( \(simulated\))?(?: · (.+))?$/.exec(a.what);
  if (run) {
    const tail = run[3] == null ? '' : run[3] === 'failed' ? ' en échec' : ` · ${volumeT(run[3], t, lang)}`;
    return `Synchro ${dataText(run[1], lang)}${run[2] ? ' (simulée)' : ''}${tail}`;
  }
  const added = /^Connector (.+) added by IT · not connected yet$/.exec(a.what);
  if (added) return `Connecteur ${dataText(added[1], lang)} ajouté par l’IT · pas encore connecté`;
  return fieldsText(a.what, t, lang);
}

/** Lone words of a change ("added", "enabled"…) in French. */
const CHANGE_WORD_FR: Record<ChangeWord, string> = {
  added: 'ajouté', removed: 'supprimé', created: 'créé', deleted: 'supprimé', enabled: 'activé', disabled: 'désactivé', restored: 'restauré',
  'data scope changed': 'périmètre des données modifié', 'options changed': 'options modifiées',
};

/** Fields named in "field: old → new" changes: French name, and whether the values are Keystone labels (else as typed). */
const CHANGE_FIELD_FR: Record<string, [fr: string, labels: boolean]> = {
  calendar: ['calendrier', true], type: ['type', true], stage: ['étape', true], result: ['résultat', true], response: ['réponse', true],
  coverage: ['couverture', true], direction: ['sens', false], currency: ['devise', false], frequency: ['fréquence', false], owner: ['responsable', false],
  name: ['nom', false], label: ['libellé', false], document: ['document', false], phases: ['phases', false], cost: ['coût', false], budget: ['budget', false],
  'budget rate': ['taux budgétaire', false], 'displayed baseline': ['référence affichée', false], 'cost categories': ['catégories de coûts', false],
};

/** A value Keystone formats itself (numbers, amounts, units, dates): translated; anything else is typed data. */
const FORMATTED_VALUE = /^[\d\s+\-−–.,:;%€$/()×]*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|k€|M€|d|h|wk|wks)(?![A-Za-z])[\d\s+\-−–.,:;%€$/()×]*)*$/;
const typedOrFormatted = (v: string, t: T, lang: Lang) => frExact(v) ?? (FORMATTED_VALUE.test(v) ? t(v) : dataText(v, lang));

/**
 * Audit change in the viewer's language (R-184), never through the segment translator: from its message key; else the
 * demo's exact entry; else a connector run ("sync (simulated) · 412 records", "sync failed · <error as typed>"); else its
 * generic shapes — "status: A → B" (status labels translated), "field: old → new" (values as typed, or translated when the
 * field holds Keystone labels), lone words ("added") — and any other segment as typed.
 */
export function auditChangeT(a: Keyed & { change: string }, t: T, lang: Lang): string {
  const keyed = renderMessage(a.messageKey, a.messageParams, t, lang);
  if (keyed != null) return keyed;
  if (!fr(lang)) return a.change;
  const exact = frExact(a.change);
  if (exact !== undefined) return exact;
  const run = /^sync( \(simulated\))?( failed)?(?: · ([\s\S]+))?$/.exec(a.change);
  if (run) return `${runHeadFr(!!run[1], !!run[2])}${run[3] == null ? '' : ` · ${run[2] ? run[3] : volumeT(run[3], t, lang)}`}`;
  return parseChange(a.change)
    .map((seg) => {
      if (seg.kind === 'status') return `statut : ${t(seg.from)} → ${t(seg.to)}`;
      if (seg.kind === 'word') return CHANGE_WORD_FR[seg.word];
      if (seg.kind === 'field') {
        const f = CHANGE_FIELD_FR[seg.field];
        const v = (x: string) => (f?.[1] ? t(x) : typedOrFormatted(x, t, lang));
        return `${f?.[0] ?? seg.field} : ${v(seg.from)} → ${v(seg.to)}`;
      }
      return typedOrFormatted(seg.text, t, lang);
    })
    .join(' · ');
}

/** Keystone nouns that start an audit object ("Request RQ-014", "Prerequisite · Crane permit"); the rest is a reference or typed. */
const OBJECT_NOUN_FR: Record<string, string> = {
  Request: 'Demande', 'Machine type': 'Type de machine', Calendar: 'Calendrier', Connector: 'Connecteur', Team: 'Équipe', Hours: 'Heures', Import: 'Import',
  Stock: 'Stock', Prerequisite: 'Prérequis', Equipment: 'Équipement', Closure: 'Clôture', SAT: 'SAT', Cursus: 'Cursus',
};

/** Audit object in the viewer's language (R-184): the demo's exact entry, else a Keystone noun translated before its reference. */
export function auditObjectT(object: string, t: T, lang: Lang): string {
  if (!fr(lang)) return object;
  const exact = frExact(object);
  if (exact !== undefined) return exact;
  const m = /^(Request|Machine type|Calendar|Connector|Team|Hours|Import|Stock|Prerequisite|Equipment|Closure|SAT|Cursus)( · | )([\s\S]+)$/.exec(object);
  if (m) return `${OBJECT_NOUN_FR[m[1]]}${m[2]}${dataText(m[3], lang)}`;
  return fieldsText(object, t, lang);
}

/** "NEW-TYPE · Machine type created". */
export const machineTypeCreatedT = (code: string, t: T) => `${code} · ${t('Machine type created')}`;

/**
 * Rule messages of the administration writers (src/server/dal/settings.ts, mtypes.ts, integrations.ts and the actions)
 * in the viewer's language; null when the message is not a known rule (the action then shows a generic failure).
 */
export function adminErrorT(message: string, t: T, lang: Lang): string | null {
  const dup = /^"(.+)" is already in the list$/.exec(message);
  if (dup) return fr(lang) ? `« ${dup[1]} » figure déjà dans la liste` : message;
  const loc = /^"(.+)" is already a location$/.exec(message);
  if (loc) return fr(lang) ? `« ${loc[1]} » est déjà un emplacement` : message;
  const conn = /^(.+) is already listed$/.exec(message);
  if (conn) return fr(lang) ? `${conn[1]} figure déjà dans les connecteurs` : message;
  const notConnected = /^(.+) is not connected — nothing to synchronise$/.exec(message);
  if (notConnected) return fr(lang) ? `${notConnected[1]} n’est pas connecté — rien à synchroniser` : message;
  const files = /^(.+) exchanges files only — use the export cards$/.exec(message);
  if (files) return fr(lang) ? `${files[1]} échange uniquement des fichiers — utilisez les cartes d’export` : message;
  const unknownLoc = /^Unknown location (.+)$/.exec(message);
  if (unknownLoc) return fr(lang) ? `Emplacement inconnu : ${unknownLoc[1]}` : message;
  const pct = /^(Deposit|Delivery|Acceptance) must be a whole percentage \(0–100\)$/.exec(message);
  if (pct) return fr(lang) ? `${t(pct[1] + ' %')} : saisissez un pourcentage entier (0–100)` : message;
  const cat = /^Category (\d+): invalid (budget|type)$/.exec(message);
  if (cat) return fr(lang) ? `Catégorie ${cat[1]} : ${cat[2] === 'budget' ? 'budget invalide' : 'type invalide'}` : message;
  const req = /^(Phase|System|Category) (\d+) is required$/.exec(message);
  if (req) return fr(lang) ? `${req[1] === 'Phase' ? 'Phase' : req[1] === 'System' ? 'Système' : 'Catégorie'} ${req[2]} : saisissez un nom` : message;
  const unknown = /^Unknown (machine type|reference project|connector) (.+)$/.exec(message);
  if (unknown) return fr(lang) ? `${unknown[1] === 'machine type' ? 'Type de machine inconnu' : unknown[1] === 'connector' ? 'Connecteur inconnu' : 'Projet de référence inconnu'} : ${unknown[2]}` : message;
  const outside = /^(Settings|Machine types|Activity & integrations) is outside your workspace$/.exec(message);
  if (outside) return t(outside[1] === 'Settings' ? 'Settings are read-only for you' : outside[1] === 'Machine types' ? 'Machine types are read-only for you' : 'Activity & integrations is read-only for you');
  return KNOWN.has(message) ? t(message) : null;
}

const KNOWN = new Set([
  'Settings are read-only for you', 'Machine types are read-only for you', 'Activity & integrations is read-only for you', 'Invalid request',
  'Entry is required', 'Location is required', 'Unknown list', 'Unknown entry', 'Invalid location type', 'A holiday reads "14 Jul · Fête nationale"',
  'Enter a threshold between 0 and 2', '"Off track below" must be lower than "At risk below"', 'Code already used', 'Code is required', 'Code is too long',
  'Label is required', 'Invalid calendar', 'ITP systems must be distinct', 'System is required', 'Invalid direction', 'Invalid frequency',
  'Invalid threshold risk', 'Invalid threshold off', 'The change could not be saved',
]);
