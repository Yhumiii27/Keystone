// R-121 (owner's decision D-4 'a' ★ "Notification et proposition de risque") on the seeded in-memory database, with the real
// session ("View as" cookie) and project context: the daily job (first run at the demo date sends nothing; late at J-15 → one
// notice to the PM of record; run twice → one notice; a new need date late again → a new notice), the Site page's proposal
// (`?prereq=` marks the row; "Raise as a risk" pre-filled for the leads only, 9 personas), the risk raised (rights, audit,
// activity, link back to the prerequisite, never twice, only while pending — late or not, owner's answer of 17 Oct 2026, second
// round: before J-15 too).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { and, eq } from 'drizzle-orm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import SitePage from '@/app/(app)/projects/[code]/site/page';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { PREREQUISITE_ALERT_TITLE, PREREQ_RISK_LEADS_ONLY } from '@/domain/prerequisite-alerts';
import { setClockForTests } from '@/server/clock';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { projects, risks, sitePrerequisites } from '@/server/db/schema';
import { listActivity, listAudit, listNotifications } from '@/server/dal/notifications';
import { alertLatePrerequisites, raisePrerequisiteRisk } from '@/server/dal/prerequisite-alerts';
import { listRisks } from '@/server/dal/risks';
import { notificationsFor } from '@/server/dal/shell';
import { getSite } from '@/server/dal/site';
import { jobDefinition } from '@/server/jobs/definitions';
import { COOKIE } from '@/server/session';
import type { SiteView } from './model';
import { raisePrerequisiteRiskAction } from './prerequisite-risk-actions';

const HLT = 'HLT-026';
const QUAI = 3; // "Autorisation de levage & arrêt exploitation quai 4", A1320, needed 2 Nov (J-15 = 18 Oct), pending.
const HT = 4; // "Point de raccordement HT 11 kV disponible", A1410, needed 20 Nov (J-15 = 5 Nov), pending.
const POWER = 1; // "Alimentation électrique chantier 400 V / 250 kVA", A1420, confirmed.
const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const at = (iso: string) => setClockForTests({ kind: 'fixed', iso });
const errorOf = (r: unknown) => (r && typeof r === 'object' && 'error' in r ? (r as { error: string }).error : 'ok');
const alerts = async (role: RoleKey) => (await listNotifications(role)).filter((n) => n.title === PREREQUISITE_ALERT_TITLE);
const line = async (position: number) => (await getSite(HLT))!.prerequisites.find((p) => p.position === position)!;

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
async function pageView(sp: Record<string, string> = {}): Promise<SiteView> {
  const tree = (await SitePage({ params: Promise.resolve({ code: HLT }), searchParams: Promise.resolve(sp) })) as El;
  const body = (tree.props.children as unknown[]).find((k) => isValidElement(k) && (k.type as { name?: string }).name === 'SiteBody') as El;
  return body.props.view as SiteView;
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
afterEach(() => setClockForTests(null));

describe('R-121 · the daily job', () => {
  it('first run on the demo database at its date (Fri 25 Sep 2026): nothing is late, nothing is sent', async () => {
    const out = await jobDefinition('site-prerequisite-alerts').run();
    expect(out).toEqual({
      summary: 'Client prerequisites at 2026-09-25 · 0 late alerted · 0 PM notified · 0 without recipient · 2 pending',
      counts: { alerted: 0, notified: 0, unaddressed: 0, pending: 2 }, warn: false,
    });
    expect(await alerts('pm')).toEqual([]);
  });

  it('late at J-15: one notice to the PM of record (Romain Aubert) linking to the prerequisite; run twice → still one', async () => {
    const stamp = (await line(QUAI)).stamp;
    expect(await alertLatePrerequisites('2026-10-17')).toMatchObject({ alerted: 0 });
    expect(await alertLatePrerequisites('2026-10-18')).toEqual({ today: '2026-10-18', pending: 2, alerted: 1, notified: 1, unaddressed: 0 });
    expect(await alertLatePrerequisites('2026-10-18')).toMatchObject({ alerted: 0, notified: 0 });
    at('2026-10-19');
    expect((await jobDefinition('site-prerequisite-alerts').run()).counts).toEqual({ alerted: 0, notified: 0, unaddressed: 0, pending: 2 });
    const [n, ...more] = await alerts('pm');
    expect(more).toEqual([]);
    expect(n).toMatchObject({ kind: 'alert', sub: 'Autorisation de levage & arrêt exploitation quai 4 · A1320 · 2 Nov', screen: 'site', params: { prereq: QUAI }, projectCode: HLT, read: false });
    expect((await notificationsFor('pm')).find((x) => x.id === n.id)!.href).toBe(`/projects/${HLT}/site?prereq=${QUAI}`);
    // Addressed to the PM of record only.
    for (const role of ROLES.filter((r) => r !== 'pm')) expect([role, (await alerts(role)).length]).toEqual([role, 0]);
    // The alert does not change the line as its forms see it.
    expect((await line(QUAI)).stamp).toBe(stamp);
  });

  it('a new need date is a new episode: alerted again once late at the new date', async () => {
    const db = await getDb();
    expect(await alertLatePrerequisites('2026-11-05')).toMatchObject({ alerted: 1, notified: 1 }); // HT, 20 Nov
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
    await db.update(sitePrerequisites).set({ neededBy: '2026-12-01' }).where(and(eq(sitePrerequisites.projectId, p.id), eq(sitePrerequisites.position, HT)));
    expect(await alertLatePrerequisites('2026-11-06')).toMatchObject({ alerted: 0 });
    expect(await alertLatePrerequisites('2026-11-16')).toMatchObject({ alerted: 1, notified: 1 });
    expect(await alertLatePrerequisites('2026-11-16')).toMatchObject({ alerted: 0 });
    expect((await alerts('pm')).map((n) => n.sub)).toEqual([
      'Point de raccordement HT 11 kV disponible · A1410 · 1 Dec', 'Point de raccordement HT 11 kV disponible · A1410 · 20 Nov',
      'Autorisation de levage & arrêt exploitation quai 4 · A1320 · 2 Nov',
    ]);
  });
});

describe('R-121 · "Raise as a risk"', () => {
  it('the page marks the notified row; the pre-filled form is offered on every pending prerequisite, to the project’s leads only (9 personas)', async () => {
    at('2026-10-19');
    const out: Record<string, unknown> = {};
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        await expect(pageView({ prereq: String(QUAI) })).rejects.toThrow(/REDIRECT|NOT_FOUND/);
        continue;
      }
      const v = (await pageView({ prereq: String(QUAI) })).ready!;
      out[role] = v.prereqs.filter((r) => r.raise).map((r) => r.position);
      expect([role, v.prereqs.map((r) => r.focus)]).toEqual([role, [false, false, false, true, false, false]]);
    }
    // Owner, 17 Oct 2026 (second round): offered before J-15 too — HT (needed 1 Dec since the test above, J-15 = 16 Nov) is
    // pending and not late at 19 Oct; the confirmed and signed lines are not offered.
    expect(out).toEqual({ director: [QUAI, HT], pm: [QUAI, HT], depthead: [], member: [], englead: [], quality: [], procurement: [], finance: [] });
    as('pm');
    const v = (await pageView({ prereq: String(QUAI) })).ready!;
    // Owner: the PM of record — owner's answer of 17 Oct 2026 (R-121 Q3): the PM is on every "New risk" owner list, so the
    // J-15 proposal pre-selects Romain Aubert on HLT-026 (before: the list was the prototype's DEFS.team, the first owner was
    // proposed). The form's owner options end with him.
    expect(v.prereqs[QUAI].raise).toEqual({
      title: 'Late client prerequisite — Autorisation de levage & arrêt exploitation quai 4', cat: 'contractual_client', owner: 'Romain Aubert', resp: 'mitigate',
    });
    expect(v.prereqs[HT].raise).toEqual({
      title: 'Client prerequisite at risk — Point de raccordement HT 11 kV disponible', cat: 'contractual_client', owner: 'Romain Aubert', resp: 'mitigate',
    });
    // Only the notified row opens the form by itself.
    expect([v.prereqs[QUAI].focus, v.prereqs[HT].focus]).toEqual([true, false]);
    expect(v.raiseForm!.title).toBe('New risk');
    const ownerField = v.raiseForm!.fields.find((f) => f.id === 'owner') as { options: string[] };
    expect([ownerField.options[0], ownerField.options.at(-1)]).toEqual(['Amélie Ollivier', 'Romain Aubert']);
    as('pm', 'fr');
    const fr = (await pageView()).ready!.prereqs;
    expect([fr[QUAI].raise!.title, fr[HT].raise!.title]).toEqual([
      'Prérequis client en retard — Autorisation de levage & arrêt exploitation quai 4', 'Prérequis client à risque — Point de raccordement HT 11 kV disponible',
    ]);
  });

  it('refused to everybody but the leads; the PM confirms it: risk registered with its cause, linked, audited, in the activity feed', async () => {
    at('2026-10-19');
    const stamp = (await line(QUAI)).stamp;
    const values = { title: 'Late client prerequisite — Autorisation de levage & arrêt exploitation quai 4', cat: 'contractual_client', owner: 'Romain Aubert', resp: 'mitigate', p: '4', i: '4', cost: '30' };
    for (const role of ROLES.filter((r) => r !== 'pm' && r !== 'director')) {
      as(role);
      if (role === 'client') {
        await expect(raisePrerequisiteRiskAction(HLT, QUAI, stamp, values)).rejects.toThrow(/REDIRECT/);
        continue;
      }
      expect([role, errorOf(await raisePrerequisiteRiskAction(HLT, QUAI, stamp, values))]).toEqual([role, PREREQ_RISK_LEADS_ONLY]);
    }
    as('pm');
    expect(errorOf(await raisePrerequisiteRiskAction(HLT, QUAI, 'zzz', values))).toBe('This step is not available any more');
    expect(errorOf(await raisePrerequisiteRiskAction(HLT, QUAI, stamp, { ...values, owner: 'Nobody' }))).toBe('Unknown owner');
    expect(errorOf(await raisePrerequisiteRiskAction(HLT, POWER, (await line(POWER)).stamp, values))).toBe('This prerequisite is not pending any more');
    const r = await raisePrerequisiteRiskAction(HLT, QUAI, stamp, values);
    expect(r).toEqual({ toast: expect.stringMatching(/^R-\d+ · Risk registered$/) });
    const number = (r as { toast: string }).toast.split(' · ')[0];

    const risk = (await listRisks(HLT)).find((x) => x.id === number)!;
    expect(risk).toMatchObject({ title: values.title, status: 'open' });
    const db = await getDb();
    const [row] = await db.select().from(risks).where(eq(risks.number, number));
    expect([row.category, row.response, row.probability, row.impact, row.trigger, row.costKeur]).toEqual([
      'contractual_client', 'mitigate', 4, 4, 'Client prerequisite not confirmed 15 days before its need date · Autorisation de levage & arrêt exploitation quai 4 · A1320 · 2 Nov 2026', 30,
    ]);
    expect(row.activityId).not.toBeNull();
    expect((await line(QUAI)).riskNumber).toBe(number);

    const audit = await listAudit({ projectCode: HLT, limit: 10 });
    expect(audit.find((a) => a.object === number)).toMatchObject({ who: 'Romain Aubert', change: `created · ${values.title}`, area: 'Risks' });
    expect(audit.find((a) => a.object === 'Prerequisite · Autorisation de levage & arrêt exploitation quai 4')).toMatchObject({
      who: 'Romain Aubert', change: `risk raised · ${number}`, area: 'Site', after: { risk: number },
    });
    const [act] = await listActivity({ limit: 1 });
    expect(act).toMatchObject({ who: 'Romain Aubert', what: `Raised ${number} from a late client prerequisite · Autorisation de levage & arrêt exploitation quai 4`, projectCode: HLT });
    expect(act.messageKey).toBe('site.prerequisiteRiskRaised');

    // Raised once: the row links to the risk and no longer offers it; a second confirmation is refused.
    const v = (await pageView()).ready!;
    expect([v.prereqs[QUAI].risk, v.prereqs[QUAI].raise]).toEqual([{ number, href: `/projects/${HLT}/risks?risk=${number}` }, null]);
    as('director');
    expect(errorOf(await raisePrerequisiteRiskAction(HLT, QUAI, stamp, values))).toBe('A risk was already raised from this prerequisite');
  });

  it('before J-15 (owner, 17 Oct 2026, second round): the PM raises a risk from a pending prerequisite not late yet; non-leads still refused', async () => {
    at('2026-10-19');
    const p = await line(HT);
    expect([p.status, p.neededBy, p.late, p.riskNumber]).toEqual(['pending', '2026-12-01', false, null]);
    const values = { title: 'Client prerequisite at risk — Point de raccordement HT 11 kV disponible', cat: 'contractual_client', owner: 'Romain Aubert', resp: 'mitigate' };
    as('member');
    expect(errorOf(await raisePrerequisiteRiskAction(HLT, HT, p.stamp, values))).toBe(PREREQ_RISK_LEADS_ONLY);
    as('pm');
    const r = await raisePrerequisiteRiskAction(HLT, HT, p.stamp, values);
    expect(r).toEqual({ toast: expect.stringMatching(/^R-\d+ · Risk registered$/) });
    const number = (r as { toast: string }).toast.split(' · ')[0];
    const [row] = await (await getDb()).select().from(risks).where(eq(risks.number, number));
    // The cause without "15 days before" — the prerequisite is not late.
    expect([row.title, row.category, row.trigger]).toEqual([values.title, 'contractual_client', 'Client prerequisite not confirmed yet · Point de raccordement HT 11 kV disponible · A1410 · 1 Dec 2026']);
    expect((await line(HT)).riskNumber).toBe(number);
    const [act] = await listActivity({ limit: 1 });
    expect(act).toMatchObject({ who: 'Romain Aubert', what: `Raised ${number} from a client prerequisite not confirmed yet · Point de raccordement HT 11 kV disponible` });
    expect(act.messageKey).toBe('site.pendingPrerequisiteRiskRaised');
    expect((await pageView()).ready!.prereqs[HT].raise).toBeNull();
  });

  it('the writer re-checks the lead right and the status with the actor', async () => {
    at('2026-11-20');
    const input = { title: 'x', category: 'technical', response: 'mitigate' as const };
    const stamp = (await line(POWER)).stamp;
    await expect(raisePrerequisiteRisk(HLT, POWER, stamp, input, 'cause', { name: 'Julien Wagner', role: 'member' })).rejects.toThrow(PREREQ_RISK_LEADS_ONLY);
    await expect(raisePrerequisiteRisk(HLT, POWER, stamp, input, 'cause', { name: 'Marie Lefebvre', role: 'director' })).rejects.toThrow('This prerequisite is not pending any more');
  });
});
