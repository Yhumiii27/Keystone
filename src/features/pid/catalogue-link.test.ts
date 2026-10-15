// R-108 (E-6 = a): the tag drawer links a tag to any catalogue article and, on request, adds it to the project BOM in the same
// transaction. Server Functions on the seeded in-memory database with the real project context: the 8 personas, a project
// read-only for the viewer, malformed input (flag, quantity), an unknown reference, client equipment, a duplicate BOM line, a
// BOM line at quantity 0, a tag whose activity is not in the plan, the overlay scope, "Link only" then "add to the BOM", the
// writer's own re-check of the BOM right, and the audit / activity / revalidation.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'englead' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { parts, pidTags, projectBomLines, projects } from '@/server/db/schema';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getProjectBom } from '@/server/dal/bom';
import { listParts } from '@/server/dal/parts';
import { getPidValidation, mapPidTag, pidCandidates } from '@/server/dal/pid';
import { mapPidTagAction } from './actions';

const HLT = 'HLT-026';
const tagRow = async (tag: string) => (await getPidValidation(HLT))!.tags.find((t) => t.tag === tag)!;
const bomLine = async (ref: string) => (await getProjectBom(HLT))!.lines.find((l) => l.ref === ref) ?? null;
/** A validated catalogue article outside HLT-026's BOM (and not in `skip`), found by searching it as the drawer does. */
const outsideBom = async (tag: string, skip: string[] = []) => {
  const bom = new Set((await getProjectBom(HLT))!.lines.filter((l) => l.quantity > 0).map((l) => l.ref));
  const ref = (await listParts()).find((x) => x.status === 'validated' && !bom.has(x.ref) && !skip.includes(x.ref))!.ref;
  expect((await pidCandidates(HLT, tag, { q: ref, type: 'all' })).rows).toMatchObject([{ ref, inBom: false }]);
  return ref;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'englead';
  session.lang = 'en';
  vi.mocked(revalidatePath).mockClear();
});

describe('R-108 link a tag to any catalogue article', () => {
  it('candidates: the whole catalogue, BOM articles first; the search is case-insensitive and the type filter widens it', async () => {
    const def = await pidCandidates(HLT, 'TT-102');
    expect(def.rows.length).toBe(20);
    expect(def.more).toBe(true);
    const firstOut = def.rows.findIndex((r) => !r.inBom);
    expect(firstOut).toBeGreaterThan(0);
    expect(def.rows.slice(firstOut).every((r) => !r.inBom)).toBe(true);
    expect((await pidCandidates(HLT, 'TT-102', { q: 'ks-stl' })).rows).toEqual([]);
    expect((await pidCandidates(HLT, 'TT-102', { q: 'ks-stl', type: 'all' })).rows.map((r) => r.ref)).toContain('KS-STL-0450');
    expect(await pidCandidates(HLT, 'NOPE-1')).toEqual({ rows: [], more: false });
  });

  it('every persona: the P&ID editors link and add to the BOM; the others are refused, nothing written', async () => {
    const ref = await outsideBom('PT-201');
    const outcome: Record<string, string> = {};
    for (const role of ['pm', 'depthead', 'member', 'procurement', 'client', 'quality']) {
      session.role = role;
      try {
        const r = await mapPidTagAction(HLT, 'PT-201', ref, { addToBom: true, quantity: '2' });
        outcome[role] = r.toast ?? r.error ?? '';
      } catch (e) {
        outcome[role] = (e as Error).message;
      }
    }
    const read = 'This P&ID is read-only for you';
    expect(outcome).toEqual({ pm: read, depthead: read, member: read, procurement: read, client: 'REDIRECT /', quality: `Tag linked · PT-201 → ${ref} · added to the BOM × 2` });
    const t = await tagRow('PT-201');
    expect(t.partRef).toBe(ref);
    expect(t.status).not.toBe('not_in_bom');
    const line = (await bomLine(ref))!;
    expect([line.quantity, line.scope]).toEqual([2, t.scope]);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/reference/parts');
    const audit = await listAudit({ projectCode: HLT, limit: 3 });
    expect(audit.map((a) => [a.who, a.object, a.area])).toEqual([
      ['Gabriel Comte', 'HLT-026 BOM', 'BOM'], ['Gabriel Comte', 'HLT-026 BOM', 'BOM'], ['Gabriel Comte', 'PT-201', 'P&ID'],
    ]);
    expect(audit[0].change).toBe(`${ref} × 2 added from P&ID tag PT-201`);
    expect(audit[2].change).toBe(`mapped to ${ref}`);
    expect((await listActivity({ kind: 'change', limit: 1 }))[0]).toMatchObject({ who: 'Gabriel Comte', what: `Added ${ref} × 2 to the BOM from P&ID tag PT-201` });
    // FR toast.
    session.role = 'englead';
    session.lang = 'fr';
    const ref2 = await outsideBom('TT-102', [ref]);
    expect(await mapPidTagAction(HLT, 'TT-102', ref2, { addToBom: true })).toEqual({ toast: `Tag lié · TT-102 → ${ref2} · ajouté à la nomenclature × 1` });
  });

  it('"Link only" leaves the tag Not in BOM; adding it later links nothing new and adds the BOM line', async () => {
    const ref = await outsideBom('LT-101', (await getProjectBom(HLT))!.lines.map((l) => l.ref));
    expect(await mapPidTagAction(HLT, 'LT-101', ref)).toEqual({ toast: `Tag linked · LT-101 → ${ref}` });
    expect((await tagRow('LT-101')).status).toBe('not_in_bom');
    expect(await bomLine(ref)).toBeNull();
    const before = (await listAudit({ projectCode: HLT, limit: 50 })).filter((a) => a.object === 'LT-101').length;
    expect((await mapPidTagAction(HLT, 'LT-101', ref, { addToBom: true, quantity: 1 })).toast).toMatch(/added to the BOM × 1$/);
    expect((await tagRow('LT-101')).status).not.toBe('not_in_bom');
    expect((await listAudit({ projectCode: HLT, limit: 50 })).filter((a) => a.object === 'LT-101').length).toBe(before); // no second "mapped" row
  });

  it('refuses a duplicate BOM line, a BOM line at quantity 0 (clear message), malformed flags and quantities; nothing written', async () => {
    const inBom = (await pidCandidates(HLT, 'FT-110', { type: 'all' })).rows.find((c) => c.inBom)!.ref;
    expect(await mapPidTagAction(HLT, 'FT-110', inBom, { addToBom: true })).toEqual({ error: `${inBom} is already in the project BOM` });
    session.lang = 'fr';
    expect(await mapPidTagAction(HLT, 'FT-110', inBom, { addToBom: true })).toEqual({ error: `${inBom} est déjà dans la nomenclature du projet` });
    session.lang = 'en';
    expect((await tagRow('FT-110')).partRef).not.toBe(inBom); // the transaction rolled back: not linked either
    // A BOM line at quantity 0 (table import) reads "Not in BOM": the message says how to fix it.
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
    const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, inBom));
    await db.update(projectBomLines).set({ quantity: 0 }).where(and(eq(projectBomLines.projectId, p.id), eq(projectBomLines.partId, part.id)));
    expect(await mapPidTagAction(HLT, 'FT-110', inBom, { addToBom: true })).toEqual({ error: `${inBom} is in the project BOM with quantity 0 — change its quantity on the BOM screen` });
    for (const quantity of ['0', '-2', 'abc', '2000000'])
      expect(await mapPidTagAction(HLT, 'FT-110', inBom, { addToBom: true, quantity }), quantity).toEqual({ error: 'Enter a quantity greater than 0' });
    expect(await mapPidTagAction(HLT, 'FT-110', inBom, { addToBom: 'yes' })).toEqual({ error: 'Invalid request' });
    expect(await mapPidTagAction(HLT, 'FT-110', 'NOPE-999', { addToBom: true })).toEqual({ error: 'NOPE-999 is not in the catalogue' });
    expect(await mapPidTagAction(HLT, 'T-101', inBom, { addToBom: true })).toEqual({ error: 'Client-supplied equipment: no BOM reference expected' });
  });

  it('a tag whose activity is not in the plan gets a BOM line without activity; an overlay tag gives an overlay line', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
    const overlay = (await getPidValidation(HLT))!.tags.find((t) => t.scope === 'overlay' && !t.partRef) ?? (await getPidValidation(HLT))!.tags.find((t) => t.scope === 'overlay')!;
    await db.update(pidTags).set({ activityCode: 'Z9999' }).where(and(eq(pidTags.projectId, p.id), eq(pidTags.tag, overlay.tag)));
    const ref = await outsideBom(overlay.tag, (await getProjectBom(HLT))!.lines.map((l) => l.ref));
    expect((await mapPidTagAction(HLT, overlay.tag, ref, { addToBom: true })).toast).toMatch(/added to the BOM × 1$/);
    const line = (await bomLine(ref))!;
    expect([line.scope, line.activityCode ?? null]).toEqual(['overlay', null]);
  });

  it('the writer re-checks the BOM right and the P&ID workspace with the actor', async () => {
    const ref = await outsideBom('XV-111', (await getProjectBom(HLT))!.lines.map((l) => l.ref));
    await expect(mapPidTag(HLT, 'XV-111', ref, { name: 'Nobody Known', role: 'englead' }, { quantity: 1 })).rejects.toThrow('This project BOM is read-only for you');
    await expect(mapPidTag(HLT, 'XV-111', ref, { name: 'Romain Aubert', role: 'pm' }, { quantity: 1 })).rejects.toThrow(/outside your workspace/);
    expect(await bomLine(ref)).toBeNull();
    // A project read-only for the viewer (not on its team): the P&ID is read-only.
    expect(await mapPidTagAction('NDC-031', 'TT-102', ref, { addToBom: true })).toEqual({ error: 'This P&ID is read-only for you' });
  });
});
