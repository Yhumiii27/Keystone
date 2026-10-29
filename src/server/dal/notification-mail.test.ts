// R-036 and R-015 on the demo database (business date Fri 25 Sep 2026): who receives which notice (persons, never a whole role;
// rights; the client; the internal client of R-190), the routing of each e-mail by preference (immediate, daily digest, none), the
// digest's idempotency, the file transport's .eml output, the @mentions of a task comment, and the indicator alerts told once
// while they last.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { and, eq, inArray } from 'drizzle-orm';
import { DEFAULT_NOTIFICATION_MODES } from '@/domain/notification-mail';
import { DEFAULT_REMINDER_PREFS } from '@/domain/reminders';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { clients, notificationRecipients, notifications, projects, reminderSends, users } from '@/server/db/schema';
import { listSatSystems, planSat } from './commissioning';
import { runIndicatorAlerts } from './event-notices';
import { recordItpResult } from './itp';
import { expireStaleSending, runNotificationDigest, sendImmediateMails } from './notification-mail';
import { createNotification, listNotifications, markNotificationRead } from './notifications';
import { decideDeliverable, moveDeliverable } from './quality';
import { saveUserReminderPrefs } from './reminder-preferences';
import { addTaskComment } from './tasks';
import { notifyTaskMentions } from './task-notices';

const HLT = 'HLT-026';
const A = {
  director: { role: 'director', name: 'Marie Lefebvre' },
  pm: { role: 'pm', name: 'Romain Aubert' },
  quality: { role: 'quality', name: 'Gabriel Comte' },
  client: { role: 'client', name: 'Nadia Bensaïd' },
} as const;

let dir: string;
const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.eml')).sort() : []);
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
function textOf(raw: string): string {
  const b = /boundary="([^"]+)"/.exec(raw)?.[1];
  const part = b ? raw.split(`--${b}`)[1] : raw;
  const body = part.split('\r\n\r\n').slice(1).join('').trim();
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}
/** The .eml files written by `run`, decoded. */
async function mailsOf(run: () => Promise<unknown>): Promise<{ name: string; text: string; raw: string }[]> {
  const before = new Set(files());
  await run();
  return files().filter((f) => !before.has(f)).map((name) => ({ name, raw: read(name), text: textOf(read(name)) }));
}
const userOf = async (persona: string) => {
  const [u] = await (await getDb()).select({ id: users.id, personId: users.personId }).from(users).where(eq(users.personaRole, persona));
  return u;
};
/** The e-mail state of each recipient of the notification `code` (persona role → state). */
async function statesOf(code: string): Promise<Record<string, string | null>> {
  const db = await getDb();
  const rows = await db.select({ persona: users.personaRole, state: notificationRecipients.mailState }).from(notificationRecipients)
    .innerJoin(notifications, eq(notifications.id, notificationRecipients.notificationId)).innerJoin(users, eq(users.id, notificationRecipients.userId))
    .where(eq(notifications.code, code));
  return Object.fromEntries(rows.map((r) => [r.persona ?? '?', r.state]));
}
/** Notification codes addressed to a persona whose title starts with `title`. */
const bellOf = async (persona: string, title: string) => (await listNotifications(persona)).filter((n) => n.title.startsWith(title));
const notice = (over: Partial<Parameters<typeof createNotification>[0]> = {}) =>
  ({ kind: 'approval', title: 'Change request awaiting your decision · CR-099', sub: 'Crane rail extension', screen: 'changes', params: { cr: 'CR-099' }, projectCode: HLT, audience: [], ...over }) as Parameters<typeof createNotification>[0];

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-r036-'));
}, 60_000);
beforeEach(() => {
  vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'file');
  vi.stubEnv('KEYSTONE_MAIL_DIR', dir);
  vi.stubEnv('KEYSTONE_MAIL_FROM', 'Keystone <keystone@epc2i.fr>');
  vi.stubEnv('KEYSTONE_PUBLIC_URL', 'https://keystone.epc2i.fr');
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('R-036 · immediate e-mails', () => {
  it('a notice waiting for an action is e-mailed at once to the person addressed (file transport: one .eml, French)', async () => {
    const romain = await userOf('pm');
    let code = '';
    const mails = await mailsOf(async () => { code = await createNotification(notice({ toPersonIds: [romain.personId] })); });
    expect(await statesOf(code)).toEqual({ pm: 'sent' });
    expect(mails).toHaveLength(1);
    expect(mails[0].name).toMatch(/romain-aubert/);
    expect(mails[0].raw).toContain('Subject: =?UTF-8?');
    expect(mails[0].text).toContain('Demande de modification en attente de votre décision · CR-099');
    expect(mails[0].text).toContain('Ouvrir dans Keystone: https://keystone.epc2i.fr/projects/HLT-026/changes?cr=CR-099');
    // Sent once: the retry job finds nothing.
    expect((await sendImmediateMails()).claimed).toBe(0);
  });

  it('the deadline reminders and weekly reports (email: false) are not routed here; no transport = nothing leaves', async () => {
    const romain = await userOf('pm');
    expect(await statesOf(await createNotification(notice({ toPersonIds: [romain.personId], email: false })))).toEqual({ pm: null });
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'none');
    const mails = await mailsOf(async () => expect(await statesOf(await createNotification(notice({ toPersonIds: [romain.personId] })))).toEqual({ pm: 'no_transport' }));
    expect(mails).toEqual([]);
  });

  it('a row left waiting (crash after the commit) is sent by the job; one stuck "sending" is given up, never resent', async () => {
    const romain = await userOf('pm');
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'none');
    const code = await createNotification(notice({ toPersonIds: [romain.personId] }));
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'file');
    const db = await getDb();
    const [n] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.code, code));
    await db.update(notificationRecipients).set({ mailState: 'immediate' }).where(eq(notificationRecipients.notificationId, n.id));
    const mails = await mailsOf(async () => expect(await sendImmediateMails()).toMatchObject({ claimed: 1, sent: 1 }));
    expect(mails).toHaveLength(1);
    await db.update(notificationRecipients).set({ mailState: 'sending', mailAt: new Date(Date.now() - 31 * 60_000) }).where(eq(notificationRecipients.notificationId, n.id));
    expect(await expireStaleSending()).toBe(1);
    expect(await statesOf(code)).toEqual({ pm: 'failed' });
  });
});

describe('R-036 · preferences and the daily digest', () => {
  it('an alert goes to the digest; the digest is one e-mail per person and day, the notices read in the bell left out', async () => {
    const romain = await userOf('pm');
    const alert = (sub: string) => notice({ kind: 'alert', title: 'Indicator alert · Cost overrun', sub, screen: 'budget', params: {}, toPersonIds: [romain.personId] });
    const first = await createNotification(alert('HLT-026 · first'));
    const read = await createNotification(alert('HLT-026 · read already'));
    expect(await statesOf(first)).toEqual({ pm: 'digest' });
    await markNotificationRead('pm', read);
    const mails = await mailsOf(() => runNotificationDigest('2026-09-28'));
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('Vos notifications dans Keystone · 28 sept.');
    expect(mails[0].text).toContain('HLT-026 · first');
    expect(mails[0].text).not.toContain('read already');
    expect([await statesOf(first), await statesOf(read)]).toEqual([{ pm: 'digested' }, { pm: 'seen' }]);
    // The same day again: nothing; a notice arriving meanwhile waits for the next day's digest.
    const later = await createNotification(alert('HLT-026 · later'));
    expect(await mailsOf(() => runNotificationDigest('2026-09-28'))).toEqual([]);
    expect(await statesOf(later)).toEqual({ pm: 'digest' });
    const next = await mailsOf(() => runNotificationDigest('2026-09-29'));
    expect(next.map((m) => m.text.includes('HLT-026 · later'))).toEqual([true]);
    const db = await getDb();
    expect((await db.select().from(reminderSends).where(and(eq(reminderSends.personId, romain.personId), eq(reminderSends.kind, 'digest')))).map((r) => [r.occurrence, r.emailStatus]))
      .toEqual([['2026-09-28', 'sent'], ['2026-09-29', 'sent']]);
  });

  it('each person chooses per family: approvals off, alerts at once', async () => {
    const fabien = await userOf('procurement');
    await saveUserReminderPrefs(fabien.id, { ...DEFAULT_REMINDER_PREFS, notifications: { ...DEFAULT_NOTIFICATION_MODES, approvals: 'off', alerts: 'immediate' } }, { name: 'Fabien Bertrand', role: 'procurement' });
    const mails = await mailsOf(async () => {
      expect(await statesOf(await createNotification(notice({ toPersonIds: [fabien.personId] })))).toEqual({ procurement: 'off' });
      expect(await statesOf(await createNotification(notice({ kind: 'invoice', title: 'Invoice blocked by the 3-way match', toPersonIds: [fabien.personId] })))).toEqual({ procurement: 'sent' });
    });
    expect(mails).toHaveLength(1);
    await saveUserReminderPrefs(fabien.id, 'reset', { name: 'Fabien Bertrand', role: 'procurement' });
  });
});

describe('R-036 · rights: a person is mailed only what the bell shows them', () => {
  it('the client: their project at once (even an alert), never an NCR nor another organisation’s project; role audiences still work', async () => {
    const nadia = await userOf('client');
    const mails = await mailsOf(async () => {
      expect(await statesOf(await createNotification(notice({ kind: 'request', title: 'SAT invitation', screen: 'client', params: {}, toPersonIds: [nadia.personId] })))).toEqual({ client: 'sent' });
      expect(await statesOf(await createNotification(notice({ kind: 'quality', title: 'NCR raised', screen: 'quality', params: { qTab: 'ncr', ncr: 'NCR-029' }, toPersonIds: [nadia.personId] }))))
        .toEqual({ client: 'not_visible' });
      expect(await statesOf(await createNotification(notice({ projectCode: 'NDC-031', toPersonIds: [nadia.personId] })))).toEqual({ client: 'not_visible' });
    });
    expect(mails).toHaveLength(1);
    // A role audience (the prototype's notices) still reaches every user of the role.
    const code = await createNotification(notice({ kind: 'sync', title: 'Lucca sync', screen: 'activity', projectCode: null, audience: ['director'] }));
    expect(await statesOf(code)).toEqual({ director: 'digest' });
  });
});

describe('R-015 · key events to the persons concerned', () => {
  it('Plan SAT: the invitation to the external client’s contacts (bell + e-mail at once); nothing for a group subsidiary (R-190)', async () => {
    const [system] = await listSatSystems(HLT);
    const mails = await mailsOf(() => planSat(HLT, { system, date: '2026-11-12', clientWitnesses: 'N. Bensaïd' }, A.pm));
    const sat = async (persona: string) => (await bellOf(persona, 'SAT invitation')).filter((n) => n.sub.startsWith(system));
    expect((await sat('client')).map((n) => n.sub)).toEqual([`${system} · 12 Nov 2026 · N. Bensaïd`]);
    expect(await sat('pm')).toEqual([]);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('Invitation à la SAT');
    // The same client marked internal (a subsidiary): Arche follows the project, Keystone sends nothing.
    const db = await getDb();
    const [p] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.code, HLT));
    await db.update(clients).set({ isInternal: true }).where(eq(clients.id, p.clientId!));
    try {
      expect(await mailsOf(() => planSat(HLT, { system, date: '2026-11-19' }, A.pm))).toEqual([]);
      expect(await sat('client')).toHaveLength(1);
    } finally {
      await db.update(clients).set({ isInternal: false }).where(eq(clients.id, p.clientId!));
    }
  });

  it('a deliverable submitted asks the client to accept; the client’s decision goes to the leads', async () => {
    await moveDeliverable(HLT, 'D-018', 'in_progress', A.pm);
    await moveDeliverable(HLT, 'D-018', 'internal_review', A.pm);
    await moveDeliverable(HLT, 'D-018', 'submitted', A.pm);
    expect((await bellOf('client', 'Deliverable to accept · D-018'))).toHaveLength(1);
    expect(await bellOf('pm', 'Deliverable to accept')).toEqual([]);
    await decideDeliverable(HLT, 'D-018', 'rejected', A.client, 'Load case 4 missing');
    expect((await bellOf('pm', 'Deliverable rejected by the client · D-018')).map((n) => n.kind)).toEqual(['quality']);
    expect(await bellOf('client', 'Deliverable rejected')).toEqual([]);
  });

  it('an inspection recorded Failed: the project’s leads, not the inspector who recorded it', async () => {
    await recordItpResult(HLT, 'I-02', { result: 'failed', resultOn: '2026-09-24', inspector: 'Gabriel Comte', comment: 'Weld porosity on the rail splice' }, A.quality);
    const [n] = await bellOf('pm', 'Inspection failed · I-02');
    expect(n).toMatchObject({ kind: 'quality', screen: 'itp' });
    expect(n.sub).toContain('Weld porosity on the rail splice');
    expect(await bellOf('quality', 'Inspection failed')).toEqual([]);
    expect(await bellOf('client', 'Inspection failed')).toEqual([]);
  });

  it('@mentions in a task comment: the person mentioned, by e-mail at once', async () => {
    const posted = (await addTaskComment('T-2318', 'Romain Aubert', 'Can you check the anchor plan, @Julien Wagner?'))!;
    const julien = await userOf('member');
    expect(posted.mentioned).toEqual([julien.personId]);
    const mails = await mailsOf(() => notifyTaskMentions({ number: posted.task, projectCode: posted.projectCode }, posted.mentioned, 'Can you check the anchor plan', 'Romain Aubert'));
    expect(mails.map((m) => m.name.includes('julien-wagner'))).toEqual([true]);
    expect(mails[0].text).toContain('@vous dans T-2318');
  });

  it('indicator alerts: each alert to the project’s leads and the directors, once while it lasts, again once it came back', async () => {
    const first = await runIndicatorAlerts('2026-09-25');
    expect(first.alerts).toBeGreaterThan(0);
    expect(first.raised).toBe(first.alerts);
    const bell = (await listNotifications('director')).filter((n) => n.title.startsWith('Indicator alert'));
    expect(bell).toHaveLength(first.alerts);
    expect((await runIndicatorAlerts('2026-09-25')).raised).toBe(0);
    // An alert that cleared (its open row renamed by a run without it) is told again when it comes back.
    const db = await getDb();
    const director = await userOf('director');
    const [row] = await db.select().from(reminderSends).where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.personId, director.personId)));
    await db.update(reminderSends).set({ occurrence: 'cleared:2026-09-24' }).where(and(eq(reminderSends.kind, 'alert'), eq(reminderSends.itemKey, row.itemKey)));
    const again = await runIndicatorAlerts('2026-09-25');
    expect(again.raised).toBe(1);
    // Internal recipients only.
    expect((await listNotifications('client')).filter((n) => n.title.startsWith('Indicator alert'))).toEqual([]);
    const rows = await db.select({ kind: reminderSends.kind }).from(reminderSends).where(inArray(reminderSends.kind, ['alert']));
    expect(rows.length).toBeGreaterThan(0);
  }, 120_000);
});
