import 'server-only';
// Vigie on the shared PostgreSQL server (D12, D13; M-17 / M-18): Keystone reads Vigie's publications and deposits its progress
// through Vigie's functions, on its own connection (role keystone_app). It never reads Vigie's tables nor writes in its schema; every
// object below is a link Matrix decides (lecture / execution):
//   lecture    vigie.pub_non_conformites, vigie.pub_hse_projet (D13), vigie.pub_ordres_modification, vigie.pub_eco_approbations,
//              vigie.pub_eco_effectivite (D12), vigie.pub_demandes_recues (state of Keystone's requests, D13 CV-08)
//   execution  vigie.pub_signaler_avancement_nc (D13), vigie.pub_signaler_avancement_eco (D12)
// Rows are read with `to_jsonb(v)`, so a column Vigie adds at the end of a view never breaks the read (capex/connector.ts does the
// same for Arche). Named arguments (`p_numero => …`): the functions' signatures are contracts Vigie never changes (a new version
// takes a new name).
import { sql, type SQL } from 'drizzle-orm';
import type { DB } from '@/server/db/types';
import type { EcoProgressEntry, NcrProgressEntry } from './types';

type Row = Record<string, unknown>;

/** Vigie's publications Keystone reads. */
export const VIGIE_VIEWS = {
  ncrs: 'vigie.pub_non_conformites',
  hse: 'vigie.pub_hse_projet',
  ecos: 'vigie.pub_ordres_modification',
  ecoApprovals: 'vigie.pub_eco_approbations',
  ecoEffectivity: 'vigie.pub_eco_effectivite',
  requests: 'vigie.pub_demandes_recues',
} as const;

/** Vigie's functions Keystone calls. */
export const VIGIE_FUNCTIONS = { ncr: 'vigie.pub_signaler_avancement_nc', eco: 'vigie.pub_signaler_avancement_eco' } as const;

const rowsOf = (res: { rows: unknown[] }) =>
  (res.rows as { r: Row | string }[]).map((x) => (typeof x.r === 'string' ? (JSON.parse(x.r) as Row) : x.r));

/** Every row of one of Vigie's views (`where` optional, on the view's alias `v`). */
export async function readVigieView(db: DB, view: (typeof VIGIE_VIEWS)[keyof typeof VIGIE_VIEWS], where?: SQL): Promise<Row[]> {
  const q = sql`select to_jsonb(v) as r from ${sql.raw(view)} v`;
  return rowsOf(await db.execute(where ? sql`${q} where ${where}` : q));
}

/** The NCR and HSE publications (D13). */
export async function readVigieQualityViews(db: DB): Promise<{ ncrs: Row[]; hse: Row[] }> {
  return { ncrs: await readVigieView(db, VIGIE_VIEWS.ncrs), hse: await readVigieView(db, VIGIE_VIEWS.hse) };
}

/** The three change-order publications (D12). */
export async function readVigieEcoViews(db: DB): Promise<{ orders: Row[]; approvals: Row[]; effectivity: Row[] }> {
  return {
    orders: await readVigieView(db, VIGIE_VIEWS.ecos),
    approvals: await readVigieView(db, VIGIE_VIEWS.ecoApprovals),
    effectivity: await readVigieView(db, VIGIE_VIEWS.ecoEffectivity),
  };
}

/** The state of Keystone's requests (pub_demandes_recues shows the caller's own requests only), by Keystone's ids. */
export async function readVigieRequestRows(db: DB, externalIds: readonly string[]): Promise<Row[]> {
  if (!externalIds.length) return [];
  return readVigieView(db, VIGIE_VIEWS.requests, sql`v.id_externe in (${sql.join(externalIds.map((id) => sql`${id}`), sql`, `)})`);
}

const scalar = (res: { rows: unknown[] }): string | null => {
  const v = (res.rows[0] as { id?: unknown } | undefined)?.id;
  return v == null ? null : String(v);
};

/**
 * Deposits an NCR progress entry (D13): `select vigie.pub_signaler_avancement_nc(…)`; returns Vigie's request number (the same
 * for an entry deposited again: `p_id_externe` is the entry's id). Throws the database error (P0V01 / P0V02 / any other).
 */
export async function depositNcrProgress(db: DB, e: NcrProgressEntry): Promise<string | null> {
  return scalar(await db.execute(sql`select ${sql.raw(VIGIE_FUNCTIONS.ncr)}(
    p_numero => ${e.ncrNumber}, p_projet => ${e.projectCode}, p_nature => ${e.kind},
    p_etape_depuis => ${e.fromStatus}, p_etape_cible => ${e.kind === 'step' ? e.targetStatus : null}::text, p_decision => ${e.decision}::text,
    p_commentaire => ${e.comment}::text, p_acteur_nom => ${e.actorName}, p_acteur_role => ${e.actorRole},
    p_enregistre_le => ${e.recordedAt}::timestamptz, p_id_externe => ${e.id},
    p_activite => null::text, p_article => null::text, p_livrable => null::text) as id`));
}

/**
 * Deposits an ECO progress entry (D12): `select vigie.pub_signaler_avancement_eco(…)`; returns Vigie's request number. Throws the
 * database error.
 */
export async function depositEcoProgress(db: DB, e: EcoProgressEntry): Promise<string | null> {
  return scalar(await db.execute(sql`select ${sql.raw(VIGIE_FUNCTIONS.eco)}(
    p_numero => ${e.ecoNumber}, p_nature => ${e.kind}, p_cle => ${e.approvalKey}::text, p_decision => ${e.decision}::text,
    p_etape_depuis => ${e.fromStatus}, p_etape_cible => ${e.targetStatus}::text, p_commentaire => ${e.comment}::text,
    p_acteur_nom => ${e.actorName}, p_acteur_role => ${e.actorRole}, p_enregistre_le => ${e.recordedAt}::timestamptz,
    p_id_externe => ${e.id}) as id`));
}
