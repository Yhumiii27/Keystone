// R-117 (A-6 'a': one punch list per project — origin, category, party, NCR, one number) on the seeded in-memory database with
// the real session ("View as" cookie) and project context, for the 9 personas: "Add punch item" (origin, owner party, NCR —
// never the client's, P-10b), Start / Close on items of every origin (the Site's former read-only register included), the
// writers' own re-check of the team (R-041), malformed input and stale steps; the screen view (Origin filter, row anchors
// for R-128, NCR column hidden from the client) and the ITP export without NCR numbers for the client.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { punchOriginFilterOf } from '@/domain/itpcom';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPunchItem, advancePunchItem, getItpPlan, listPunchItems } from '@/server/dal/itp';
import { listAudit } from '@/server/dal/notifications';
import { teamOwnerOptions } from '@/server/dal/team';
import { buildExportContext, runExport } from '@/server/export/run';
import '@/server/export/providers';
import { readXlsx } from '@/server/export/xlsx';
import { COOKIE } from '@/server/session';
import { addPunchItemAction, advancePunchItemAction } from './actions';
import { localizeForm, punchFormDef } from './forms';
import { itpScreenView, punchAnchorId, punchListHref } from './model';

const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const HLT = 'HLT-026';
/** Workspace of Inspections & punch list and on HLT-026's named team (or the director; the client of its organisation). */
const EDITORS: RoleKey[] = ['director', 'pm', 'englead', 'quality', 'client'];
const READ_ONLY = 'This inspection plan is read-only for you';
const item = async (n: string, code = HLT) => (await listPunchItems(code)).find((p) => p.number === n);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => vi.mocked(revalidatePath).mockClear());

describe('R-117 · "Add punch item" on the single list, 9 personas', () => {
  it('editors add an item of either origin, numbered over the project (P-11…, R-158 lot B: the demo reception raised P-10); the others read; the client never records an NCR', async () => {
    const added: Record<string, string> = {};
    for (const role of ROLES) {
      as(role);
      const r = await addPunchItemAction(HLT, { item: `Item by ${role}`, origin: 'site', party: 'client', ncr: 'NCR-031', owner: '', cat: 'B', loc: 'Structure · Bay 1' });
      if (!EDITORS.includes(role)) {
        expect([role, r]).toEqual([role, { error: READ_ONLY }]);
        continue;
      }
      expect([role, r]).toEqual([role, { toast: 'Punch item added' }]);
      added[role] = (await listPunchItems(HLT)).at(-1)!.number;
    }
    expect(Object.values(added)).toEqual(['P-11', 'P-12', 'P-13', 'P-14', 'P-15']);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    const rows = await listPunchItems(HLT, 'site');
    expect(rows.filter((p) => p.description.startsWith('Item by')).map((p) => [p.description, p.origin, p.ownerParty, p.ownerName, p.owner, p.ncrNumber, p.category])).toEqual([
      ['Item by director', 'site', 'client', null, 'Client', 'NCR-031', 'B'], ['Item by pm', 'site', 'client', null, 'Client', 'NCR-031', 'B'],
      ['Item by englead', 'site', 'client', null, 'Client', 'NCR-031', 'B'], ['Item by quality', 'site', 'client', null, 'Client', 'NCR-031', 'B'],
      // P-10b: whatever the client's request says, no NCR number is recorded from the client.
      ['Item by client', 'site', 'client', null, 'Client', null, 'B'],
    ]);
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Nadia Bensaïd', 'P-15', 'punch item added · Site · B · Item by client']);
  });

  it('defaults: origin Inspection, party Keystone, the first TEAM owner; "—" leaves the party as owner', async () => {
    as('quality');
    expect(await addPunchItemAction(HLT, { item: 'Default origin' })).toEqual({ toast: 'Punch item added' });
    expect(await item('P-16')).toMatchObject({ origin: 'itp', ownerParty: 'keystone', ownerName: 'A. Ollivier', ncrNumber: null, category: 'A', status: 'open' });
    expect(await addPunchItemAction(HLT, { item: 'Party only', owner: '—', party: 'keystone' })).toEqual({ toast: 'Punch item added' });
    expect(await item('P-17')).toMatchObject({ ownerName: null, owner: 'Keystone' });
  });

  it('malformed input and unknown values are refused, translated; nothing is written', async () => {
    as('pm');
    const before = (await listPunchItems(HLT)).length;
    expect(await addPunchItemAction(HLT, { item: 'x', origin: 'vigie' })).toEqual({ error: 'Unknown origin' });
    expect(await addPunchItemAction(HLT, { item: 'x', party: 'supplier' })).toEqual({ error: 'Unknown owner party' });
    expect(await addPunchItemAction(HLT, { item: 'x', ncr: '<script>' })).toEqual({ error: 'Enter the NCR number as Vigie gives it, e.g. NCR-029' });
    expect(await addPunchItemAction(HLT, { item: 'x', owner: 'Nobody' })).toEqual({ error: 'Unknown owner' });
    expect(await addPunchItemAction(HLT, null as never)).toEqual({ error: 'Item is required' });
    expect(await addPunchItemAction('' as string, { item: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await addPunchItemAction(HLT, { item: 'x', origin: 42 } as never)).toMatchObject({ toast: 'Punch item added' }); // non-string entries dropped → default origin
    as('pm', 'fr');
    expect(await addPunchItemAction(HLT, { item: 'x', origin: 'vigie' })).toEqual({ error: 'Origine inconnue' });
    expect(await addPunchItemAction(HLT, { item: 'x', ncr: '!!' })).toEqual({ error: 'Saisissez le numéro de NCR donné par Vigie, par ex. NCR-029' });
    expect((await listPunchItems(HLT)).length).toBe(before + 1);
  });

  it('a PM off the project’s team reads it (R-041), and the writer refuses a direct call too', async () => {
    as('pm');
    expect(await addPunchItemAction('RCF-019', { item: 'x' })).toEqual({ error: READ_ONLY });
    await expect(addPunchItem('RCF-019', { description: 'x', category: 'C', source: 'site_walk' }, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(/read-only/);
    await expect(addPunchItem(HLT, { description: 'x', category: 'C', source: 'site_walk' }, { name: 'Somebody Else', role: 'client' })).rejects.toThrow(/read-only/);
    await expect(addPunchItem(HLT, { description: 'x', category: 'C', source: 'site_walk', origin: 'nope' as never }, { name: 'Marie Lefebvre', role: 'director' })).rejects.toThrow(/Invalid origin/);
    // A client's NCR is dropped by the writer as well.
    expect(await addPunchItem(HLT, { description: 'By the client', category: 'C', source: 'client_inspection', ncrNumber: 'NCR-099' }, { name: 'Nadia Bensaïd', role: 'client' })).toMatch(/^P-\d+$/);
    expect((await listPunchItems(HLT)).at(-1)!.ncrNumber).toBeNull();
  });
});

describe('R-117 · Start / Close on every origin, 9 personas', () => {
  it('editors step an item raised on site (the former read-only Site register); the others are refused; stale steps refused', async () => {
    for (const role of ROLES) {
      as(role);
      // A fresh Site item per persona (written by the director).
      const n = await addPunchItem(HLT, { description: `Step ${role}`, category: 'B', source: 'site_walk', origin: 'site' }, { name: 'Marie Lefebvre', role: 'director' });
      const r = await advancePunchItemAction(HLT, n, 'open');
      if (!EDITORS.includes(role)) {
        expect([role, r]).toEqual([role, { error: READ_ONLY }]);
        expect((await item(n))!.status).toBe('open');
        continue;
      }
      expect([role, r]).toEqual([role, { ok: true }]);
      expect([role, await advancePunchItemAction(HLT, n, 'open')]).toEqual([role, { error: 'This punch item has already moved on' }]);
      expect([role, await advancePunchItemAction(HLT, n, 'in_progress')]).toEqual([role, { ok: true }]);
      expect([role, await advancePunchItemAction(HLT, n, 'in_progress')]).toEqual([role, { error: 'This punch item is already closed' }]);
    }
    // The seed's Site item P-06 (NCR-029), by the PM.
    as('pm');
    expect(await advancePunchItemAction(HLT, 'P-06', 'open')).toEqual({ ok: true });
    expect((await item('P-06'))!.status).toBe('in_progress');
    expect(await advancePunchItemAction(HLT, 'P-99', 'open')).toEqual({ error: 'Unknown punch item' });
    expect(await advancePunchItemAction(HLT, 'P-06', 'Open')).toEqual({ error: 'Invalid request' });
    await expect(advancePunchItem('RCF-019', 'P-01', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(/read-only/);
  });
});

describe('R-117 · the screen and the export', () => {
  it('Origin filter (All / Inspection / Site), row anchors for the document relations, the NCR column for internal viewers only', async () => {
    const [plan, punch] = await Promise.all([getItpPlan(HLT), listPunchItems(HLT)]);
    const t = makeT('en');
    const all = itpScreenView({ code: HLT, view: 'punch', plan, punch, machineType: null, today: DEMO_TODAY_ISO }, t, 'en').punch!;
    expect(all.origins.map((o) => [o.value, o.label, o.href])).toEqual([
      ['all', 'All', '/projects/HLT-026/itp?view=punch'], ['itp', 'Inspection', '/projects/HLT-026/itp?view=punch&origin=itp'], ['site', 'Site', '/projects/HLT-026/itp?view=punch&origin=site'],
    ]);
    expect([all.origin, all.ncr, all.rows[0].anchor, punchAnchorId('P-01'), punchListHref(HLT, 'site')]).toEqual(['all', true, 'punch-P-01', 'punch-P-01', '/projects/HLT-026/itp?view=punch&origin=site']);
    expect(all.rows.find((r) => r.number === 'P-06')).toMatchObject({ origin: 'Site', siteOrigin: true, ncr: 'NCR-029', owner: 'Client' });
    const site = itpScreenView({ code: HLT, view: 'punch', plan, punch, origin: 'site', machineType: null, today: DEMO_TODAY_ISO }, t, 'en').punch!;
    expect(site.rows.every((r) => r.siteOrigin)).toBe(true);
    const client = itpScreenView({ code: HLT, view: 'punch', plan, punch, machineType: null, today: DEMO_TODAY_ISO, viewer: { canRecord: false, internal: false, name: 'Nadia Bensaïd' } }, t, 'en').punch!;
    expect([client.ncr, client.rows.every((r) => r.ncr === null)]).toEqual([false, true]);
    expect([punchOriginFilterOf('site'), punchOriginFilterOf('vigie'), punchOriginFilterOf(undefined)]).toEqual(['site', 'all', 'all']);
    // The form: the client's has no NCR field.
    const team = await teamOwnerOptions(HLT);
    expect(localizeForm(punchFormDef(team, { internal: false }), t, 'en').fields.map((f) => f.id)).toEqual(['item', 'loc', 'cat', 'src', 'owner', 'due', 'origin', 'party']);
    expect(localizeForm(punchFormDef(team), makeT('fr'), 'fr').fields.slice(6).map((f) => [f.label, f.placeholder ?? null])).toEqual([
      ['Origine', null], ['Partie responsable', null], ['NCR (Vigie)', 'ex. NCR-029'],
    ]);
  });

  it('the ITP export lists every origin with its origin; the client gets no NCR column (P-10b)', async () => {
    const sheetOf = async (role: RoleKey, query = '') => {
      const ctx = await buildExportContext({ screen: 'itp', viewer: PERSONA_BY_ROLE[role], lang: 'en', params: new URLSearchParams(`code=HLT-026&view=punch${query}`), now: new Date('2026-10-09T08:00:00Z') });
      return (await readXlsx((await runExport(ctx, 'xlsx')).body))[0];
    };
    const internal = await sheetOf('quality');
    // R-185 part 2: Harbor Line has two equipment lines — an Equipment column after the origin.
    expect(internal.rows[0]).toEqual(['Item', 'Description', 'Origin', 'Equipment', 'System / location', 'Category', 'Raised by', 'NCR', 'Owner', 'Due', 'Status']);
    expect(internal.rows.find((r) => r[0] === 'P-06')!.slice(0, 4)).toEqual(['P-06', 'Massif poste 7 — reprise implantation tiges', 'Site', 'Common']);
    expect(internal.rows.find((r) => r[0] === 'P-09')![3]).toBe('EQ-02');
    expect(internal.rows.find((r) => r[0] === 'P-06')![7]).toBe('NCR-029');
    const client = await sheetOf('client');
    expect(client.rows[0]).not.toContain('NCR');
    expect(client.rows.flat().join(' ')).not.toContain('NCR-031');
    expect((await sheetOf('quality', '&origin=itp')).rows.slice(1).every((r) => r[2] === 'Inspection')).toBe(true);
  });
});
