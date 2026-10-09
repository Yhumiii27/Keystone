// Administration translation helpers. English stays the prototype's source text (docs/spec/10 §1–2, 09 §9); the French
// comes from the prototype dictionary through t() (and src/i18n/extra/admin.json), except where the prototype's French
// was wrong or missing:
// - "Request" chip: the noun "Demande" (the shared entry is the verb "Demander");
// - list sub-lines and counts have their singular forms ("1 système ITP");
// - texts the rebuild adds: connector modes and outboxes, Vigie / Codex volumes, sync toasts, rule messages.
import type { Lang, T } from '@/i18n/translate';

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
  const cursus = /^(\d+) approvals received$/.exec(text);
  if (cursus) return plural(+cursus[1], 'approbation reçue', 'approbations reçues');
  if (text === 'First sync scheduled') return 'Première synchro planifiée';
  return t(text);
}

/** "Sync now" toast ("Lucca synced · 312 h · 8 people"; no volume for a connector that exchanged nothing yet). */
export function syncToastT(name: string, r: { ok: boolean; volume: string; error: string | null }, t: T, lang: Lang): string {
  if (r.ok) {
    const head = fr(lang) ? `${name} synchronisé` : `${name} synced`;
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
  const conn = /^(.+) is already connected$/.exec(message);
  if (conn) return fr(lang) ? `${conn[1]} est déjà connecté` : message;
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
