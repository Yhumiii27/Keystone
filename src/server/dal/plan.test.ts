// Integration test of the Plan DAL (in-memory PGlite seeded from the prototype): getPlanData reproduces the
// prototype's ACTS for the 6 projects with data (and null otherwise); the writes persist the prototype's
// wbsOv / wbsRm / wbsOrd / added maps as real changes.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { isoOfDemoDate, splitActual } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import {
  deleteActivity, deleteWorkPackage, getPackageOrder, getPlanData, getPlanRequests, getPlanTodos, insertActivity, insertWorkPackage,
  ownerCodeOfName, renameWorkPackage, reorderActivities, updateActivity,
} from './plan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Proto = any;

describe('Plan DAL', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(Object.keys(PROTO_GEN.projectData))('%s reproduces the prototype ACTS', async (code) => {
    const pd = PROTO_GEN.projectData[code];
    const acts = pd.ACTS as Proto[];
    const d = (await getPlanData(code))!;
    expect(d).not.toBeNull();
    const r = acts[0];
    expect(d.root).toEqual({ code: r.w, name: r.n, start: r.s, finish: r.f, baselineFinish: r.bl, totalFloat: r.tf });
    expect(d.packages.map((p) => [p.code, p.name, p.added])).toEqual(acts.filter((a) => !a.id && a.lv === 1).map((a) => [a.w, a.n, false]));
    expect(
      d.activities.map((a) => [a.id, a.wbs, a.name, a.durationDays, a.start, a.startActual, a.finish, a.finishActual, a.startDate, a.baselineFinish, a.variance, a.constraint, a.violated, a.totalFloat, a.pct, a.owner, a.budget, a.actual, a.eac, a.preds, a.isAdded, a.edited]),
    ).toEqual(
      acts.filter((a) => a.id).map((a) => {
        const s = splitActual(a.s);
        const f = splitActual(a.f);
        return [a.id, a.w, a.n, a.d, s.text, s.actual, f.text, f.actual, isoOfDemoDate(s.text), a.bl, a.v, a.c, !!a.viol, a.tf, a.pc, a.o, a.b[0], a.b[1], a.b[2], a.p, false, false];
      }),
    );
    // Delivery 7 (R-073, C-2a): % complete = budget-weighted progress of the prototype's own activities (Σ b × pc / Σ b), no longer
    // the seeded `pct` (HLT-026 64 → 63, NDC-031 51 → 46, RCF-019 82 → 77, ERP-202 45 → 52, WSA-044 27 → 8, MSR-012 91 → 92).
    const own = acts.filter((a) => a.id);
    const pct = Math.round((own.reduce((t: number, a: Proto) => t + a.b[0] * a.pc, 0) / own.reduce((t: number, a: Proto) => t + a.b[0], 0)));
    expect(d.control).toMatchObject({ pct, floatDays: pd.floatDays, floatShort: pd.floatShort, finishText: pd.finishText, baselineText: pd.baselineText, baselineSet: pd.baselineSet, p3: pd.p3 });
    expect(d.projectIdx).toBe(PROTO.DEFS[code].idx);
    // R-041 (P-2): Harbor Line's named team adds the seeded referents to DEFS.team.
    expect(d.control.team).toEqual(code === 'HLT-026' ? [...PROTO.DEFS[code].team, 'Antoine Girard', 'Gabriel Comte'] : PROTO.DEFS[code].team);
  });

  it('owners are the 9 OWN people in prototype order', async () => {
    const d = (await getPlanData('HLT-026'))!;
    expect(Object.fromEntries(d.owners.map((o) => [o.code, [o.name, o.title]]))).toEqual(PROTO.OWN);
    expect(d.owners.map((o) => o.code)).toEqual(Object.keys(PROTO.OWN));
  });

  it('projects without planning data → null (never another project’s data)', async () => {
    expect(await getPlanData('ALP-021')).toBeNull();
    expect(await getPlanData('NOPE-000')).toBeNull();
  });

  it('to-dos and resource requests of the project (tasks and requests DALs)', async () => {
    expect((await getPlanTodos('HLT-026')).filter((x) => x.act === 'A1250').map((x) => x.id)).toEqual(['T-2314', 'T-2318', 'T-2305', 'T-2320', 'T-2325']);
    expect((await getPlanRequests('HLT-026')).filter((x) => x.act === 'A1250' && x.status === 'pending').map((x) => x.id)).toEqual(['RQ-043', 'RQ-042', 'RQ-041']);
    expect(await getPlanTodos('EWA-051')).toEqual([]);
  });

  it('inline edits: structure edits set the edited mark, progress alone does not', async () => {
    expect(await updateActivity('HLT-026', 'A1260', { pct: 20 })).toBe(true);
    let a = (await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1260')!;
    expect([a.pct, a.edited]).toEqual([20, false]);
    expect(await updateActivity('HLT-026', 'A1260', { name: 'Roof decking & cladding', ownerCode: 'AO', durationDays: 30, budget: 120, eac: 120 })).toBe(true);
    a = (await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1260')!;
    expect([a.name, a.owner, a.ownerName, a.durationDays, a.budget, a.eac, a.edited]).toEqual(['Roof decking & cladding', 'AO', 'Amélie Ollivier', 30, 120, 120, true]);
    expect(await updateActivity('HLT-026', 'A9999', { pct: 10 })).toBe(false);
    expect(await updateActivity('HLT-026', 'A1260', { ownerCode: 'ZZ' })).toBe(false);
  });

  it('logic links are replaced in order', async () => {
    expect(await updateActivity('HLT-026', 'A1260', { preds: [['A1250', 'FS', -5], ['A1240', 'SS', 3]] })).toBe(true);
    const d = (await getPlanData('HLT-026'))!;
    expect(d.activities.find((x) => x.id === 'A1260')!.preds).toEqual([['A1250', 'FS', -5], ['A1240', 'SS', 3]]);
    await updateActivity('HLT-026', 'A1260', { preds: [] });
    expect((await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1260')!.preds).toEqual([]);
  });

  it('re-orders activities within a work package', async () => {
    const o = (await getPackageOrder('HLT-026', 'A1250'))!;
    expect(o).toEqual({ wbs: '1.4', ids: ['A1230', 'A1240', 'A1250', 'A1260'] });
    expect(await reorderActivities('HLT-026', '1.4', ['A1230', 'A1250', 'A1240', 'A1260'])).toBe(true);
    const d = (await getPlanData('HLT-026'))!;
    expect(d.activities.filter((a) => a.wbs === '1.4').map((a) => a.id)).toEqual(['A1230', 'A1250', 'A1240', 'A1260']);
    // Other packages keep their place around it.
    expect(d.activities.map((a) => a.wbs)).toEqual([...d.activities.map((a) => a.wbs)].sort());
    expect(await reorderActivities('HLT-026', '1.4', ['A1230', 'A1250'])).toBe(false);
  });

  it('adds an activity at the end of its work package, and a work package after the others', async () => {
    expect(await ownerCodeOfName('Julien Wagner')).toBe('JW');
    expect(await ownerCodeOfName('Nobody')).toBeNull();
    expect(
      await insertActivity('HLT-026', {
        id: 'A1901', wbs: '1.1', name: 'As-built survey', durationDays: 18, ownerCode: 'JW', start: '05 Oct', startDate: '2026-10-05',
        finish: '30 Oct', finishDate: '2026-10-30', budget: 40, totalFloat: 10, critical: false, description: 'Survey',
      }),
    ).toBe(true);
    expect(await insertWorkPackage('HLT-026', { code: '1.9', name: 'Training', ownerName: 'Hélène Sauvage', scope: 'Operator training' })).toBe(true);
    const d = (await getPlanData('HLT-026'))!;
    const kids = d.activities.filter((a) => a.wbs === '1.1');
    expect(kids.map((a) => a.id)).toEqual(['A1010', 'A1020', 'A1901']);
    expect(kids[2]).toMatchObject({ isAdded: true, edited: false, baselineFinish: '30 Oct', variance: 0, pct: 0, budget: 40, actual: 0, eac: 40, totalFloat: 10, owner: 'JW', description: 'Survey', critical: false });
    expect(d.packages.at(-1)).toMatchObject({ code: '1.9', name: 'Training', added: true, ownerName: 'Hélène Sauvage', scope: 'Operator training' });
    expect(d.packages.slice(0, -1).every((p) => !p.added)).toBe(true);
    expect(await insertActivity('HLT-026', { id: 'A1902', wbs: '1.9', name: 'Operator course', durationDays: 5, ownerCode: 'HS', start: '2 Nov', startDate: null, finish: '6 Nov', finishDate: null, budget: 12, totalFloat: -27, critical: true, description: '' })).toBe(true);
    const d2 = (await getPlanData('HLT-026'))!;
    expect(d2.activities.at(-1)).toMatchObject({ id: 'A1902', wbs: '1.9', critical: true, totalFloat: -27 });
    expect(await renameWorkPackage('HLT-026', '1.9', 'Training & handover')).toBe(true);
    expect(await renameWorkPackage('HLT-026', '1', 'Root')).toBe(false);
    expect((await getPlanData('HLT-026'))!.packages.at(-1)!.name).toBe('Training & handover');
  });

  it('removes an activity (links go with it) and a work package with its activities', async () => {
    expect(await deleteActivity('HLT-026', 'A1250')).toBe(true);
    let d = (await getPlanData('HLT-026'))!;
    expect(d.activities.some((a) => a.id === 'A1250')).toBe(false);
    expect(d.activities.find((a) => a.id === 'A1320')!.preds).toEqual([['A1310', 'FS', 0]]);
    expect(await deleteWorkPackage('HLT-026', '1.5')).toBe(true);
    d = (await getPlanData('HLT-026'))!;
    expect(d.packages.some((p) => p.code === '1.5')).toBe(false);
    expect(d.activities.some((a) => a.wbs === '1.5')).toBe(false);
    expect(await deleteWorkPackage('HLT-026', '1')).toBe(false);
    expect(await deleteActivity('HLT-026', 'A1250')).toBe(false);
    // Other projects are untouched.
    expect((await getPlanData('NDC-031'))!.activities.length).toBe((PROTO_GEN.projectData['NDC-031'].ACTS as Proto[]).filter((a) => a.id).length);
  });
});
