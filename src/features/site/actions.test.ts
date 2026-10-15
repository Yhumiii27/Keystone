// Site (chantier) Server Functions against an in-memory seeded database (Cursus and Vigie mock connectors): permission
// gates (read-only / outside, roles outside the Site workspace even when the context would allow), forged input, stale
// steps; "Client confirms" → "Signed on site", equipment "Confirm" (the Go conditions follow), "Remind in Cursus" (once,
// not on GO, pending sync with Cursus), "Sync Cursus" (mock; HTTP without a linked Cursus site), the "Daily report" form (DR-003, listed, the viewer as author,
// date rules), the viewer in the audit trail. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Julien Wagner', role: 'member' as string, canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }), getLastProject: async () => 'HLT-026' };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
}));

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import GOLDEN from '@/domain/site.golden.json';
import { getDb, setDb } from '@/server/db/client';
import { cursusSyncRuns } from '@/server/db/schema';
import { resetCursusRefreshThrottle } from '@/server/integrations/cursus/connector';
import { openDatabase } from '@/server/db/open';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getSite, siteBadgeByProject } from '@/server/dal/site';
import { advancePrerequisiteAction, confirmEquipmentAction, remindInCursusAction, saveDailyReportAction, syncCursusAction } from './actions';

const as = (role: string, name: string) => Object.assign(viewer, { role, name });
const HLT = 'HLT-026';

describe('site Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('member', 'Julien Wagner');
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only / outside viewers, projects without a site sheet, unknown projects and forged input', async () => {
    viewer.canEdit = false;
    expect(await advancePrerequisiteAction(HLT, 3, 'confirmed')).toEqual({ ok: false, error: 'The site is read-only for you' });
    expect(await confirmEquipmentAction(HLT, 2)).toEqual({ ok: false, error: 'The site is read-only for you' });
    expect(await remindInCursusAction(HLT, 'Thomas Kerbrat')).toEqual({ ok: false, error: 'The site is read-only for you' });
    expect(await syncCursusAction(HLT)).toEqual({ ok: false, error: 'The site is read-only for you' });
    expect(await saveDailyReportAction(HLT, { progress: 'x' })).toEqual({ error: 'The site is read-only for you' });
    viewer.lang = 'fr';
    expect(await confirmEquipmentAction(HLT, 2)).toEqual({ ok: false, error: 'Le chantier est en lecture seule pour vous' });
    viewer.lang = 'en';
    viewer.canEdit = true;
    expect(await advancePrerequisiteAction('NDC-031', 0, 'confirmed')).toEqual({ ok: false, error: 'This project has no site sheet' });
    expect(await advancePrerequisiteAction('NOPE-000', 0, 'confirmed')).toEqual({ ok: false, error: 'Unknown project' });
    expect(await advancePrerequisiteAction('' as string, 0, 'confirmed')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await advancePrerequisiteAction(HLT, -1, 'confirmed')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await advancePrerequisiteAction(HLT, 1.5, 'confirmed')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await advancePrerequisiteAction(HLT, 3, 'accepted' as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await advancePrerequisiteAction(HLT, 99, 'confirmed')).toEqual({ ok: false, error: 'Unknown prerequisite' });
    expect(await confirmEquipmentAction(HLT, '2' as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await confirmEquipmentAction(HLT, 99)).toEqual({ ok: false, error: 'Unknown equipment' });
    expect(await remindInCursusAction(HLT, 42 as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await remindInCursusAction(HLT, 'Nobody')).toEqual({ ok: false, error: 'This person is not mobilised on the site in Cursus' });
    // A role outside the Site workspace is refused even if the context said otherwise (the writers re-check it too).
    as('quality', 'Gabriel Comte');
    expect(await advancePrerequisiteAction(HLT, 3, 'confirmed')).toEqual({ ok: false, error: 'The site is read-only for you' });
    expect((await getSite(HLT))!.prerequisites[3].status).toBe('pending');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"Client confirms" then "Signed on site" on a prerequisite; a stale step is refused; Go conditions follow', async () => {
    expect(await advancePrerequisiteAction(HLT, 4, 'signed')).toEqual({ ok: false, error: 'This step is not available any more' });
    expect(await advancePrerequisiteAction(HLT, 3, 'confirmed')).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await advancePrerequisiteAction(HLT, 3, 'confirmed')).toEqual({ ok: false, error: 'This step is not available any more' });
    expect(await advancePrerequisiteAction(HLT, 3, 'signed')).toEqual({ ok: true });
    let s = (await getSite(HLT))!;
    expect(s.prerequisites[3].status).toBe('signed');
    expect(s.go.conditions[0]).toMatchObject({ key: 'prerequisites', ok: false, sub: '1 pending' });
    expect(await advancePrerequisiteAction(HLT, 4, 'confirmed')).toEqual({ ok: true });
    s = (await getSite(HLT))!;
    expect(s.go.conditions[0]).toMatchObject({ ok: true, sub: 'Ready' });
    const audit = await listAudit();
    expect(audit.find((a) => a.object === 'Prerequisite · Autorisation de levage & arrêt exploitation quai 4' && a.change === 'status: Confirmed → Signed')).toMatchObject({ who: 'Julien Wagner' });
  });

  it('equipment "Confirm" (once); the equipment condition follows; the NO GO badge stays (Cursus, collisions, HSE)', async () => {
    as('depthead', 'Marion Kerviel');
    expect(await confirmEquipmentAction(HLT, 0)).toEqual({ ok: false, error: 'This step is not available any more' });
    expect(await confirmEquipmentAction(HLT, 2)).toEqual({ ok: true });
    expect(await confirmEquipmentAction(HLT, 2)).toEqual({ ok: false, error: 'This step is not available any more' });
    expect(await confirmEquipmentAction(HLT, 4)).toEqual({ ok: true });
    const s = (await getSite(HLT))!;
    expect(s.go.conditions.find((c) => c.key === 'equipment')).toMatchObject({ ok: true, sub: 'Ready' });
    expect(s.go.ok).toBe(false);
    expect(await siteBadgeByProject()).toEqual({ 'HLT-026': 'NO GO' });
  });

  it('"Remind in Cursus": once per person not GO, pending sync with Cursus; GO refused; FR toast', async () => {
    as('pm', 'Romain Aubert');
    expect(await remindInCursusAction(HLT, 'Thomas Kerbrat')).toEqual({ ok: true, toast: GOLDEN.toasts.en.remind });
    expect(await remindInCursusAction(HLT, 'Thomas Kerbrat')).toEqual({ ok: false, error: 'This step is not available any more' });
    expect(await remindInCursusAction(HLT, 'Julien Wagner')).toEqual({ ok: false, error: 'This step is not available any more' });
    viewer.lang = 'fr';
    expect(await remindInCursusAction(HLT, 'Pauline Noguès')).toEqual({ ok: true, toast: 'Relance envoyée via Cursus · Pauline Noguès' });
    const people = (await getSite(HLT))!.cursus.people;
    expect(people.filter((p) => p.reminded).map((p) => [p.personName, p.reminderSyncStatus])).toEqual([['Thomas Kerbrat', 'pending'], ['Pauline Noguès', 'pending']]);
    // The verdicts are Cursus's: a reminder does not change them.
    expect(people.map((p) => p.verdict)).toEqual(['go', 'no_go', 'go_with_reserve', 'go', 'no_go']);
    expect((await listActivity()).some((a) => a.what === 'Reminder sent via Cursus · Thomas Kerbrat' && a.who === 'Romain Aubert')).toBe(true);
  });

  it('"Sync Cursus" (mock): the approvals received; EN and FR toasts', async () => {
    expect(await syncCursusAction(HLT)).toEqual({ ok: true, toast: GOLDEN.toasts.en.sync });
    viewer.lang = 'fr';
    expect(await syncCursusAction(HLT)).toEqual({ ok: true, toast: GOLDEN.toasts.fr.sync });
  });

  it('"Sync Cursus" (HTTP) on a site not linked to a Cursus site: refused with the reason; reads never call Cursus nor log a failed run; a failing Cursus is retried once a minute', async () => {
    const calls = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    vi.stubEnv('CURSUS_API_URL', 'http://cursus.test');
    vi.stubGlobal('fetch', calls);
    resetCursusRefreshThrottle();
    const db = await getDb();
    const failedRuns = async () => (await db.select().from(cursusSyncRuns).where(eq(cursusSyncRuns.ok, false))).length;
    try {
      expect(await syncCursusAction(HLT)).toEqual({ ok: false, error: 'No Cursus site is linked to this project' });
      viewer.lang = 'fr';
      expect(await syncCursusAction(HLT)).toEqual({ ok: false, error: 'Aucun chantier Cursus n’est lié à ce projet' });
      await getSite(HLT);
      await getSite(HLT);
      expect([calls.mock.calls.length, await failedRuns()]).toEqual([0, 0]);
      // Linked but unreachable: the mirror is shown, one attempt (and one failed run) per minute, not per read.
      await db.execute(sql`update site_sheets set cursus_chantier_id = 'K-2614'`);
      expect((await getSite(HLT))!.cursus.people).toHaveLength(5);
      await getSite(HLT);
      expect([calls.mock.calls.length, await failedRuns()]).toEqual([1, 1]);
    } finally {
      await db.execute(sql`update site_sheets set cursus_chantier_id = null`);
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      resetCursusRefreshThrottle();
    }
  });

  it('"Daily report": DR-003 listed first, by the viewer, with weather / headcount (no HSE: NEW-SITE-2 a); date rules; FR messages', async () => {
    as('member', 'Julien Wagner');
    // NEW-SITE-2 'a' (R-122): an incident sent by an older form is ignored — incidents are declared in Vigie.
    expect(await saveDailyReportAction(HLT, { date: '25 Sep 2026', weather: 'rain', headcount: '12', progress: 'Rail survey bays 1–4 · anchor bolts checked', incident: 'near_miss' }))
      .toEqual({ toast: 'Daily report saved · DR-003', number: 'DR-003' });
    const s = (await getSite(HLT))!;
    expect(s.dailyReports[0]).toMatchObject({
      number: 'DR-003', reportOn: '2026-09-25', author: 'J. Wagner', text: 'Rail survey bays 1–4 · anchor bolts checked', weather: 'rain', headcount: 12, hseIncident: null, fromForm: true,
    });
    expect((await listAudit({ limit: 1 }))[0].change).toBe('daily report 2026-09-25 · Rain · 12 on site');
    expect(s.dailyReports.map((r) => r.number)).toEqual(['DR-003', 'DR-002', 'DR-001']);
    expect(await saveDailyReportAction(HLT, { date: '30 Sep 2026', progress: 'x' })).toEqual({ error: 'A daily report cannot be dated after today' });
    expect(await saveDailyReportAction(HLT, { date: 'tomorrow', progress: 'x' })).toEqual({ error: 'Enter a date such as 25 Sep 2026' });
    expect(await saveDailyReportAction(HLT, { progress: '   ' })).toEqual({ error: 'Progress is required' });
    expect(await saveDailyReportAction(HLT, { progress: 'x', weather: 'snow' })).toEqual({ error: 'Invalid request' });
    expect(await saveDailyReportAction(HLT, null as never)).toEqual({ error: 'Progress is required' });
    viewer.lang = 'fr';
    expect(await saveDailyReportAction(HLT, { headcount: 'douze', progress: 'x' })).toEqual({ error: 'L’effectif doit être un nombre entier' });
    expect(await saveDailyReportAction(HLT, { date: '24 sept. 2026', weather: 'clear', headcount: '', progress: 'Préparation zone de levage' }))
      .toEqual({ toast: 'Rapport journalier enregistré · DR-004', number: 'DR-004' });
    expect((await getSite(HLT))!.dailyReports.find((r) => r.number === 'DR-004')).toMatchObject({ reportOn: '2026-09-24', headcount: null, weather: 'clear' });
    as('client', 'Nadia Bensaïd');
    expect(await saveDailyReportAction(HLT, { progress: 'x' })).toEqual({ error: 'Le chantier est en lecture seule pour vous' });
  });
});
