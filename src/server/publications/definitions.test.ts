// ING-29 (owner, 27 Nov 2026): the reference queries Matrix applies as keystone.pub_projets (+ confidentialite) and
// keystone.pub_equipes_projets, run on a migrated, seeded PGlite (demo data set: FTU-052 is the confidential R&D project).
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { SHARE_VIEW_COLUMNS } from '@/server/db/share-contracts';
import type { DB } from '@/server/db/types';
import { PUB_EQUIPES_PROJETS_COLUMNS, PUB_PROJETS_COLUMNS, pubEquipesProjetsDefinition, pubProjetsDefinition } from './definitions';

let db: DB;
type Row = Record<string, unknown>;
const run = async (q: string) => {
  const r = await db.execute(sql.raw(q));
  return { rows: r.rows as Row[], fields: (r as unknown as { fields: { name: string }[] }).fields.map((f) => f.name) };
};

beforeAll(async () => {
  db = await openDatabase();
  setDb(db);
}, 60_000);

describe('pub_projets + confidentialite (ING-29)', () => {
  it('keeps the published columns in order and adds confidentialite at the end', async () => {
    expect(PUB_PROJETS_COLUMNS.slice(0, -1)).toEqual(SHARE_VIEW_COLUMNS.pub_projets);
    const { rows, fields } = await run(pubProjetsDefinition());
    expect(fields).toEqual([...PUB_PROJETS_COLUMNS]);
    const conf = Object.fromEntries(rows.map((r) => [r.code, r.confidentialite]));
    expect(conf['FTU-052']).toBe('confidentiel');
    expect(conf['HLT-026']).toBe('normal');
    expect(new Set(Object.values(conf))).toEqual(new Set(['normal', 'confidentiel']));
  });

  it('the server form names every table in schema keystone', () => {
    const q = pubProjetsDefinition('keystone.');
    for (const m of q.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/g)) if (m[1] !== '') expect(m[1].startsWith('keystone.'), m[1]).toBe(true);
  });
});

describe('pub_equipes_projets (ING-29)', () => {
  it('columns in contract order; origins equipe | affectation | partie_prenante; no external contact', async () => {
    const { rows, fields } = await run(pubEquipesProjetsDefinition());
    expect(fields).toEqual([...PUB_EQUIPES_PROJETS_COLUMNS]);
    expect(new Set(rows.map((r) => r.origine))).toEqual(new Set(['equipe', 'affectation', 'partie_prenante']));
    const { rows: ext } = await run(`select coalesce(full_name, short_name) as n from persons where client_id is not null`);
    const externals = new Set(ext.map((r) => r.n));
    expect(rows.filter((r) => externals.has(r.personne_nom))).toEqual([]);
  });

  it('publishes the confidential project’s team (readers filter on membership)', async () => {
    const { rows } = await run(pubEquipesProjetsDefinition());
    const ftu = rows.filter((r) => r.projet_code === 'FTU-052');
    expect(ftu.map((r) => r.personne_nom).sort()).toEqual(expect.arrayContaining(['Antoine Girard', 'Marie Lefebvre']));
    expect(ftu.every((r) => r.origine === 'equipe')).toBe(true);
    expect(ftu.find((r) => r.personne_nom === 'Antoine Girard')?.role).toBe('referent');
  });

  it('the server form names every table in schema keystone', () => {
    const q = pubEquipesProjetsDefinition('keystone.');
    for (const m of q.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/g)) if (m[1] !== '') expect(m[1].startsWith('keystone.'), m[1]).toBe(true);
  });
});
