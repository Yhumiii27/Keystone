// R-172 (TODO(db) closed): the Plan names an activity's owner even when they are not in the OWN directory — the wizard's
// default PM "S. Perrin" (no owner_code, no full name: the plan showed "SP"), a PM with a full name but no owner_code — in
// the plan rows, the drawer's Owner line and the plan export; the Owner select shows that owner first, and '—' for an
// activity without owner. Own in-memory database (wizard projects change counts other files rely on); HLT-026 unchanged.
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, persons, projects } from '@/server/db/schema';
import { getPlanData, getPlanTodos, type PlanData } from '@/server/dal/plan';
import { createWizardProject } from '@/server/dal/projects-register';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';
import { activityDrawerView } from './drawer-model';
import { planOwnerNames, planRowViews, planRows } from './model';
import { CURRENT_OWNER, ownerSelectOptions } from './owner-select';

const EN = makeT('en');
const wizard = (name: string, pmPersonId?: string) =>
  createWizardProject({
    name, client: 'Transit BU', das: '3', machineType: 'SPUR', currency: 'EUR', templateCode: 'SPUR', categories: [], contingencyPct: 5, calendar: 'standard_5x8',
    pmPersonId, actorName: 'Marie Lefebvre',
  });

const rowsOf = async (code: string, data: PlanData) => planRowViews(planRows(data, await getPlanTodos(code)), data, EN, 'en');
const drawerOwner = (data: PlanData, id: string) => {
  const act = data.activities.find((a) => a.id === id)!;
  const v = activityDrawerView(
    { act, activities: data.activities, packages: data.packages, owners: data.owners, ownerName: act.ownerName, assignments: [], todos: [], requests: [], deptHeads: {}, taskHref: () => '' },
    EN,
    'en',
  );
  return v.general.find((g) => g.k === 'Owner')!.v;
};
const exportOwners = async (code: string) => {
  const ctx = await buildExportContext({ screen: 'plan', viewer: PERSONA_BY_ROLE.director, lang: 'en', params: new URLSearchParams(`code=${code}`), now: new Date('2026-10-09T08:00:00Z') });
  const [wbs] = await readXlsx((await runExport(ctx, 'xlsx')).body);
  const level = wbs.rows[0].indexOf('Level');
  const owner = wbs.rows[0].indexOf('Owner');
  return wbs.rows.slice(1).filter((r) => r[level] === 'Activity').map((r) => r[owner]);
};
const ownOptions = (data: PlanData) => data.owners.map((o) => ({ value: o.code, label: o.name }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-172 — plan owner names', () => {
  it('wizard project with the default PM S. Perrin (no owner_code, no full name): "S. Perrin" in rows, drawer and export', async () => {
    const created = await wizard('Owner names — default PM');
    const data = (await getPlanData(created.code))!;
    expect(data.activities.length).toBeGreaterThan(0);
    for (const a of data.activities) expect([a.owner, a.ownerName, a.ownerIsCode]).toEqual(['SP', 'S. Perrin', false]);
    const acts = (await rowsOf(created.code, data)).filter((r) => r.kind === 'act');
    expect(acts.map((r) => [r.ownerName, r.ownerIsCode])).toEqual(acts.map(() => ['S. Perrin', false])); // was "SP"
    expect(drawerOwner(data, data.activities[0].id)).toBe('S. Perrin'); // was "SP"
    expect(await exportOwners(created.code)).toEqual(data.activities.map(() => 'S. Perrin')); // was "SP"
    // The Owner select shows S. Perrin first (never saved), then the OWN directory.
    const sel = ownerSelectOptions(acts[0], ownOptions(data));
    expect(sel.value).toBe(CURRENT_OWNER);
    expect(sel.options[0]).toEqual({ value: CURRENT_OWNER, label: 'S. Perrin' });
    expect(sel.options.slice(1)).toEqual(ownOptions(data));
  });

  it('a PM with a full name but no owner_code: their full name everywhere', async () => {
    const db = await getDb();
    const [pm] = await db
      .select({ id: persons.id, full: persons.fullName, initials: persons.initials })
      .from(persons)
      .where(and(isNull(persons.ownerCode), isNotNull(persons.fullName), isNull(persons.clientId)))
      .limit(1);
    const created = await wizard('Owner names — named PM', pm.id);
    const data = (await getPlanData(created.code))!;
    expect(data.activities.every((a) => a.ownerName === pm.full && a.owner === pm.initials && !a.ownerIsCode)).toBe(true);
    const acts = (await rowsOf(created.code, data)).filter((r) => r.kind === 'act');
    expect(new Set(acts.map((r) => r.ownerName))).toEqual(new Set([pm.full]));
    expect(drawerOwner(data, data.activities[0].id)).toBe(pm.full);
    expect(new Set(await exportOwners(created.code))).toEqual(new Set([pm.full]));
  });

  it('an activity without owner: "—" on the row and in the drawer, "—" first in the select; the export cell stays empty', async () => {
    const created = await wizard('Owner names — no owner');
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, created.code));
    await db.update(activities).set({ ownerPersonId: null }).where(eq(activities.projectId, p.id));
    const data = (await getPlanData(created.code))!;
    const acts = (await rowsOf(created.code, data)).filter((r) => r.kind === 'act');
    expect(acts.every((r) => r.owner === null && r.ownerName === '—' && !r.ownerIsCode)).toBe(true);
    expect(drawerOwner(data, data.activities[0].id)).toBe('—');
    expect(ownerSelectOptions(acts[0], ownOptions(data)).options[0]).toEqual({ value: CURRENT_OWNER, label: '—' });
    expect(new Set(await exportOwners(created.code))).toEqual(new Set([null])); // empty cell, as before
  });

  it('HLT-026 unchanged: OWN keys, the directory names, the select on the owner key', async () => {
    const data = (await getPlanData('HLT-026'))!;
    const a1250 = data.activities.find((a) => a.id === 'A1250')!;
    expect([a1250.owner, a1250.ownerName, a1250.ownerIsCode]).toEqual(['JW', 'Julien Wagner', true]);
    const names = planOwnerNames(data);
    const own = new Map(data.owners.map((o) => [o.code, o.name]));
    for (const a of data.activities) expect(names(a)).toBe(a.owner ? own.get(a.owner) : '—');
    const row = (await rowsOf('HLT-026', data)).find((r) => r.id === 'A1250')!;
    expect(ownerSelectOptions(row, ownOptions(data))).toEqual({ value: 'JW', options: ownOptions(data) });
    expect(drawerOwner(data, 'A1250')).toBe('Julien Wagner');
  });
});
