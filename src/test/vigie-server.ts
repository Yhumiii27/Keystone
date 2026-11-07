// Test helper (D12, D13): Vigie's side of the shared PostgreSQL server, built in a PGlite database — the schema `vigie` with the
// publications Keystone reads (columns of their contracts, as Matrix's data/publications-depot.json and Vigie's migration 0009
// define them; backed by plain tables the tests fill) and Vigie's two functions, copied from Vigie's migrations
// 0026_convergence_m02_nc_inbox and 0029_convergence_m02_ecr_eco (same checks, same SQLSTATE P0V01 / P0V02, the request deposited
// in vigie.inbound_requests and its number returned, idempotent by p_id_externe). vigie.pub_demandes_recues is Matrix's definition
// (caller = session_user). Keystone's code under test only SELECTs the views and calls the functions, as on the server.
// `processVigieRequests` plays Vigie's processing (src/server/inbound.ts of Vigie): applied, or rejected with a coded reason.
import { sql } from 'drizzle-orm';
import type { DB } from '@/server/db/types';
import type { VigieEcoRecord, VigieHseRecord, VigieNcrRecord } from '@/server/integrations/vigie/types';

const SCHEMA = String.raw`
create schema if not exists vigie;
create table vigie.nc_rows (
  project_code text, number text, vigie_ref text, title text, severity text, source text, status text, activity_code text, part_ref text,
  deliverable_number text, supplier_id text, supplier_name text, raised_by_name text, raised_on date, owner_name text, owner_matricule text,
  root_cause text, action text, due_on date, cost_keur numeric, iso_clause text, closed_on date, vigie_updated_at timestamptz);
create view vigie.pub_non_conformites as select * from vigie.nc_rows;
create table vigie.hse_rows (project_code text, vigie_ref text, kind text, title text, status text, status_text text, date_on date, position integer);
create view vigie.pub_hse_projet as select * from vigie.hse_rows;
create table vigie.eco_rows (
  number text, title text, eco_type text, status text, interchangeability text, from_revision text, to_revision text, cost_eur numeric(12, 2),
  schedule_days integer, stock_impact text, document_refs text[], codex_doc_ids text[], requested_by_name text, requested_by_matricule text,
  raised_on date, pending_dispositions integer, locked boolean, parts text[], projects text[], released_at timestamptz, vigie_updated_at timestamptz);
create view vigie.pub_ordres_modification as select * from vigie.eco_rows;
create table vigie.eco_approval_rows (eco_number text, approval_key text, decision text, approver_text text, decided_by_name text,
  decided_by_matricule text, decided_at timestamptz);
create view vigie.pub_eco_approbations as select * from vigie.eco_approval_rows;
create table vigie.eco_effectivity_rows (eco_number text, target_type text, target_ref text, label text, disposition text, is_automatic boolean,
  note text, fitted_part_ref text, fitted_revision text, position integer);
create view vigie.pub_eco_effectivite as select * from vigie.eco_effectivity_rows;

create table vigie.inbound_callers (role text primary key, tool text not null, label text not null);
create table vigie.inbound_requests (
  id serial primary key, caller text not null, tool text not null, kind text not null, external_id text not null, target_ref text not null,
  project_code text, payload jsonb not null, received_at timestamptz not null default now(), status text not null default 'received',
  processed_at timestamptz, result_code text, result text, event_id text, unique (caller, external_id));
create view vigie.pub_demandes_recues as
  select r.id, r.external_id as id_externe, r.kind as nature, r.target_ref as numero, r.project_code as projet_code, r.status as statut,
         r.received_at as recu_le, r.processed_at as traite_le, r.result_code as code_resultat, r.result as resultat, r.event_id as vigie_ref
  from vigie.inbound_requests r where r.caller = session_user;
`;

/** vigie.pub_signaler_avancement_nc as Vigie's migration 0026 creates it (schema-qualified here). */
const NC_FUNCTION = String.raw`
create function vigie.pub_signaler_avancement_nc(
  p_numero text, p_projet text, p_nature text, p_etape_depuis text, p_etape_cible text, p_decision text,
  p_commentaire text, p_acteur_nom text, p_acteur_role text, p_enregistre_le timestamptz, p_id_externe text,
  p_activite text, p_article text, p_livrable text
) returns integer
language plpgsql security definer set search_path = vigie, pg_temp
as $$
declare
  v_outil text;
  v_id integer;
  v_etats text[] := array['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'];
  v_ref text := '^[^[:cntrl:]]{1,64}$';
begin
  select c.tool into v_outil from vigie.inbound_callers c where c.role = session_user;
  if v_outil is null then
    raise exception 'appelant non admis : %', session_user using errcode = 'P0V01';
  end if;
  if p_id_externe is null or p_id_externe !~ '^[^[:cntrl:]]{1,100}$' then
    raise exception 'identifiant externe (p_id_externe) absent ou trop long' using errcode = 'P0V02';
  end if;
  if p_numero is null or p_numero !~ '^EV-[0-9]{4}-[0-9]{1,9}$' then
    raise exception 'numéro de NC invalide : référence EV-AAAA-n de Vigie attendue' using errcode = 'P0V02';
  end if;
  if p_projet is null or p_projet !~ v_ref then
    raise exception 'code projet (p_projet) absent ou invalide' using errcode = 'P0V02';
  end if;
  if p_nature is null or p_nature not in ('step', 'verification', 'references') then
    raise exception 'nature invalide : step, verification ou references' using errcode = 'P0V02';
  end if;
  if p_nature in ('step', 'verification') and (p_etape_depuis is null or not (p_etape_depuis = any (v_etats))) then
    raise exception 'étape de départ (p_etape_depuis) invalide' using errcode = 'P0V02';
  end if;
  if p_nature = 'step' and (p_etape_cible is null or not (p_etape_cible = any (v_etats))) then
    raise exception 'étape demandée (p_etape_cible) invalide' using errcode = 'P0V02';
  end if;
  if p_nature = 'verification' and (p_decision is null or p_decision not in ('approved', 'rejected')) then
    raise exception 'décision de vérification (p_decision) invalide : approved ou rejected' using errcode = 'P0V02';
  end if;
  if p_nature = 'references' and p_activite is null and p_article is null and p_livrable is null then
    raise exception 'aucune référence transmise (p_activite, p_article, p_livrable)' using errcode = 'P0V02';
  end if;
  if length(p_commentaire) > 2000 or length(p_acteur_nom) > 200 or length(p_acteur_role) > 50 then
    raise exception 'commentaire ou acteur trop long' using errcode = 'P0V02';
  end if;
  insert into vigie.inbound_requests (caller, tool, kind, external_id, target_ref, project_code, payload)
  values (session_user, v_outil, 'nc_' || p_nature, p_id_externe, p_numero, p_projet, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_nature,
    'fromStatus', case when p_nature <> 'references' then p_etape_depuis end,
    'targetStatus', case when p_nature = 'step' then p_etape_cible end,
    'decision', case when p_nature = 'verification' then p_decision end,
    'comment', nullif(btrim(p_commentaire), ''),
    'actor', jsonb_strip_nulls(jsonb_build_object('name', nullif(btrim(p_acteur_nom), ''), 'role', nullif(btrim(p_acteur_role), ''))),
    'recordedAt', to_char(p_enregistre_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activityCode', p_activite, 'partRef', p_article, 'deliverableNumber', p_livrable)))
  on conflict (caller, external_id) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from vigie.inbound_requests r where r.caller = session_user and r.external_id = p_id_externe;
  end if;
  return v_id;
end
$$;
`;

/** vigie.pub_signaler_avancement_eco as Vigie's migration 0029 creates it (schema-qualified here). */
const ECO_FUNCTION = String.raw`
create function vigie.pub_signaler_avancement_eco(
  p_numero text, p_nature text, p_cle text, p_decision text, p_etape_depuis text, p_etape_cible text, p_commentaire text,
  p_acteur_nom text, p_acteur_role text, p_enregistre_le timestamptz, p_id_externe text
) returns integer
language plpgsql security definer set search_path = vigie, pg_temp
as $$
declare
  v_outil text;
  v_id integer;
  v_etats text[] := array['draft', 'impact_analysis', 'in_approval', 'released', 'rejected'];
begin
  select c.tool into v_outil from vigie.inbound_callers c where c.role = session_user;
  if v_outil is null or v_outil <> 'keystone' then
    raise exception 'appelant non admis : %', session_user using errcode = 'P0V01';
  end if;
  if p_id_externe is null or p_id_externe !~ '^[^[:cntrl:]]{1,100}$' then
    raise exception 'identifiant externe (p_id_externe) absent ou trop long' using errcode = 'P0V02';
  end if;
  if p_numero is null or p_numero !~ '^ECO-[0-9]{4}-[0-9]{3,9}$' then
    raise exception 'numéro d''ordre invalide : ECO-AAAA-NNN de Vigie attendu' using errcode = 'P0V02';
  end if;
  if p_nature is null or p_nature not in ('step', 'approval') then
    raise exception 'nature invalide : step ou approval' using errcode = 'P0V02';
  end if;
  if p_nature = 'step' and (p_etape_depuis is null or not (p_etape_depuis = any (v_etats)) or p_etape_cible is null or not (p_etape_cible = any (v_etats))) then
    raise exception 'étapes (p_etape_depuis, p_etape_cible) invalides' using errcode = 'P0V02';
  end if;
  if p_nature = 'approval' and (p_cle is null or p_cle not in ('englead', 'quality', 'pm') or p_decision is null or p_decision not in ('ok', 'rejected')) then
    raise exception 'clé (englead, quality, pm) ou décision (ok, rejected) invalide' using errcode = 'P0V02';
  end if;
  if p_etape_depuis is not null and not (p_etape_depuis = any (v_etats)) then
    raise exception 'étape de départ (p_etape_depuis) invalide' using errcode = 'P0V02';
  end if;
  if length(p_commentaire) > 2000 or length(p_acteur_nom) > 200 or length(p_acteur_role) > 50 then
    raise exception 'commentaire ou acteur trop long' using errcode = 'P0V02';
  end if;
  insert into vigie.inbound_requests (caller, tool, kind, external_id, target_ref, project_code, payload)
  values (session_user, v_outil, 'eco_' || p_nature, p_id_externe, p_numero, null, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_nature,
    'approvalKey', case when p_nature = 'approval' then p_cle end,
    'decision', case when p_nature = 'approval' then p_decision end,
    'fromStatus', p_etape_depuis,
    'targetStatus', case when p_nature = 'step' then p_etape_cible end,
    'comment', nullif(btrim(p_commentaire), ''),
    'actor', jsonb_strip_nulls(jsonb_build_object('name', nullif(btrim(p_acteur_nom), ''), 'role', nullif(btrim(p_acteur_role), ''))),
    'recordedAt', to_char(p_enregistre_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
  on conflict (caller, external_id) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from vigie.inbound_requests r where r.caller = session_user and r.external_id = p_id_externe;
  end if;
  return v_id;
end
$$;
`;

/**
 * Builds Vigie's side of the server in the test database (dropped first): the publications, empty; the two functions; the
 * caller table with the test's own session user registered as Keystone (as Vigie's demonstration does), unless `admitted` is false.
 */
export async function createVigieServer(db: DB, opts: { admitted?: boolean; functions?: boolean; requestsView?: boolean } = {}): Promise<void> {
  await db.execute(sql.raw('drop schema if exists vigie cascade'));
  // One statement per call (a prepared statement takes one command).
  for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
  if (opts.functions ?? true) {
    await db.execute(sql.raw(NC_FUNCTION));
    await db.execute(sql.raw(ECO_FUNCTION));
  }
  if (!(opts.requestsView ?? true)) await db.execute(sql.raw('drop view vigie.pub_demandes_recues'));
  if (opts.admitted ?? true) await db.execute(sql.raw(`insert into vigie.inbound_callers values (session_user, 'keystone', 'Keystone')`));
}

const lit = (rows: readonly unknown[]) => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;

async function fill(db: DB, table: string, rows: readonly Record<string, unknown>[]) {
  await db.execute(sql.raw(`delete from vigie.${table}`));
  if (rows.length) await db.execute(sql.raw(`insert into vigie.${table} select * from jsonb_populate_recordset(null::vigie.${table}, ${lit(rows)})`));
}

/** An NCR record as vigie.pub_non_conformites publishes it. */
export const ncrRowOf = (r: VigieNcrRecord): Record<string, unknown> => ({
  project_code: r.projectCode, number: r.number, vigie_ref: r.vigieRef ?? r.number, title: r.title, severity: r.severity, source: r.source, status: r.status,
  activity_code: r.activityCode, part_ref: r.partRef, deliverable_number: r.deliverableNumber, supplier_id: r.supplierId ?? null, supplier_name: r.supplierName,
  raised_by_name: r.raisedBy, raised_on: r.raisedOn, owner_name: r.owner, owner_matricule: r.ownerMatricule ?? null, root_cause: r.rootCause, action: r.action,
  due_on: r.dueOn, cost_keur: r.costKeur, iso_clause: r.isoClause, closed_on: r.closedOn ?? null, vigie_updated_at: r.updatedAt,
});

/** Vigie's NCR and HSE publications (each call replaces the given ones). */
export async function setVigieQualityRows(db: DB, rows: { ncrs?: readonly VigieNcrRecord[]; hse?: readonly VigieHseRecord[]; rawNcrs?: readonly Record<string, unknown>[] }) {
  if (rows.ncrs || rows.rawNcrs) await fill(db, 'nc_rows', [...(rows.ncrs ?? []).map(ncrRowOf), ...(rows.rawNcrs ?? [])]);
  if (rows.hse) {
    const pos = new Map<string, number>();
    await fill(db, 'hse_rows', rows.hse.map((h) => {
      const p = pos.get(h.projectCode) ?? 0;
      pos.set(h.projectCode, p + 1);
      return { project_code: h.projectCode, vigie_ref: h.vigieRef, kind: h.kind, title: h.title, status: h.status, status_text: h.statusText, date_on: h.dateOn, position: p };
    }));
  }
}

/** Vigie's three change-order publications (replaced). */
export async function setVigieEcoRows(db: DB, ecos: readonly VigieEcoRecord[]) {
  await fill(db, 'eco_rows', ecos.map((e) => ({
    number: e.number, title: e.title, eco_type: e.type, status: e.status, interchangeability: e.interchangeability, from_revision: e.fromRevision, to_revision: e.toRevision,
    cost_eur: e.costEur, schedule_days: e.scheduleDays, stock_impact: e.stockImpact, document_refs: e.documentRefs, codex_doc_ids: [], requested_by_name: e.requestedBy,
    requested_by_matricule: null, raised_on: e.raisedOn, pending_dispositions: e.pendingDispositions, locked: e.locked, parts: e.parts, projects: e.projects,
    released_at: e.releasedAt ?? null, vigie_updated_at: e.updatedAt,
  })));
  await fill(db, 'eco_approval_rows', ecos.flatMap((e) => e.approvals.map((a) => ({
    eco_number: e.number, approval_key: a.key, decision: a.decision, approver_text: a.approver, decided_by_name: a.decidedBy, decided_by_matricule: null, decided_at: a.decidedAt,
  }))));
  await fill(db, 'eco_effectivity_rows', ecos.flatMap((e) => e.effectivity.map((t, position) => ({
    eco_number: e.number, target_type: t.targetType, target_ref: t.targetRef, label: t.label, disposition: t.disposition, is_automatic: t.isAutomatic, note: t.note,
    fitted_part_ref: t.fittedPartRef, fitted_revision: t.fittedRevision, position,
  }))));
}

/** The requests deposited in Vigie (oldest first). */
export async function vigieRequests(db: DB): Promise<{ id: number; kind: string; external_id: string; target_ref: string; project_code: string | null; status: string; payload: Record<string, unknown> }[]> {
  const res = await db.execute(sql.raw('select id, kind, external_id, target_ref, project_code, status, payload from vigie.inbound_requests order by id'));
  return (res.rows as { id: number; kind: string; external_id: string; target_ref: string; project_code: string | null; status: string; payload: Record<string, unknown> | string }[])
    .map((r) => ({ ...r, payload: typeof r.payload === 'string' ? (JSON.parse(r.payload) as Record<string, unknown>) : r.payload }));
}

/** Vigie processes the received requests: `decide` gives each outcome (applied, or rejected with a code and a message). */
export async function processVigieRequests(
  db: DB, decide: (r: { id: number; kind: string; target_ref: string; payload: Record<string, unknown> }) => { status: 'applied' } | { status: 'rejected'; code: 'stale' | 'refused' | 'not_found' | 'invalid'; result: string },
): Promise<void> {
  for (const r of (await vigieRequests(db)).filter((x) => x.status === 'received')) {
    const d = decide(r);
    await db.execute(sql`update vigie.inbound_requests set status = ${d.status}, processed_at = now(), result_code = ${d.status === 'rejected' ? d.code : null},
      result = ${d.status === 'rejected' ? d.result : 'Appliquée'} where id = ${r.id}`);
  }
}
