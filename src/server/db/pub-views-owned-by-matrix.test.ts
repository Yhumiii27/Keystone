// Matrix M-18 (owner, 1 Nov 2026; REQUESTS.md): Matrix defines Keystone's `pub_` views and grants every cross-tool access. The
// migrations up to 0074 created the 22 views Matrix takes over (they keep creating them on a fresh PGlite or server database);
// a NEW migration must not create, replace, alter or drop a `pub_` view, nor grant anything to another tool's role: a new
// publication or an extra column is asked of Matrix (entry in its REQUESTS.md), which applies it as `matrix_gestion`.
// A `pub_<verb>_<object>` function for a write another tool makes in Keystone stays allowed (SECURITY DEFINER, search_path set,
// EXECUTE revoked from PUBLIC; the right to run it is a Matrix link).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARE_VIEW_COUNT } from './share-contracts';

const DRIZZLE = path.join(process.cwd(), 'drizzle');
/** The last migration that may define a `pub_` view (0071_project_category_share); 0074 is the last one before M-18. */
const LAST_MIGRATION_BEFORE_M18 = 74;

const migrations = readdirSync(DRIZZLE)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .map((f) => ({ file: f, n: Number(f.slice(0, 4)), sql: readFileSync(path.join(DRIZZLE, f), 'utf8') }));
/** SQL without its comments, so a comment that names a view is not mistaken for DDL. */
const code = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const VIEW_DDL = /\b(create\s+(or\s+replace\s+)?view|alter\s+view|drop\s+view|comment\s+on\s+view)\s+(if\s+(not\s+)?exists\s+)?"?(\w+"?\.)?"?pub_/i;
/** The views M-18 lists for Matrix to take over (REQUESTS.md, « Détails techniques »). */
const TAKEN_OVER = [
  'pub_activites', 'pub_affectations', 'pub_articles', 'pub_avancement_projets', 'pub_avenants', 'pub_catalogue_machines', 'pub_chantiers',
  'pub_clients', 'pub_expeditions', 'pub_fournisseurs', 'pub_jalons', 'pub_jalons_projets', 'pub_journal', 'pub_livrables',
  'pub_nomenclatures', 'pub_pack_ingenierie', 'pub_parc_machines', 'pub_projets', 'pub_reponses_besoins', 'pub_reserves', 'pub_rex',
  'pub_taches_jours',
];
const OTHER_TOOL_GRANT = /\bgrant\b[\s\S]*?\bto\s+"?(arche|cursus|vigie|codex|crucible|matrix)_\w+/i;

describe('Matrix M-18: pub_ views are defined by Matrix', () => {
  it('no migration after 0074 creates, replaces, alters, comments or drops a pub_ view', () => {
    const offenders = migrations.filter((m) => m.n > LAST_MIGRATION_BEFORE_M18 && VIEW_DDL.test(code(m.sql))).map((m) => m.file);
    expect(offenders, 'ask Matrix for the publication instead (REQUESTS.md of Matrix)').toEqual([]);
  });

  it('no migration after 0074 grants anything to another tool (rights are Matrix links)', () => {
    const offenders = migrations.filter((m) => m.n > LAST_MIGRATION_BEFORE_M18 && OTHER_TOOL_GRANT.test(code(m.sql))).map((m) => m.file);
    expect(offenders).toEqual([]);
  });

  it('the earlier migrations define exactly the 22 views listed for Matrix to take over', () => {
    const names = new Set<string>();
    for (const m of migrations) for (const x of code(m.sql).matchAll(/create\s+(?:or\s+replace\s+)?view\s+"?(pub_\w+)/gi)) names.add(x[1]);
    expect(names.size).toBe(SHARE_VIEW_COUNT);
    expect([...names].sort()).toEqual(TAKEN_OVER);
  });
});
