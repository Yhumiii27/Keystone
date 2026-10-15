// Links from Keystone to Vigie (pure, client-safe). Vigie has no ECO module yet: the ECO routes and parameters below were
// agreed by the owner (NEW-D4-1 "a", NEW-VIGIE-1 "a": Vigie adopts them when it builds its ECO module, R-024; contract in
// docs/integrations/vigie-contract.md). Every Vigie URL of Keystone is built here, so adopting a change of Vigie's routes
// is a one-file change. Links open outside Keystone: render them with VIGIE_LINK_ATTRS (the Mac app hands target=_blank
// links to the browser).
import { vigiePublicUrl } from './config';

/** Path of the ECO register in Vigie, agreed by NEW-D4-1 "a" (Vigie's other routes are French: /evenements, /actions…). */
export const VIGIE_ECO_PATH = '/modifications-techniques';
/** Path of Vigie's "new ECO" form, agreed by NEW-D4-1 "a". */
export const VIGIE_NEW_ECO_PATH = `${VIGIE_ECO_PATH}/nouvelle`;

/** Anchor attributes of every link to Vigie (opens outside Keystone). */
export const VIGIE_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && String(v).trim()) p.set(k, String(v).trim());
  const s = p.toString();
  return s ? `?${s}` : '';
};

/**
 * The project as Vigie's lists and forms receive it (`projet`, V-3b "a"; `project` on the ECO routes, NEW-D4-1 "a").
 * OPEN QUESTION V-3 / NEW-SYS-1: Vigie's events carry its own project ids ("K-2025-042"); until NEW-SYS-1 / R-022 settle
 * the shared project id, Keystone sends its own code ("HLT-026"). Every Vigie link names the project through this one
 * helper, so the later mapping changes one place.
 */
export function vigieProjectParam(projectCode: string | null | undefined): string | null {
  const code = projectCode?.trim();
  return code ? code : null;
}

/** Filter of a Vigie list on one project (R-025): `{ projectCode }` → `projet=<code>`; nothing when not given. */
export interface VigieProjectFilter {
  projectCode?: string | null;
}

/** The ECO record in Vigie ("ECO-2026-015"). */
export function vigieEcoUrl(id: string): string {
  return `${vigiePublicUrl()}${VIGIE_ECO_PATH}/${encodeURIComponent(id)}`;
}

/**
 * Vigie's "new ECO" form, prefilled with what Keystone knows ("Raise ECO" from a BOM node or a part record). The English
 * parameter names `part`, `project`, `title` and `source=keystone` were agreed by NEW-D4-1 "a" (Vigie adopts them). A
 * claim number carried by the title (delivery 7, claim drawer) is NOT an agreed parameter: Vigie only has to accept long,
 * free-text titles (open proposal in the contract).
 */
export function vigieNewEcoUrl(ctx: { partRef?: string | null; projectCode?: string | null; title?: string | null } = {}): string {
  return `${vigiePublicUrl()}${VIGIE_NEW_ECO_PATH}${qs({ part: ctx.partRef, project: vigieProjectParam(ctx.projectCode), title: ctx.title, source: 'keystone' })}`;
}

/** Vigie's ECO register, optionally filtered on a part or a project (filters `part` and `project`, agreed by NEW-D4-1 "a"). */
export function vigieEcoListUrl(filter: { partRef?: string | null; projectCode?: string | null } = {}): string {
  return `${vigiePublicUrl()}${VIGIE_ECO_PATH}${qs({ part: filter.partRef, project: vigieProjectParam(filter.projectCode) })}`;
}

// ── Non-conformities (NCR) and site HSE (Delivery 5) ────────────────────────────────────────────────────
// Vigie's real routes (Vigie README, src/app): /evenements (signalements et événements, type NC = non-conformité,
// `?sel=<event id>`, `?etat=tous`, `?type=`, `?q=`), /signaler (field report form, `?lieu=`), /actions (`?action=A-214`),
// /prevention (plans `?plan=PP-…`, permits `?onglet=permis&permis=PF-…`), /prevention/carte (co-activity map).
// R-025 (V-3b "a"): the lists also receive the project as `projet` — Keystone's proposal (Vigie does not read it yet), the
// Keystone code until NEW-SYS-1 / R-022 (vigieProjectParam).

/** Vigie's events register (non-conformities are events of type NC). */
export const VIGIE_EVENTS_PATH = '/evenements';
/** Vigie's field report form (where an NCR or an incident is reported). */
export const VIGIE_REPORT_PATH = '/signaler';
/** Vigie's prevention plans and permits. */
export const VIGIE_PREVENTION_PATH = '/prevention';
/** Vigie's site map and co-activity screen. */
export const VIGIE_COACTIVITY_PATH = '/prevention/carte';

/**
 * An NCR in Vigie. With Vigie's event id: the event record (`/evenements?etat=tous&sel=EV-2026-130`). Without it — the
 * prototype NCR numbers are not Vigie ids — OPEN QUESTION V-3: Vigie has no field for Keystone's NCR number, so the link
 * opens the NC events searched by that number (`/evenements?etat=tous&type=NC&q=NCR-029`).
 */
export function vigieNcrUrl(ncr: { number: string; vigieRef?: string | null }): string {
  return ncr.vigieRef
    ? `${vigiePublicUrl()}${VIGIE_EVENTS_PATH}${qs({ etat: 'tous', sel: ncr.vigieRef })}`
    : `${vigiePublicUrl()}${VIGIE_EVENTS_PATH}${qs({ etat: 'tous', type: 'NC', q: ncr.number })}`;
}

/**
 * Vigie's non-conformities ("Manage in Vigie"), filtered on the project when one is given (R-025). OPEN QUESTION V-3:
 * Vigie's events carry its own project ids ("K-2025-042"); `projet` is the Keystone code until NEW-SYS-1 / R-022.
 */
export function vigieNcrListUrl(filter: VigieProjectFilter = {}): string {
  return `${vigiePublicUrl()}${VIGIE_EVENTS_PATH}${qs({ type: 'NC', projet: vigieProjectParam(filter.projectCode) })}`;
}

/**
 * "Report in Vigie" — Vigie's report form, prefilled with what Keystone knows. OPEN QUESTION V-3: /signaler reads only
 * `lieu` today; `type`, `projet`, `article`, `activite`, `titre`, `inspection` and `source=keystone` are proposals
 * (V-3b, owner's answer "a": project, part, activity, title and place; Q-6b adds the ITP inspection, which Vigie should
 * echo on the NCR so Keystone shows its number on the inspection — `inspectionNumber` of the NCR mirror). A supplier NCR
 * declared from a rejected receipt (R-096: NEW-D4-3 "a", SC-3b "a") also proposes `fournisseur`, `code_fournisseur`
 * (Sage X3 supplier code), `commande` (purchase order), `reception` (delivery number) and `quantite` (rejected quantity) —
 * Keystone's proposal under V-3, like the others. Empty values are left out.
 */
export function vigieReportNcrUrl(
  ctx: {
    projectCode?: string | null; partRef?: string | null; activityCode?: string | null; title?: string | null; location?: string | null; inspection?: string | null;
    supplier?: string | null; supplierCode?: string | null; order?: string | null; receipt?: string | null; quantity?: number | null;
  } = {},
): string {
  return `${vigiePublicUrl()}${VIGIE_REPORT_PATH}${qs({
    type: 'NC', projet: vigieProjectParam(ctx.projectCode), article: ctx.partRef, activite: ctx.activityCode, titre: ctx.title, lieu: ctx.location,
    inspection: ctx.inspection, fournisseur: ctx.supplier, code_fournisseur: ctx.supplierCode, commande: ctx.order, reception: ctx.receipt,
    quantite: ctx.quantity == null ? null : String(ctx.quantity), source: 'keystone',
  })}`;
}

/** "Declare incident" (site HSE register) — Vigie's report form (OPEN QUESTION V-3 for the prefill parameters). */
export function vigieReportIncidentUrl(ctx: { projectCode?: string | null; location?: string | null } = {}): string {
  return `${vigiePublicUrl()}${VIGIE_REPORT_PATH}${qs({ projet: vigieProjectParam(ctx.projectCode), lieu: ctx.location, source: 'keystone' })}`;
}

/**
 * A site HSE item in Vigie: a prevention plan (`/prevention?plan=PP-…`) or a permit (`/prevention?onglet=permis&permis=PF-…`)
 * when Vigie gave its id; else the matching list (plans, permits; the near-miss register opens the near-miss events),
 * filtered on the item's project when Keystone gives it (R-025). A record opened by its own id needs no project.
 */
export function vigieHseUrl(item: { kind: 'prevention_plan' | 'induction' | 'permit' | 'register'; vigieRef?: string | null; projectCode?: string | null }): string {
  const base = vigiePublicUrl();
  const projet = item.vigieRef ? null : vigieProjectParam(item.projectCode);
  if (item.kind === 'permit') return `${base}${VIGIE_PREVENTION_PATH}${qs({ onglet: 'permis', permis: item.vigieRef, projet })}`;
  if (item.kind === 'register') return `${base}${VIGIE_EVENTS_PATH}${qs({ etat: 'tous', type: 'PA', projet: vigieProjectParam(item.projectCode) })}`;
  return `${base}${VIGIE_PREVENTION_PATH}${qs({ plan: item.vigieRef, projet })}`;
}

/** Vigie's prevention plans and permits ("Manage in Vigie" on the HSE register), filtered on the project when given (R-025). */
export function vigieHseListUrl(filter: VigieProjectFilter = {}): string {
  return `${vigiePublicUrl()}${VIGIE_PREVENTION_PATH}${qs({ projet: vigieProjectParam(filter.projectCode) })}`;
}

/** Vigie's site map and co-activity detection, filtered on the project when given (R-025). */
export function vigieCoactivityUrl(filter: VigieProjectFilter = {}): string {
  return `${vigiePublicUrl()}${VIGIE_COACTIVITY_PATH}${qs({ projet: vigieProjectParam(filter.projectCode) })}`;
}
