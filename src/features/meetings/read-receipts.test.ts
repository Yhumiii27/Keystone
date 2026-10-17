// R-037 (S-11 a, X-6b, A-15): read receipts recorded in Keystone when a minutes recipient clicks "Open minutes" — matched by
// person (else by name), the organizer never counted, recorded once, audited; the Server Function checks that the viewer sees
// the project's meetings (read-only viewers allowed, the client on external meetings only), the 8 personas, malformed input,
// minutes not sent. Seeded in-memory database, real project context, mocked session.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'pm' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: () => {
    throw new Error('REDIRECT');
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
import { PERSONAS } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { meetingParticipants, meetings, persons } from '@/server/db/schema';
import { addMeetingLine, createMeeting, getMeeting, recordMinutesRead, sendMinutes } from '@/server/dal/meetings';
import { listAudit } from '@/server/dal/notifications';
import { getProjectContext } from '@/server/project-context';
import { recordMinutesReadAction } from './actions';

const HLT = 'HLT-026';
const readOf = async (n: string) => Object.fromEntries((await getMeeting(n))!.participants.map((p) => [p.name, p.readOn]));
const personOf = async (short: string) => {
  const [p] = await (await getDb()).select({ personId: persons.id, fullName: persons.fullName, shortName: persons.shortName }).from(persons).where(eq(persons.shortName, short));
  return p;
};
let ext = '';

beforeAll(async () => {
  setDb(await openDatabase());
  // An external meeting organised by R. Aubert: M. Kerviel (not on the HLT-026 team: read-only there), J. Wagner, N. Bensaïd (client).
  ext = await createMeeting(HLT, { title: 'Receipts check', type: 'external', series: 'one_off', date: '2026-09-28', invitees: ['R. Aubert', 'M. Kerviel', 'J. Wagner', 'N. Bensaïd'], agenda: ['Point'] }, 'Romain Aubert');
  await addMeetingLine(ext, 0, { type: 'info', text: 'Minutes for the receipts' }, 'Romain Aubert');
  await sendMinutes(ext, 'Romain Aubert');
}, 60_000);

describe('R-037 — read receipts in Keystone (DAL)', () => {
  it('a recipient matched by person, once; the organizer never; audited', async () => {
    const before = await readOf(ext);
    expect(before).toEqual({ 'R. Aubert': null, 'M. Kerviel': null, 'J. Wagner': null, 'N. Bensaïd': null });
    expect(await recordMinutesRead(ext, await personOf('R. Aubert'))).toBe(false); // the organizer receives no receipt
    expect(await recordMinutesRead(ext, await personOf('J. Wagner'), '2026-09-29')).toBe(true);
    expect(await recordMinutesRead(ext, await personOf('J. Wagner'), '2026-09-30')).toBe(false); // recorded once
    expect(await readOf(ext)).toMatchObject({ 'J. Wagner': '2026-09-29', 'R. Aubert': null });
    expect((await listAudit({ limit: 5 })).find((a) => a.object === ext)).toMatchObject({ who: 'Julien Wagner', change: expect.stringMatching(/^minutes read · MIN-HLT-\d+ · J\. Wagner · 29 Sep$/) });
  });

  it('a participant invited by a name Keystone could not link is matched by the reader’s name', async () => {
    const db = await getDb();
    const [m] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.number, ext));
    await db.update(meetingParticipants).set({ personId: null }).where(and(eq(meetingParticipants.meetingId, m.id), eq(meetingParticipants.name, 'M. Kerviel')));
    // Not yet: the Server Function test below records it through the name.
    expect((await readOf(ext))['M. Kerviel']).toBeNull();
  });

  it('minutes not sent: nothing recorded', async () => {
    expect(await recordMinutesRead('MTG-119', await personOf('A. Girard'))).toBe(false);
  });
});

describe('R-037 — recordMinutesReadAction (Server Function)', () => {
  it('a read-only viewer (M. Kerviel, not on the HLT-026 team) records their receipt: reading is not editing', async () => {
    session.role = 'depthead';
    expect((await getProjectContext(HLT, 'meetings')).readOnly).toBe(true);
    expect(await recordMinutesReadAction({ code: HLT, meeting: ext })).toEqual({ ok: true, recorded: true });
    expect((await readOf(ext))['M. Kerviel']).toBe('2026-09-25'); // R-013: the business date (25 Sep 2026 on the demo data set), not the prototype's 30 Sep
  });

  it('every persona: only recipients without a receipt record one; the client on this external meeting too', async () => {
    const recorded: Record<string, boolean> = {};
    for (const p of PERSONAS) {
      session.role = p.role;
      const r = await recordMinutesReadAction({ code: HLT, meeting: ext });
      expect(r.ok, p.role).toBe(true);
      recorded[p.role] = (r as { recorded: boolean }).recorded;
    }
    // J. Wagner and M. Kerviel had read already; R. Aubert organised; the others were not invited — only N. Bensaïd records.
    // Finance (R-044), the 9th persona, was not invited either.
    expect(recorded).toEqual({ director: false, pm: false, depthead: false, member: false, englead: false, quality: false, procurement: false, finance: false, client: true });
    expect(await readOf(ext)).toEqual({ 'R. Aubert': null, 'M. Kerviel': '2026-09-25', 'J. Wagner': '2026-09-29', 'N. Bensaïd': '2026-09-25' }); // R-013: read on the business date
  });

  it('the client never reaches an internal meeting; malformed and foreign input refused; minutes not sent record nothing', async () => {
    session.role = 'pm';
    await sendMinutes('MTG-118', 'Romain Aubert');
    session.role = 'client';
    expect(await recordMinutesReadAction({ code: HLT, meeting: 'MTG-118' })).toEqual({ ok: false, error: 'Unknown meeting' });
    session.role = 'member';
    for (const input of [{ code: '', meeting: ext }, { code: HLT, meeting: 'X' }, { code: HLT, meeting: 'MTG-9999' }, { code: HLT, meeting: 'MTG-121' }, { code: 'NOPE-1', meeting: ext }, undefined])
      expect((await recordMinutesReadAction(input as never)).ok).toBe(false);
    expect(await recordMinutesReadAction({ code: HLT, meeting: 'MTG-119' })).toEqual({ ok: true, recorded: false });
    // J. Wagner is a recipient of MTG-118 now that it is sent.
    expect(await recordMinutesReadAction({ code: HLT, meeting: 'MTG-118' })).toEqual({ ok: true, recorded: true });
    session.lang = 'fr';
    expect(await recordMinutesReadAction({ code: HLT, meeting: 'MTG-9999' })).toEqual({ ok: false, error: 'Réunion inconnue' });
    session.lang = 'en';
  });
});
