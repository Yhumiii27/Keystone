// R-119 (D-6b 'a') on the seeded in-memory database with the real session ("View as" cookie) and project context: the 8
// conflicts computed on HLT-026, "Arbitrate" for the 9 personas (the director and the head of the person's department — not
// the Site's edit right; for a contractor crew the director and the project's leads), malformed input, stale and changed
// causes, the writer's own re-check, the audit trail, a cause that disappears or changes (the arbitration no longer applies),
// and the view's "Arbitrate" buttons per viewer.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { ARBITRATION_REFUSED, arbitrateSiteConflict, getSite } from '@/server/dal/site';
import { COOKIE } from '@/server/session';
import { arbitrateConflictAction } from './actions';
import { siteView } from './model';

const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const HLT = 'HLT-026';
const keyOf = async (person: string, kind: string) => (await getSite(HLT))!.collisions.find((c) => c.person === person && c.kind === kind)!.key;
const run = async (q: string) => (await getDb()).execute(sql.raw(q));

beforeAll(async () => {
  setDb(await openDatabase());
  // R-084: the load conflicts read the schedules' loads — the named demo assignments (owner answer 18 Oct 2026).
}, 60_000);

describe('R-119 · arbitrate a site-team conflict, 9 personas', () => {
  it('Julien Wagner (Engineering): the director and the head of engineering (off the team); the others refused; the client sent home', async () => {
    const key = await keyOf('Julien Wagner', 'load');
    const out: Record<string, unknown> = {};
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        await expect(arbitrateConflictAction(HLT, key, { comment: 'x' })).rejects.toThrow('REDIRECT /');
        out[role] = 'sent home';
        continue;
      }
      const r = await arbitrateConflictAction(HLT, key, { comment: `Checked by ${role}` });
      out[role] = 'toast' in (r as object) ? 'ok' : (r as { error: string }).error;
    }
    expect(out).toEqual({
      director: 'ok', pm: ARBITRATION_REFUSED, depthead: 'This conflict is already arbitrated', member: ARBITRATION_REFUSED, englead: ARBITRATION_REFUSED,
      quality: ARBITRATION_REFUSED, procurement: ARBITRATION_REFUSED, finance: ARBITRATION_REFUSED, logistics: ARBITRATION_REFUSED, client: 'sent home',
    });
    const c = (await getSite(HLT))!.collisions.find((x) => x.key === key)!;
    expect([c.resolved, c.arbitration?.comment, c.arbitration?.by]).toEqual([true, 'Checked by director', 'Marie Lefebvre']);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area, audit.reason]).toEqual(['Marie Lefebvre', 'Conflict · Julien Wagner', 'arbitrated · Load', 'Site', 'Checked by director']);
    expect((await listActivity()).some((a) => a.what === 'Arbitrated the load conflict of Julien Wagner' && a.who === 'Marie Lefebvre')).toBe(true);
  });

  it('the head of engineering arbitrates Julien Wagner’s absence; the quality manager (head of Quality) Hélène Sauvage’s badge', async () => {
    as('depthead', 'fr');
    expect(await arbitrateConflictAction(HLT, await keyOf('Julien Wagner', 'leave'), { comment: 'Remplacé par F. Bertrand le 9 nov.' })).toEqual({ toast: 'Conflit arbitré · Julien Wagner' });
    expect(await arbitrateConflictAction(HLT, await keyOf('Hélène Sauvage', 'doc'), { comment: 'x' })).toEqual({ error: 'Seul le chef du service de la personne ou le directeur arbitre ce conflit' });
    as('quality');
    expect(await arbitrateConflictAction(HLT, await keyOf('Hélène Sauvage', 'doc'), { comment: 'Badge requested, arrives 25 Nov' })).toEqual({ toast: 'Conflict arbitrated · Hélène Sauvage' });
    const s = (await getSite(HLT))!;
    // R-084: 7 conflicts with the named demo assignments (no load conflict for Amélie Ollivier any more), 3 arbitrated (5 on the seeded rows).
    // R-084 (absences), demo leave shifted (owner 22 Oct 2026): 4 open — no load conflict in a leave week any more (6 with the prototype's LEAVE: Amélie Ollivier's and
    // Thomas Kerbrat's leave weeks).
    expect(s.collisions.filter((c) => !c.resolved).length).toBe(4);
    expect(s.go.conditions.find((c) => c.key === 'collisions')!.sub).toBe('4 collisions');
    // Julien still has no open conflict: no icon; Hélène neither.
    expect(s.rotation.filter((r) => r.hasCollision).map((r) => r.person)).toEqual(['Amélie Ollivier', 'Thomas Kerbrat', 'Pauline Noguès']);
  });

  it('malformed input, unknown or stale conflicts are refused; nothing is written', async () => {
    as('director');
    const before = (await getDb()).execute(sql.raw('SELECT count(*)::int AS n FROM site_conflict_arbitrations'));
    const key = await keyOf('Pauline Noguès', 'cert');
    expect(await arbitrateConflictAction(HLT, key, { comment: '   ' })).toEqual({ error: 'A comment is required' });
    expect(await arbitrateConflictAction(HLT, key, { comment: 'x'.repeat(1001) })).toEqual({ error: 'The comment is too long' });
    expect(await arbitrateConflictAction(HLT, key, null as never)).toEqual({ error: 'A comment is required' });
    expect(await arbitrateConflictAction(HLT, '', { comment: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await arbitrateConflictAction(HLT, 42 as never, { comment: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await arbitrateConflictAction(HLT, 'load:pool:p:nobody:2026-10-19', { comment: 'x' })).toEqual({ error: 'This conflict has changed' });
    expect(await arbitrateConflictAction('NDC-031', key, { comment: 'x' })).toEqual({ error: 'This project has no site sheet' });
    expect(await arbitrateConflictAction('NOPE-000', key, { comment: 'x' })).toEqual({ error: 'Unknown project' });
    expect((await (await getDb()).execute(sql.raw('SELECT count(*)::int AS n FROM site_conflict_arbitrations'))).rows).toEqual((await before).rows);
  });

  it('the writer re-checks the rule with the actor (a direct call)', async () => {
    const key = await keyOf('Pauline Noguès', 'cert');
    await expect(arbitrateSiteConflict(HLT, key, 'x', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(ARBITRATION_REFUSED);
    await expect(arbitrateSiteConflict(HLT, key, 'x', { name: 'Nadia Bensaïd', role: 'client' })).rejects.toThrow(ARBITRATION_REFUSED);
    await expect(arbitrateSiteConflict(HLT, key, 'x', { name: 'Marion Kerviel', role: 'depthead' })).rejects.toThrow(ARBITRATION_REFUSED);
    await expect(arbitrateSiteConflict(HLT, key, ' ', { name: 'Marie Lefebvre', role: 'director' })).rejects.toThrow(/required/);
    await expect(arbitrateSiteConflict(HLT, 'nope', 'x', { name: 'Marie Lefebvre', role: 'director' })).rejects.toThrow('This conflict has changed');
  });

  it('a contractor crew’s conflict (another site at the same time): the director and the project’s leads', async () => {
    // The crew is booked on another project at overlapping dates.
    await run(`INSERT INTO site_rotations (project_id, person_name, role_on_site, from_on, to_on, lodging, travel, rotation_no, position)
      SELECT id, 'Contractant — 2 monteurs', 'Montage', '2026-11-02', '2026-11-13', '—', 'Route', 1, 0 FROM projects WHERE code = 'PRS-038'`);
    const c = (await getSite(HLT))!.collisions.find((x) => x.person === 'Contractant — 2 monteurs')!;
    expect([c.kind, c.department, c.cause]).toEqual(['load', null, { type: 'site', projectCode: 'PRS-038', fromOn: '2026-11-02', toOn: '2026-11-13' }]);
    as('depthead');
    expect(await arbitrateConflictAction(HLT, c.key, { comment: 'x' })).toEqual({ error: ARBITRATION_REFUSED });
    as('pm');
    expect(await arbitrateConflictAction(HLT, c.key, { comment: 'Crew split: 1 fitter stays on PRS-038' })).toEqual({ toast: 'Conflict arbitrated · Contractant — 2 monteurs' });
  });

  it('a changed cause reopens the conflict; a cause that disappears takes the conflict with it', async () => {
    // Julien Wagner's absence moves to 10 Nov: another cause, open again (the old arbitration no longer applies).
    await run(`UPDATE leave_entries SET start_date = '2026-11-10', end_date = '2026-11-10' WHERE person_id = (SELECT id FROM persons WHERE full_name = 'Julien Wagner')`);
    let s = (await getSite(HLT))!;
    expect(s.collisions.filter((c) => c.person === 'Julien Wagner').map((c) => [c.kind, c.resolved])).toEqual([['load', true], ['leave', false]]);
    // Hélène Sauvage's badge arrives in Cursus: no conflict any more.
    await run(`UPDATE cursus_clearances SET clearance = 'ok', clearance_note = 'Badge ISPS' WHERE person_name = 'Hélène Sauvage'`);
    s = (await getSite(HLT))!;
    expect(s.collisions.some((c) => c.person === 'Hélène Sauvage')).toBe(false);
  });

  it('the view offers "Arbitrate" to whoever may arbitrate each conflict, lists the arbitrated ones with who and why', async () => {
    const data = await getSite(HLT);
    const t = makeT('en');
    const forRole = (role: RoleKey, headed: string[], lead: boolean) => siteView(HLT, data, { tab: 'team', arbiter: { role, headed, lead } }, t, 'en').team!;
    const director = forRole('director', [], true);
    expect(director.collisions.every((c) => c.canArbitrate)).toBe(true);
    const head = forRole('depthead', ['Engineering'], false);
    expect(head.collisions.filter((c) => c.canArbitrate).map((c) => c.who)).toEqual(['Julien Wagner']);
    expect(forRole('member', [], true).collisions.some((c) => c.canArbitrate)).toBe(false);
    expect(director.arbitrated.map((a) => [a.who, a.kind, a.by, a.comment])).toEqual([
      ['Julien Wagner', 'Load', 'Marie Lefebvre', 'Checked by director'], ['Contractant — 2 monteurs', 'Load', 'Romain Aubert', 'Crew split: 1 fitter stays on PRS-038'],
    ]);
    expect(director.arbitrationForm.fields.map((f) => [f.id, f.type, f.required])).toEqual([['comment', 'textarea', true]]);
  });
});
