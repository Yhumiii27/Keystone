// Delivery 8 integration review fixes of the site sheet (R-118) and the site-team conflicts (R-119), on the seeded in-memory
// database with the real session ("View as" cookie) and project context:
// - a contractor crew is never typed with the name of a person Keystone knows (refused on add and edit, by the Server Function
//   and by the writer) — such a rotation had no person: wrong arbitrator, leave and other sites not matched;
// - "Add a rotation" offers the project team only; a line whose person left the team keeps them in its own "Edit" form;
// - "Client confirms" / "Confirm" carry the line's stamp: a line replaced at the same position, or edited, is refused (9 personas);
// - a Cursus note of any length gives a conflict key that can be arbitrated;
// - a cancelled, closed or warranty project's rotation is no longer a "same person on two sites" cause.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import SitePage from '@/app/(app)/projects/[code]/site/page';
import type { FormDef } from '@/components/app/form-def';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { CREW_IS_PERSON, PERSON_REQUIRED, SITE_LINE_CHANGED } from '@/domain/site-sheet';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addTeamMember, removeTeamMember } from '@/server/dal/project-team';
import { advancePrerequisite, confirmEquipment, getSite } from '@/server/dal/site';
import { addSiteLine, updateSiteLine } from '@/server/dal/site-sheet';
import { COOKIE } from '@/server/session';
import {
  addSiteLineAction, advancePrerequisiteAction, arbitrateConflictAction, confirmEquipmentAction, editSiteLineAction, removeSiteLineAction,
} from './actions';
import type { SiteView } from './model';

const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const HLT = 'HLT-026';
const PM = { name: 'Romain Aubert', role: 'pm' as const };
const STALE = 'This step is not available any more';
const rows = async (q: string) => (await (await getDb()).execute(sql.raw(q))).rows as Record<string, unknown>[];
const site = async (code = HLT) => (await getSite(code))!;
const errorOf = (r: unknown) => (r && typeof r === 'object' && 'error' in r ? (r as { error: string }).error : 'ok');
const personOptions = (f: FormDef | null | undefined) =>
  f!.fields.find((x) => x.id === 'person')!.options!.map((o) => (typeof o === 'string' ? o : o.value));

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
async function pageView(code: string, sp: Record<string, string> = {}): Promise<SiteView> {
  const tree = (await SitePage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) })) as El;
  const kids = tree.props.children as unknown[];
  const body = kids.find((k) => isValidElement(k) && (k.type as { name?: string }).name === 'SiteBody') as El;
  return body.props.view as SiteView;
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-118 · a contractor crew is never typed with the name of a person Keystone knows', () => {
  const crew = (name: string) => ({ person: '__crew', crew: name, role: 'Expertise', from: '12 Oct 2026', to: '23 Oct 2026' });

  it('"Add a rotation": refused for an EPC2i person (off the team or on it, full or short name, any case or accents); a real crew is accepted', async () => {
    as('pm');
    const n = (await site()).rotation.length;
    for (const name of ['Amélie Ollivier', 'Marion Kerviel', 'M. Kerviel', '  amelie   OLLIVIER ', 'Julien Wagner']) {
      expect([name, errorOf(await addSiteLineAction(HLT, 'rotation', crew(name)))]).toEqual([name, CREW_IS_PERSON]);
    }
    as('pm', 'fr');
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', crew('Marion Kerviel'))))
      .toBe('Ce nom est celui d’une personne connue de Keystone — ajoutez-la à l’équipe projet, puis choisissez-la');
    as('pm');
    expect(await addSiteLineAction(HLT, 'rotation', crew('Sous-traitant — 3 électriciens'))).toEqual({ toast: 'Rotation added · Sous-traitant — 3 électriciens' });
    const s = await site();
    expect(s.rotation.length).toBe(n + 1);
    expect(s.rotation.at(-1)).toMatchObject({ person: 'Sous-traitant — 3 électriciens', personId: null });
    // No unlinked rotation of an EPC2i person: no conflict without a department (that the PM could arbitrate) was created.
    expect(s.collisions.filter((c) => c.person === 'Amélie Ollivier' || c.person === 'Marion Kerviel').every((c) => c.personId !== null)).toBe(true);
  });

  it('"Edit" of a crew line: the crew may not become a known person typed as crew; choosing the person from the team still works', async () => {
    as('pm');
    const line = (await site()).rotation.find((r) => r.person === 'Contractant — 2 monteurs')!;
    expect(errorOf(await editSiteLineAction(HLT, 'rotation', line.position, line.stamp, crew('Marion Kerviel')))).toBe(CREW_IS_PERSON);
    expect((await site()).rotation.find((r) => r.position === line.position)!.person).toBe('Contractant — 2 monteurs');
  });

  it('the writer refuses it too (a direct call), on add and on update', async () => {
    const value = { personName: 'Marion Kerviel', crew: true, roleOnSite: 'Expertise', fromOn: '2026-10-12', toOn: '2026-10-23', lodging: '', travel: '', rotationNo: 1 };
    await expect(addSiteLine(HLT, { kind: 'rotation', value }, PM)).rejects.toThrow(CREW_IS_PERSON);
    await expect(addSiteLine(HLT, { kind: 'rotation', value: { ...value, personName: 'a. ollivier' } }, PM)).rejects.toThrow(CREW_IS_PERSON);
    const line = (await site()).rotation.find((r) => r.person === 'Contractant — 2 monteurs')!;
    await expect(updateSiteLine(HLT, line.position, line.stamp, { kind: 'rotation', value }, PM)).rejects.toThrow(CREW_IS_PERSON);
    expect((await site()).rotation.some((r) => r.person === 'Marion Kerviel')).toBe(false);
  });
});

describe('R-118 · "Add a rotation" offers the project team only', () => {
  it('a person on the plan who left the team: not offered to add, still offered (alone with the team) to edit their own line', async () => {
    const amelie = (await rows(`SELECT id FROM persons WHERE full_name = 'Amélie Ollivier'`))[0].id as string;
    await removeTeamMember(HLT, amelie, { name: 'Romain Aubert', personId: null });
    as('pm');
    const v = await pageView(HLT, { tab: 'team' });
    expect(personOptions(v.entry!.add.rotation)).not.toContain('Amélie Ollivier');
    expect(personOptions(v.entry!.add.rotation)).toContain('Julien Wagner');
    // The kind's "Edit" form offers the team only; her own line's form offers her too.
    expect(personOptions(v.entry!.edit.rotation)).not.toContain('Amélie Ollivier');
    const own = v.team!.rotation.find((r) => r.who === 'Amélie Ollivier')!;
    expect(own.entry!.values.person).toBe('Amélie Ollivier');
    expect(personOptions(own.entry!.form)).toEqual([...personOptions(v.entry!.edit.rotation).slice(0, -1), 'Amélie Ollivier', '__crew']);
    expect(v.team!.rotation.filter((r) => r.who !== 'Amélie Ollivier').every((r) => r.entry!.form === undefined)).toBe(true);
    // What the forms offer is what the Server Function accepts: add refused, her own line kept on edit.
    const add = { person: 'Amélie Ollivier', role: 'Supervision', from: '12 Oct 2026', to: '16 Oct 2026' };
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', add))).toBe(PERSON_REQUIRED);
    const line = (await site()).rotation.find((r) => r.person === 'Amélie Ollivier')!;
    expect(await editSiteLineAction(HLT, 'rotation', line.position, line.stamp, { ...add, role: line.roleOnSite, from: '19 Oct 2026', to: '11 Dec 2026' }))
      .toEqual({ toast: 'Line saved · Amélie Ollivier' });
    expect((await site()).rotation.find((r) => r.position === line.position)).toMatchObject({ person: 'Amélie Ollivier', personId: amelie, toOn: '2026-12-11' });
    await addTeamMember(HLT, amelie, 'team', { name: 'Romain Aubert', personId: null });
    expect(personOptions((await pageView(HLT, { tab: 'team' })).entry!.add.rotation)).toContain('Amélie Ollivier');
  });
});

describe('R-118 · "Confirm" and "Client confirms" act on the line the page showed', () => {
  it('equipment removed and replaced at the same position: a stale "Confirm" is refused for every persona; the new line stays Pending', async () => {
    as('pm');
    expect(await addSiteLineAction(HLT, 'equipment', { name: 'Old crane', source: 'local_rental' })).toEqual({ toast: 'Equipment added · Old crane' });
    let s = await site();
    const old = s.equipment.at(-1)!;
    expect(await removeSiteLineAction(HLT, 'equipment', old.position, old.stamp)).toEqual({ ok: true, toast: 'Line removed · Old crane' });
    expect(await addSiteLineAction(HLT, 'equipment', { name: 'New generator', source: 'local_rental' })).toEqual({ toast: 'Equipment added · New generator' });
    s = await site();
    const fresh = s.equipment.at(-1)!;
    expect([fresh.position, fresh.name, fresh.status]).toEqual([old.position, 'New generator', 'pending']);
    const out: Record<string, string> = {};
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        await expect(confirmEquipmentAction(HLT, old.position, old.stamp)).rejects.toThrow('REDIRECT /');
        out[role] = 'sent home';
        continue;
      }
      out[role] = errorOf(await confirmEquipmentAction(HLT, old.position, old.stamp));
    }
    expect(out).toEqual({
      director: STALE, pm: STALE, member: STALE, depthead: 'The site is read-only for you', englead: 'The site is read-only for you',
      quality: 'The site is read-only for you', procurement: 'The site is read-only for you', finance: 'The site is read-only for you', client: 'sent home',
    });
    expect((await site()).equipment.find((e) => e.position === old.position)).toMatchObject({ name: 'New generator', status: 'pending' });
    // The writer re-checks the stamp in its transaction.
    await expect(confirmEquipment(HLT, old.position, old.stamp, { name: 'Julien Wagner', role: 'member' })).rejects.toThrow(SITE_LINE_CHANGED);
    // The page the member sees carries the line's stamp (a non-lead has no line entry): "Confirm" sends it.
    as('member');
    const row = (await pageView(HLT)).ready!.equip.find((e) => e.position === old.position)!;
    expect([row.stamp, row.canConfirm]).toEqual([fresh.stamp, true]);
    expect(await confirmEquipmentAction(HLT, old.position, row.stamp)).toEqual({ ok: true });
    expect((await site()).equipment.find((e) => e.position === old.position)!.status).toBe('confirmed');
  });

  it('a pending prerequisite edited meanwhile: the client’s confirmation from the stale page is refused; from the fresh page it is recorded', async () => {
    as('member');
    const seen = (await pageView(HLT)).ready!.prereqs.find((p) => p.step?.to === 'confirmed')!;
    as('pm');
    const cur = (await site()).prerequisites.find((p) => p.position === seen.position)!;
    expect(seen.stamp).toBe(cur.stamp);
    expect(errorOf(await editSiteLineAction(HLT, 'prerequisite', cur.position, cur.stamp, { title: 'Arrêt quai 4 — 3 jours', activity: cur.activityCode, needed: '2 Nov 2026' })))
      .toBe('ok');
    for (const role of ['director', 'pm', 'member'] as const) {
      as(role);
      expect(await advancePrerequisiteAction(HLT, seen.position, 'confirmed', seen.stamp)).toEqual({ ok: false, error: STALE });
    }
    await expect(advancePrerequisite(HLT, seen.position, 'confirmed', seen.stamp, { name: 'Julien Wagner', role: 'member' })).rejects.toThrow(SITE_LINE_CHANGED);
    expect((await site()).prerequisites.find((p) => p.position === seen.position)).toMatchObject({ title: 'Arrêt quai 4 — 3 jours', status: 'pending' });
    as('member');
    const now = (await pageView(HLT)).ready!.prereqs.find((p) => p.position === seen.position)!;
    expect(await advancePrerequisiteAction(HLT, seen.position, 'confirmed', now.stamp)).toEqual({ ok: true });
    expect((await site()).prerequisites.find((p) => p.position === seen.position)!.status).toBe('confirmed');
  });
});

describe('R-119 · conflict keys and causes', () => {
  it('a Cursus note of 1,000 characters: the key stays short and the conflict is arbitrated; the note is shown whole', async () => {
    const note = `HT B2V expires 30 Nov 2026 · ${'Formalités de voyage : visa de travail en cours de délivrance par le consulat · '.repeat(13)}`.slice(0, 1000);
    await rows(`UPDATE cursus_clearances SET clearance_note = '${note.replace(/'/g, "''")}' WHERE project_code = '${HLT}' AND person_name = 'Pauline Noguès'`);
    const c = (await site()).collisions.find((x) => x.person === 'Pauline Noguès' && x.kind === 'cert')!;
    expect(c.key.length).toBeLessThan(80);
    expect(c.cause).toMatchObject({ type: 'cert', note });
    as('director');
    expect(await arbitrateConflictAction(HLT, c.key, { comment: 'Renewal booked before the mission ends' })).toEqual({ toast: 'Conflict arbitrated · Pauline Noguès' });
    expect((await site()).collisions.find((x) => x.key === c.key)).toMatchObject({ resolved: true });
    // Another note is another cause: the arbitration no longer applies.
    await rows(`UPDATE cursus_clearances SET clearance_note = 'HT B2V expires 4 Dec 2026' WHERE project_code = '${HLT}' AND person_name = 'Pauline Noguès'`);
    const next = (await site()).collisions.find((x) => x.person === 'Pauline Noguès' && x.kind === 'cert')!;
    expect([next.key === c.key, next.resolved]).toEqual([false, false]);
  });

  it('the same person on a cancelled, closed or warranty project’s site is no longer a Load conflict', async () => {
    await rows(`INSERT INTO site_rotations (project_id, person_name, person_id, role_on_site, from_on, to_on, lodging, travel, rotation_no, position)
      SELECT p.id, 'Julien Wagner', x.id, 'Supervision', '2026-11-02', '2026-11-06', '', '', 1, 0 FROM projects p, persons x WHERE p.code = 'RCF-019' AND x.full_name = 'Julien Wagner'`);
    const onRcf = async () => (await site()).collisions.filter((c) => c.kind === 'load' && c.cause.type === 'site' && c.cause.projectCode === 'RCF-019').map((c) => c.person);
    const at: Record<string, string[]> = {};
    for (const stage of ['chantier', 'annule', 'clos', 'garantie', 'mise_en_service_sat', 'etudes']) {
      await rows(`UPDATE projects SET stage = '${stage}' WHERE code = 'RCF-019'`);
      at[stage] = await onRcf();
    }
    expect(at).toEqual({
      chantier: ['Julien Wagner'], annule: [], clos: [], garantie: [], mise_en_service_sat: ['Julien Wagner'], etudes: ['Julien Wagner'],
    });
    await rows(`UPDATE projects SET stage = 'chantier' WHERE code = 'RCF-019'`);
  });
});
