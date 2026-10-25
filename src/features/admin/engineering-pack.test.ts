// R-191 (Arche K-08): the engineering pack against an in-memory demo database — the provisional standard list seeded on every
// machine type, the mapping of Codex's document types, the demo values (HLT-026 40 %, NDC-031 20 %), the view pub_pack_ingenierie
// (exactly the K-08 columns in order and with their types, the same numbers as the DAL's card on every project, maj_le moving),
// the Server Function of the Machine types screen (rights of the type editor, weights totalling 100 %, audit trail, revalidation,
// applied at once to the projects of the type), a new machine type copying its template's list, the multi-equipment union
// (R-185) and the card of the Engineering synthesis in English and French. The session is mocked; the access rule is the real one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/machine-types', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { and, asc, eq, sql } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { PACK_FAMILIES, PROVISIONAL_PACK } from '@/domain/engineering-pack';
import { EngineeringPackCard, packCardView } from '@/features/eng/pack-card';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, documentTypes, documents, machineTypePackFamilies, machineTypes, projectEquipments, projects } from '@/server/db/schema';
import { PACK_VIEW_TYPES, SHARE_VIEW_COLUMNS } from '@/server/db/share-contracts';
import { getEngineeringPack } from '@/server/dal/engineering-pack';
import { getMachineType } from '@/server/dal/mtypes';
import { createMachineTypeAction, setMachineTypePackAction } from './actions';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};
type ViewRow = { projet_code: string; famille: string; attendues: number; validees: number; poids: string; pct_pondere: string; maj_le: unknown };
const view = async (code?: string) =>
  ((await (await getDb()).execute(sql`select * from pub_pack_ingenierie ${code ? sql`where projet_code = ${code}` : sql``} order by projet_code, famille`)).rows as ViewRow[]);
const pctOf = async (code: string) => [...new Set((await view(code)).map((r) => Number(r.pct_pondere)))];
const typed = (weights: (number | string)[], mins: (number | string)[] = [1, 1, 1, 1, 1]) =>
  PACK_FAMILIES.map((family, i) => ({ family, weight: weights[i], minExpected: mins[i] }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  vi.mocked(revalidatePath).mockClear();
});

describe('seeded reference data', () => {
  it('every machine type carries the provisional list (5 families × 20 %, one document); five document types are mapped', async () => {
    const db = await getDb();
    const types = await db.select({ code: machineTypes.code }).from(machineTypes);
    for (const { code } of types) expect((await getMachineType(code))!.pack, code).toEqual(PROVISIONAL_PACK);
    const mapped = await db.select({ code: documentTypes.code, family: documentTypes.packFamily }).from(documentTypes)
      .where(sql`${documentTypes.packFamily} is not null`).orderBy(asc(documentTypes.code));
    expect(mapped).toEqual([
      { code: 'BOM', family: 'bom' }, { code: 'FDS', family: 'analyse_fonctionnelle' }, { code: 'GA', family: 'layout' }, { code: 'PID', family: 'pid' },
      { code: 'SCH', family: 'electrique' },
    ]);
  });
});

describe('pub_pack_ingenierie (K-08) and the DAL', () => {
  it('has exactly the K-08 columns, in order and with their types', async () => {
    const cols = (await (await getDb()).execute(sql`select column_name as c, data_type as t from information_schema.columns
      where table_schema = current_schema() and table_name = 'pub_pack_ingenierie' order by ordinal_position`)).rows as { c: string; t: string }[];
    expect(cols.map((r) => r.c)).toEqual(SHARE_VIEW_COLUMNS.pub_pack_ingenierie);
    expect(Object.fromEntries(cols.map((r) => [r.c, r.t]))).toEqual(PACK_VIEW_TYPES);
    expect(Object.keys(PACK_VIEW_TYPES)).toEqual(SHARE_VIEW_COLUMNS.pub_pack_ingenierie);
  });

  it('HLT-026: P&ID and GA released, BOMs, schematics and FDS not yet → 40 %; NDC-031: its P&ID only → 20 %', async () => {
    expect((await view('HLT-026')).map((r) => [r.famille, r.attendues, r.validees, Number(r.poids)])).toEqual([
      ['analyse_fonctionnelle', 1, 0, 20], ['bom', 2, 0, 20], ['electrique', 1, 0, 20], ['layout', 1, 1, 20], ['pid', 1, 1, 20],
    ]);
    expect(await pctOf('HLT-026')).toEqual([40]);
    expect((await view('NDC-031')).map((r) => [r.famille, r.attendues, r.validees])).toEqual([
      ['analyse_fonctionnelle', 1, 0], ['bom', 1, 0], ['electrique', 1, 0], ['layout', 1, 0], ['pid', 1, 1],
    ]);
    expect(await pctOf('NDC-031')).toEqual([20]);
    const pack = (await getEngineeringPack('HLT-026'))!;
    expect([pack.pct, pack.meetsTarget, pack.types]).toEqual([40, false, ['EMP', 'MEMU']]);
    expect(pack.documents.bom.map((d) => [d.number, d.status])).toEqual([['BOM-MEC-026', 'frozen'], ['BOM-ELE-026', 'draft']]);
  });

  it('the view and the DAL agree on every project with a machine type; a project without one has no row', async () => {
    const db = await getDb();
    const all = await db.select({ code: projects.code, mt: projects.machineTypeCode }).from(projects);
    const rows = await view();
    for (const p of all) {
      const pack = await getEngineeringPack(p.code);
      const mine = rows.filter((r) => r.projet_code === p.code);
      if (!pack) {
        expect(mine, p.code).toEqual([]);
        continue;
      }
      expect(mine.map((r) => [r.famille, r.attendues, r.validees, Number(r.poids), Number(r.pct_pondere)]).sort(), p.code)
        .toEqual(pack.families.map((f) => [f.family, f.expected, f.validated, f.weight, pack.pct]).sort());
      expect(mine.every((r) => r.maj_le != null)).toBe(true);
    }
    expect(all.some((p) => !p.mt)).toBe(true);
  });

  it('a document released moves the family, the % and maj_le', async () => {
    const db = await getDb();
    const before = (await view('HLT-026'))[0].maj_le as Date;
    await db.update(documents).set({ status: 'released', updatedAt: new Date(Date.now() + 60_000) }).where(eq(documents.number, 'FDS-HLT-026'));
    const after = await view('HLT-026');
    expect(after.find((r) => r.famille === 'analyse_fonctionnelle')!.validees).toBe(1);
    expect(await pctOf('HLT-026')).toEqual([60]);
    expect(new Date(after[0].maj_le as Date).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect((await getEngineeringPack('HLT-026'))!.pct).toBe(60);
    await db.update(documents).set({ status: 'frozen' }).where(eq(documents.number, 'FDS-HLT-026'));
  });
});

describe('setMachineTypePackAction (Machine types screen)', () => {
  it('outside the workspace: refused; the PM and the engineering lead edit (the type editor’s rights)', async () => {
    for (const role of ['finance', 'procurement', 'member'] as RoleKey[]) {
      as(role);
      expect(await setMachineTypePackAction('EMP', typed([20, 20, 20, 20, 20])), role).toEqual({ error: 'Machine types are read-only for you' });
    }
    as('englead');
    expect(await setMachineTypePackAction('EMP', typed([20, 20, 20, 20, 20]))).toEqual({ ok: true, toast: 'Engineering pack saved' });
  });

  it('weights must total 100 % (translated refusal); whole numbers only; unknown type or family refused', async () => {
    expect(await setMachineTypePackAction('EMP', typed([30, 30, 30, 30, 30]))).toEqual({ error: 'The weights of the engineering pack must total 100 %' });
    as('director', 'fr');
    expect(await setMachineTypePackAction('EMP', typed([30, 30, 30, 30, 30]))).toEqual({ error: 'Les poids du pack ingénierie doivent totaliser 100 %' });
    as('director');
    expect(await setMachineTypePackAction('EMP', typed(['20.5', 20, 20, 20, 19.5]))).toEqual({ error: 'Each family needs a whole weight from 0 to 100 % and a minimum from 0 to 99' });
    expect(await setMachineTypePackAction('NOPE', typed([20, 20, 20, 20, 20]))).toEqual({ error: 'Invalid request' });
    expect(await setMachineTypePackAction('EMP', [{ family: 'hmi', weight: 100, minExpected: 1 }])).toEqual({ error: 'Invalid request' });
    expect((await getMachineType('EMP'))!.pack).toEqual(PROVISIONAL_PACK);
  });

  it('saves, audits and revalidates; applies at once to the projects of the type (HLT-026: main type EMP)', async () => {
    const db = await getDb();
    // P&ID 40 %, layout 40 %, BOM 20 %, electrical and functional analysis out of EMP's pack (MEMU, the second line, still weighs them).
    expect(await setMachineTypePackAction('EMP', typed(['40', '20', '40', '0', '0'], ['1', '1', '1', '0', '0']))).toEqual({ ok: true, toast: 'Engineering pack saved' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect((await getMachineType('EMP'))!.pack.map((r) => [r.family, r.weight, r.minExpected])).toEqual([
      ['pid', 40, 1], ['bom', 20, 1], ['layout', 40, 1], ['electrique', 0, 0], ['analyse_fonctionnelle', 0, 0],
    ]);
    const [audit] = await db.select().from(auditEntries).where(and(eq(auditEntries.entityType, 'machine_type'), eq(auditEntries.objectRef, 'Machine type EMP')))
      .orderBy(sql`${auditEntries.occurredAt} desc`).limit(1);
    expect(audit.change).toBe('Machine type EMP · engineering pack: pid 40 % · min 1 · bom 20 % · min 1 · layout 40 % · min 1 · electrique 0 % · min 0 · analyse_fonctionnelle 0 % · min 0');
    // HLT-026 (EMP + 3 × MEMU): EMP's weights first; electrique and analyse_fonctionnelle from MEMU (20 % each), re-normalised over 140.
    expect((await view('HLT-026')).map((r) => [r.famille, Number(r.poids)])).toEqual([
      ['analyse_fonctionnelle', 20], ['bom', 20], ['electrique', 20], ['layout', 40], ['pid', 40],
    ]);
    expect(await pctOf('HLT-026')).toEqual([57.1]);
    expect((await getEngineeringPack('HLT-026'))!.pct).toBe(57.1);
    // A second save of the same list writes nothing.
    const n = (await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'Machine type EMP'))).length;
    expect(await setMachineTypePackAction('EMP', typed([40, 20, 40, 0, 0], [1, 1, 1, 0, 0]))).toMatchObject({ ok: true });
    expect((await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'Machine type EMP'))).length).toBe(n);
    // Back to the provisional list.
    expect(await setMachineTypePackAction('EMP', typed([20, 20, 20, 20, 20]))).toMatchObject({ ok: true });
    expect(await pctOf('HLT-026')).toEqual([40]);
  });

  it('a new machine type copies its template’s list; a blank one takes the provisional list', async () => {
    expect(await setMachineTypePackAction('SPUR', typed([25, 25, 25, 25, 0]))).toMatchObject({ ok: true });
    expect(await createMachineTypeAction({ code: 'RAIL-X', label: 'Rail', base: 'SPUR', cal: 'standard_5x8', desc: '' })).toMatchObject({ ok: true });
    expect((await getMachineType('RAIL-X'))!.pack.map((r) => r.weight)).toEqual([25, 25, 25, 25, 0]);
    expect(await createMachineTypeAction({ code: 'BLANK-X', label: 'Blank', base: 'blank', cal: 'standard_5x8', desc: '' })).toMatchObject({ ok: true });
    expect((await getMachineType('BLANK-X'))!.pack).toEqual(PROVISIONAL_PACK);
    const db = await getDb();
    expect((await db.select().from(machineTypePackFamilies).where(eq(machineTypePackFamilies.machineTypeCode, 'BLANK-X'))).length).toBe(5);
  });
});

describe('multi-equipment and the card', () => {
  it('a family weighed only by a secondary line’s type counts (union, R-185)', async () => {
    const db = await getDb();
    const [ndc] = await db.select({ id: projects.id, mt: projects.machineTypeCode }).from(projects).where(eq(projects.code, 'NDC-031'));
    const lines = await db.select().from(projectEquipments).where(eq(projectEquipments.projectId, ndc.id));
    expect(lines.length).toBeGreaterThan(0);
    expect(await setMachineTypePackAction(ndc.mt!, typed([100, 0, 0, 0, 0]))).toMatchObject({ ok: true });
    expect((await view('NDC-031')).map((r) => r.famille)).toEqual(['pid']);
    expect(await pctOf('NDC-031')).toEqual([100]);
    await db.insert(projectEquipments).values({ projectId: ndc.id, ref: 'EQ-09', machineTypeCode: 'SPUR', quantity: 1, position: 9 });
    // SPUR (25 / 25 / 25 / 25 / 0 above) adds bom, layout and electrique at 25 % each: 100 / 175.
    expect((await view('NDC-031')).map((r) => [r.famille, Number(r.poids)])).toEqual([['bom', 25], ['electrique', 25], ['layout', 25], ['pid', 100]]);
    expect(await pctOf('NDC-031')).toEqual([57.1]);
    expect((await getEngineeringPack('NDC-031'))!.pct).toBe(57.1);
    await db.delete(projectEquipments).where(and(eq(projectEquipments.projectId, ndc.id), eq(projectEquipments.ref, 'EQ-09')));
    expect(await setMachineTypePackAction(ndc.mt!, typed([20, 20, 20, 20, 20]))).toMatchObject({ ok: true });
  });

  it('the card of the Engineering synthesis, in English and French', async () => {
    const pack = (await getEngineeringPack('HLT-026'))!;
    const en = packCardView(pack, makeT('en'), 'en');
    expect([en.pct, en.target, en.status.text, en.sub]).toEqual(['40 %', 'G2 target > 80 %', 'Below target', 'Standard list · EMP · MEMU · provisional']);
    expect(en.families.map((f) => [f.label, f.count, f.weight])).toEqual([
      ['P&ID', '1 / 1', '20 %'], ['Bill of materials', '0 / 2', '20 %'], ['Layout · machine plot plan', '1 / 1', '20 %'],
      ['Electrical schematics & power balance', '0 / 1', '20 %'], ['Functional analysis', '0 / 1', '20 %'],
    ]);
    expect(en.families[1].docs).toEqual(['BOM-MEC-026 rev D · Mechanical BOM · Frozen', 'BOM-ELE-026 rev B · Electrical BOM · Draft']);
    const fr = renderToStaticMarkup(h(EngineeringPackCard, { view: packCardView(pack, makeT('fr'), 'fr'), t: makeT('fr') }));
    for (const s of ['Pack ingénierie · part EPC2i', 'Cible G2 &gt; 80 %', 'Sous la cible', 'Nomenclature', 'Layout · plan de masse machine', 'Analyse fonctionnelle', 'Gelé']) {
      expect(fr).toContain(s);
    }
  });
});
