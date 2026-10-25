// R-189 (Arche K-04): the CAPEX milestone of a schedule milestone, set on the Schedule screen — the Server Function's rights (the
// director and the project's leads, not Finance nor a team member, never on a read-only project), validation, the write with its
// audit rows and activity event, a code moving from one milestone to another, the BL1 date published in pub_jalons_projets (also
// once the milestone is anchored by a Reschedule), and the select / read-only tag of the milestone list.
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lead: true, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/schedule', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
const lang = { current: 'en' as 'en' | 'fr' };
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: lang.current, t: makeT(lang.current) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, canEdit: () => viewer.edit }),
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { scheduleView } from '@/domain/schedule-gantt';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listCapexMilestones } from '@/server/dal/capex-milestones';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getScheduleData, rescheduleProject } from '@/server/dal/schedule';
import { setCapexMilestoneAction } from './actions';
import { ScheduleView } from './schedule-view';

const REFUSED = { error: 'Only the project’s leads and the director set the CAPEX milestones' };
const idOf = async (name: string) => (await listCapexMilestones('HLT-026')).find((m) => m.name === name)!.id;
const pub = async (jalon: string) =>
  (await (await getDb()).execute(sql`select prevu_le::text, reference_le::text, reel_le::text from pub_jalons_projets where projet_code = 'HLT-026' and jalon_code = ${jalon}`))
    .rows[0] as { prevu_le: string | null; reference_le: string | null; reel_le: string | null };

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('setCapexMilestoneAction (R-189)', () => {
  it('refuses Finance, a team member who is not a lead, and a read-only project', async () => {
    const id = await idOf('Systems energised');
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false, edit: true });
    expect(await setCapexMilestoneAction('HLT-026', id, 'sat')).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Romain Aubert', role: 'member', lead: false });
    expect(await setCapexMilestoneAction('HLT-026', id, 'sat')).toEqual(REFUSED);
    Object.assign(viewer, { role: 'pm', lead: true, edit: false });
    expect(await setCapexMilestoneAction('HLT-026', id, 'sat')).toEqual(REFUSED);
    expect((await listCapexMilestones('HLT-026')).find((m) => m.id === id)!.capexCode).toBeNull();
  });

  it('validates the input', async () => {
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: true });
    const id = await idOf('Systems energised');
    expect(await setCapexMilestoneAction('HLT-026', id, 'SAT')).toEqual({ error: 'Invalid request' });
    expect(await setCapexMilestoneAction('HLT-026', 'not-a-uuid', 'sat')).toEqual({ error: 'Invalid request' });
    expect(await setCapexMilestoneAction('HLT-026', 42 as unknown as string, 'sat')).toEqual({ error: 'Invalid request' });
    expect(await setCapexMilestoneAction('NOPE-000', id, 'sat')).toEqual({ error: 'Unknown project' });
    // A milestone of another project.
    const [other] = (await (await getDb()).execute(sql`select m.id from milestones m join projects p on p.id = m.project_id where p.code = 'NDC-031' limit 1`)).rows as { id: string }[];
    expect(await setCapexMilestoneAction('HLT-026', other.id, 'sat')).toEqual({ error: 'Unknown milestone' });
  });

  it('the PM of record sets it: stored, audited, in the activity feed and in pub_jalons_projets; a code moves; empty clears', async () => {
    const energised = await idOf('Systems energised');
    expect(await pub('sat')).toMatchObject({ reference_le: null });
    expect(await setCapexMilestoneAction('HLT-026', energised, 'sat')).toEqual({ ok: true });
    expect((await listAudit())[0]).toMatchObject({ object: 'HLT-026', change: 'CAPEX milestone of Systems energised: Not a CAPEX milestone → SAT' });
    expect((await listActivity()).some((e) => e.what === 'CAPEX milestone of Systems energised: Not a CAPEX milestone → SAT')).toBe(true);
    // « Systems energised »: BL1 position 10.5 = 15 Nov 2026 as the Schedule reads it.
    expect(await pub('sat')).toMatchObject({ reference_le: '2026-11-15' });
    // PV de réception moves from « Handover » (seeded) to « Systems energised »: two audit rows, one milestone per code.
    expect(await setCapexMilestoneAction('HLT-026', energised, 'pv_reception')).toEqual({ ok: true });
    const audit = (await listAudit()).slice(0, 2).map((a) => a.change);
    expect(audit).toEqual(['CAPEX milestone of Systems energised: SAT → Acceptance certificate', 'CAPEX milestone of Handover: Acceptance certificate → Not a CAPEX milestone']);
    const tags = Object.fromEntries((await listCapexMilestones('HLT-026')).map((m) => [m.name, m.capexCode]));
    expect(tags).toMatchObject({ Handover: null, 'Systems energised': 'pv_reception' });
    expect(await pub('pv_reception')).toMatchObject({ reference_le: '2026-11-15' });
    expect(await pub('sat')).toMatchObject({ reference_le: null });
    // Back to the seeded tagging; the director clears and sets.
    Object.assign(viewer, { name: 'Hélène Marchetti', role: 'director', lead: false });
    expect(await setCapexMilestoneAction('HLT-026', energised, '')).toEqual({ ok: true });
    expect(await setCapexMilestoneAction('HLT-026', await idOf('Handover'), 'pv_reception')).toEqual({ ok: true });
    expect(await pub('pv_reception')).toMatchObject({ prevu_le: '2027-01-14', reference_le: '2026-12-18' });
  });

  it('after a Reschedule the milestone is anchored on its activity: the BL1 date comes from the BL1 snapshot', async () => {
    await rescheduleProject('HLT-026', 'Romain Aubert');
    const [anchor] = (
      await (await getDb()).execute(sql`
        select ba.finish_date::text as bl1 from milestones m
        join activities a on a.id = m.activity_id
        join baselines b on b.project_id = m.project_id and b.code = 'BL1'
        join baseline_activities ba on ba.baseline_id = b.id and ba.activity_code = a.code
        where m.capex_milestone_code = 'pv_reception' and m.project_id = (select id from projects where code = 'HLT-026')`)
    ).rows as { bl1: string }[];
    expect(anchor.bl1).toBe('2026-12-18');
    expect(await pub('pv_reception')).toMatchObject({ prevu_le: '2027-01-14', reference_le: '2026-12-18' });
  });

  it('the milestone list: a select per milestone for the leads, the code alone otherwise (FR)', async () => {
    lang.current = 'fr';
    try {
      const data = (await getScheduleData('HLT-026'))!;
      const rows = (await listCapexMilestones('HLT-026')).map((m) => ({ id: m.id, capexCode: m.capexCode }));
      const lead = renderToStaticMarkup(await ScheduleView({ view: scheduleView(data), capex: { rows, editCode: 'HLT-026' } }));
      expect(lead.match(/<select/g)).toHaveLength(6);
      expect(lead).toContain('Pas un jalon CAPEX');
      expect(lead).toContain('PV de réception');
      expect(lead).toContain('aria-label="Jalon CAPEX · Transfert"');
      const ro = renderToStaticMarkup(await ScheduleView({ view: scheduleView(data), capex: { rows } }));
      expect(ro).not.toContain('<select');
      expect(ro).toContain('Jalon CAPEX · PV de réception');
    } finally {
      lang.current = 'en';
    }
  });
});
