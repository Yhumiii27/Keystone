// R-199 on the demo database (business date Fri 25 Sep 2026, KEYSTONE_CLOCK of vitest.config.ts): the due items Keystone
// reminds, the daily job (one bell notice and one e-mail per person, idempotent), the windows over the following days, the
// preferences (own and company default, through the Server Functions), the rights (a client only what their portal shows), the
// weekly reports (status report PDF to the leads, portfolio workbook to the directors), the file transport's .eml files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { meetingAgendaPoints, meetingLines, meetings, persons, reminderSends, sitePrerequisites, users } from '@/server/db/schema';
import { getMyReminderPreferencesAction, saveMyReminderPreferencesAction, saveReminderDefaultsAction } from '@/server/actions/reminders';
import { JOB_DEFINITIONS, jobDefinition } from '@/server/jobs/definitions';
import { jobDailyAt } from '@/server/jobs/runner';
import { COOKIE } from '@/server/session';
import { listActivity, listAudit, listNotifications } from './notifications';
import { readReminderDefaults, saveUserReminderPrefs } from './reminder-preferences';
import { collectDueItems, receiveRule, recipientsOf, runDeadlineReminders } from './reminders';
import { runScheduledReports } from './scheduled-reports';
import type { DueItem } from '@/domain/reminders';

let dir: string;
const as = (role: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};
const files = () => fs.readdirSync(dir).filter((f) => f.endsWith('.eml')).sort();
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
/** The decoded text part of an .eml (base64 bodies). */
function textOf(raw: string): string {
  const b = /boundary="([^"]+)"/.exec(raw)?.[1];
  const part = b ? raw.split(`--${b}`)[1] : raw;
  const body = part.split('\r\n\r\n').slice(1).join('').trim();
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}
const userOf = async (persona: string) => {
  const [u] = await (await getDb()).select({ id: users.id, personId: users.personId }).from(users).where(eq(users.personaRole, persona));
  return u;
};
const sendsOf = async (personId: string) => (await getDb()).select().from(reminderSends).where(eq(reminderSends.personId, personId));

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-r199-'));
}, 60_000);
beforeEach(() => {
  as('director');
  vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'file');
  vi.stubEnv('KEYSTONE_MAIL_DIR', dir);
  vi.stubEnv('KEYSTONE_MAIL_FROM', 'Keystone <keystone@epc2i.fr>');
  vi.stubEnv('KEYSTONE_PUBLIC_URL', 'https://keystone.epc2i.fr');
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('due items (demo data set)', () => {
  it('tasks, plan activities, milestones, deliverables, meeting actions and client prerequisites, each with its responsible persons', async () => {
    const items = await collectDueItems('2026-09-25');
    expect(items).toHaveLength(53);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['task', 'activity', 'milestone', 'deliverable', 'meeting_action']));
    expect(items.find((i) => i.ref === 'T-2305')).toMatchObject({ kind: 'task', projectCode: 'HLT-026', dueOn: '2026-09-25', screen: 'task', params: { taskId: 'T-2305' } });
    expect(items.find((i) => i.ref === 'D-017')).toMatchObject({ kind: 'deliverable', dueOn: '2026-09-30', screen: 'quality', params: { qTab: 'dlv', dlv: 'D-017' } });
    expect(items.find((i) => i.ref === 'A2520')).toMatchObject({ kind: 'activity', projectCode: 'RCF-019', screen: 'plan', params: { sel: 'A2520' } });
    expect(items.find((i) => i.ref === 'A2520')!.personIds).toHaveLength(2);
    // A milestone: the PM of record, at the date the schedule draws.
    expect(items.find((i) => i.kind === 'milestone')).toMatchObject({ projectCode: 'HLT-026', ref: 'Structure topped out', dueOn: '2026-10-23', screen: 'schedule' });
    // A client prerequisite pending: the PM of record, from J-30 (the largest offset a person may choose).
    expect((await collectDueItems('2026-10-20')).find((i) => i.kind === 'prerequisite')).toMatchObject({ projectCode: 'HLT-026', ref: 'A1320', dueOn: '2026-11-02', screen: 'site' });
    // Nothing older than 30 days overdue, nothing done.
    expect(items.every((i) => i.dueOn >= '2026-08-26' && i.dueOn <= '2026-10-25')).toBe(true);
  });
});

describe('the daily job', () => {
  it('a reminder job at the reminders hour; the first run: one bell notice and one French e-mail per person; a second run sends nothing', async () => {
    expect(jobDailyAt(jobDefinition('deadline-reminders'))).toBe('07:00');
    expect(jobDailyAt(jobDefinition('scheduled-reports'))).toBe('07:00');
    expect(JOB_DEFINITIONS.map((d) => d.name)).toEqual(expect.arrayContaining(['deadline-reminders', 'scheduled-reports']));
    const before = (await listNotifications('member')).length;
    expect(await jobDefinition('deadline-reminders').run()).toMatchObject({
      counts: { items: 53, reminders: 10, persons: 3, emailed: 3, emailFailed: 0, emailSkipped: 0 }, warn: false,
    });
    const mine = await listNotifications('member');
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]).toMatchObject({ kind: 'alert', title: 'Deadline reminder', sub: 'HLT-026 T-2298 · HLT-026 T-2305 · HLT-026 T-2320 · +1', screen: 'mywork', read: false });
    expect(files()).toHaveLength(3);
    const julien = files().find((f) => f.includes('julien-wagner'))!;
    const raw = read(julien);
    expect(raw).toContain('To: "Julien Wagner" <julien.wagner@epc2i.fr>');
    const body = textOf(raw);
    expect(body).toContain('Bonjour Julien Wagner,');
    expect(body).toContain('Vos échéances dans Keystone · 25 sept.');
    expect(body).toContain('- HLT-026 · T-2298 ·');
    expect(body).toContain('  Tâche · échéance 24 sept. · 1 j de retard');
    expect(body).toContain('  https://keystone.epc2i.fr/my/tasks/T-2298');
    expect(body).toContain('  Action de réunion · échéance 1 oct. · dans 6 j');
    expect(body).toContain('  https://keystone.epc2i.fr/projects/HLT-026/meetings?meeting=MTG-118');
    expect(body).toContain('Ouvrir Keystone: https://keystone.epc2i.fr/my/tasks');
    const { personId } = (await userOf('member'))!;
    expect((await sendsOf(personId)).map((r) => [r.itemKey.split(':')[0], r.slot, r.emailStatus, !!r.notificationCode]).sort()).toEqual([
      ['meeting_action', 'J-7', 'sent', true], ['task', 'J-1', 'sent', true], ['task', 'J-7', 'sent', true], ['task', 'overdue', 'sent', true],
    ]);
    // Idempotent: the same day again (a restart, a second worker) — nothing.
    expect(await runDeadlineReminders('2026-09-25')).toMatchObject({ items: 53, reminders: 0, persons: 0 });
    expect(files()).toHaveLength(3);
    expect(await listNotifications('member')).toHaveLength(before + 1);
  }, 60_000);

  it('the windows move with the business date: J-1 after J-7, overdue once, each sent once', async () => {
    const r = await runDeadlineReminders('2026-09-28');
    expect(r.reminders).toBeGreaterThan(0);
    const { personId } = (await userOf('member'))!;
    const rows = (await sendsOf(personId)).filter((x) => x.runOn === '2026-09-28');
    // T-2305 (due 25 Sep): J-1 on the 25th, overdue now; T-2320 (due 29 Sep): J-7 on the 25th, J-1 now.
    const keyed = await Promise.all(rows.map(async (x) => x.slot));
    expect(keyed).toEqual(expect.arrayContaining(['overdue', 'J-1']));
    expect((await runDeadlineReminders('2026-09-28')).reminders).toBe(0);
  }, 60_000);
});

describe('preferences', () => {
  it('a person turns the e-mail off: the bell notice still comes, no e-mail; fewer offsets, fewer reminders', async () => {
    const fabien = (await userOf('procurement'))!;
    await saveUserReminderPrefs(fabien.id, { emailReminders: false, emailReports: true, offsets: [1], overdue: true }, { name: 'Fabien Bertrand', role: 'procurement' });
    const fabienFiles = () => files().filter((f) => f.includes('fabien-bertrand')).length;
    const n = fabienFiles();
    const before = (await listNotifications('procurement')).length;
    await runDeadlineReminders('2026-09-30');
    const rows = (await sendsOf(fabien.personId)).filter((x) => x.runOn === '2026-09-30');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.emailStatus === 'off' && x.slot !== 'J-7')).toBe(true);
    expect(await listNotifications('procurement')).toHaveLength(before + 1);
    expect(fabienFiles()).toBe(n);
  }, 60_000);

  it('the Server Functions: each viewer their own choices (audit with before / after), back to the default; the director sets the default', async () => {
    as('member');
    expect(await getMyReminderPreferencesAction()).toEqual({
      values: { emailReminders: 'on', emailReports: 'on', offsets: '7,1', overdue: 'on', apply: 'default' }, own: false,
      defaults: { emailReminders: 'on', emailReports: 'on', offsets: '7,1', overdue: 'on' }, transport: 'file',
    });
    expect(await saveMyReminderPreferencesAction({ apply: 'own', emailReminders: 'off', emailReports: 'on', offsets: '3,1', overdue: 'on' })).toEqual({ ok: true, toast: 'Preferences saved' });
    expect((await getMyReminderPreferencesAction())!.values).toEqual({ emailReminders: 'off', emailReports: 'on', offsets: '3,1', overdue: 'on', apply: 'own' });
    const [audit] = await listAudit({ limit: 1 });
    expect(audit).toMatchObject({
      who: 'Julien Wagner', object: 'Reminders & reports', area: 'My preferences', change: 'e-mail reminders off · e-mail reports on · J-3 · J-1 · overdue',
      before: { emailReminders: true, offsets: 'J-7 · J-1' }, after: { emailReminders: false, offsets: 'J-3 · J-1' },
    });
    for (const bad of [null, 'x', { apply: 'own', emailReminders: 'off', emailReports: 'on', offsets: '99', overdue: 'on' }, { apply: 'other' }])
      expect(await saveMyReminderPreferencesAction(bad)).toEqual({ error: 'Invalid preferences' });
    expect(await saveMyReminderPreferencesAction({ apply: 'default' })).toEqual({ ok: true, toast: 'Preferences saved' });
    expect((await getMyReminderPreferencesAction())!.own).toBe(false);

    // The company default: the portfolio director only (A-14).
    const valid = { emailReminders: 'on', emailReports: 'off', offsets: '14,7,1', overdue: 'off' };
    expect(await saveReminderDefaultsAction(valid)).toEqual({ error: 'Settings are read-only for you' });
    as('pm');
    expect(await saveReminderDefaultsAction(valid)).toEqual({ error: 'Settings are edited by the portfolio director' });
    as('director');
    expect(await saveReminderDefaultsAction({ ...valid, offsets: 'soon' })).toEqual({ error: 'Invalid preferences' });
    expect(await saveReminderDefaultsAction(valid)).toEqual({ ok: true, toast: 'Default saved' });
    expect(await readReminderDefaults()).toEqual({ emailReminders: true, emailReports: false, offsets: [14, 7, 1], overdue: false });
    expect((await listActivity({ limit: 1 }))[0].what).toBe('Reminders & reports default · e-mail reminders on · e-mail reports off · J-14 · J-7 · J-1');
    // A user without their own choice follows the new default.
    as('member');
    expect((await getMyReminderPreferencesAction())!.values).toMatchObject({ offsets: '14,7,1', emailReports: 'off', apply: 'default' });
    as('director');
    await saveReminderDefaultsAction({ emailReminders: 'on', emailReports: 'on', offsets: '7,1', overdue: 'on' });
  }, 60_000);
});

describe('rights', () => {
  it('a client receives only what their portal shows: deliverables of their projects, actions of external meetings — never a task or an internal meeting', async () => {
    const db = await getDb();
    const [nadia] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Nadia Bensaïd'));
    const r = (await recipientsOf([nadia.id])).get(nadia.id)!;
    expect(r.roles).toEqual(['client']);
    const may = await receiveRule();
    const item = (over: Partial<DueItem>): DueItem => ({ kind: 'task', id: 'x', projectCode: 'HLT-026', ref: 'R', title: 'T', dueOn: '2026-09-30', personIds: [nadia.id], screen: 'task', params: {}, ...over });
    expect(may(r, item({ kind: 'deliverable', screen: 'quality', params: { qTab: 'dlv', dlv: 'D-017' } }))).toBe(true);
    expect(may(r, item({ kind: 'deliverable', projectCode: 'NDC-031', screen: 'quality', params: { qTab: 'dlv', dlv: 'D-110' } }))).toBe(false);
    expect(may(r, item({ kind: 'task', params: { taskId: 'T-2305' } }))).toBe(false);
    expect(may(r, item({ kind: 'meeting_action', screen: 'meetings', params: { meeting: 'MTG-118' }, meetingType: 'internal' }))).toBe(false);
    expect(may(r, item({ kind: 'meeting_action', screen: 'meetings', params: { meeting: 'MTG-118' }, meetingType: 'external' }))).toBe(true);
    // An internal role receives every item of a running project (read-only outside its team).
    const julien = (await recipientsOf([(await userOf('member'))!.personId])).values().next().value!;
    expect(may(julien, item({ projectCode: 'NDC-031' }))).toBe(true);

    // End to end: an action of an internal meeting given to the client is not reminded to her.
    const [line] = await db.select({ id: meetingLines.id }).from(meetingLines)
      .innerJoin(meetingAgendaPoints, eq(meetingAgendaPoints.id, meetingLines.agendaPointId)).innerJoin(meetings, eq(meetings.id, meetingAgendaPoints.meetingId))
      .where(and(eq(meetings.number, 'MTG-118'), eq(meetingLines.type, 'action'), eq(meetingLines.done, false)));
    await db.update(meetingLines).set({ ownerPersonId: nadia.id, dueDate: '2026-10-05', taskId: null }).where(eq(meetingLines.id, line.id));
    await runDeadlineReminders('2026-10-01');
    expect((await sendsOf(nadia.id)).filter((x) => x.itemKey === `meeting_action:${line.id}`)).toEqual([]);
  }, 60_000);
});

describe('weekly reports', () => {
  it('Monday: the status report PDF to the project leads, the portfolio workbook to the directors; once a week', async () => {
    const pmBefore = (await listNotifications('pm')).length;
    const n = files().length;
    const r = await runScheduledReports('2026-09-28', new Date('2026-09-28T05:00:00Z'));
    expect(r).toEqual({ today: '2026-09-28', period: '2026-W40', projects: 1, reports: 2, emailed: 2, emailFailed: 0, emailSkipped: 0 });
    const pm = await listNotifications('pm');
    expect(pm).toHaveLength(pmBefore + 1);
    expect(pm[0]).toMatchObject({ kind: 'request', title: 'Weekly status report', sub: 'HLT-026 · 2026-W40', screen: 'trends', projectCode: 'HLT-026' });
    expect((await listNotifications('director'))[0]).toMatchObject({ title: 'Weekly portfolio report', screen: 'overview' });
    const fresh = files().slice(0).filter((f) => !fs.statSync(path.join(dir, f)).isDirectory());
    expect(fresh.length).toBe(n + 2);
    const romain = read(fresh.find((f) => f.includes('romain-aubert') && read(f).includes('application/pdf'))!);
    expect(romain).toContain('Content-Type: application/pdf; name="status-report-HLT-026-2026-09-28.pdf"');
    const body = textOf(romain);
    expect(body).toContain('Bonjour Romain Aubert,');
    expect(body).toContain('Rapport d’avancement hebdomadaire · HLT-026 ·');
    expect(body).toContain('Pièce jointe: status-report-HLT-026-2026-09-28.pdf');
    expect(body).toContain('Ouvrir dans Keystone: https://keystone.epc2i.fr/projects/HLT-026/trends');
    // The PDF itself, base64 in the message.
    const pdf = Buffer.from(romain.split('Content-Disposition: attachment; filename="status-report-HLT-026-2026-09-28.pdf"\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const director = read(files().find((f) => read(f).includes('spreadsheetml'))!);
    expect(director).toContain('name="portfolio-overview-2026-09-28.xlsx"');
    expect(textOf(director)).toContain('Rapport de portefeuille hebdomadaire · Portefeuille · 2026-W40');
    // The rest of the week: nothing; the next Monday: again.
    expect((await runScheduledReports('2026-10-01')).reports).toBe(0);
    expect((await runScheduledReports('2026-10-05')).reports).toBe(2);
  }, 120_000);

  it('a lead with e-mail reports off gets the bell notice only', async () => {
    const romain = (await userOf('pm'))!;
    await saveUserReminderPrefs(romain.id, { emailReminders: true, emailReports: false, offsets: [7, 1], overdue: true }, { name: 'Romain Aubert', role: 'pm' });
    await runScheduledReports('2026-10-12');
    const [row] = (await sendsOf(romain.personId)).filter((x) => x.occurrence === '2026-W42');
    expect(row).toMatchObject({ kind: 'report', itemKey: 'project_weekly:HLT-026', emailStatus: 'off' });
    expect(row.notificationCode).toMatch(/^n\d+$/);
  }, 120_000);
});

describe('no transport (the default)', () => {
  it('the bell only: the rows say no_transport, no file', async () => {
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', '');
    const db = await getDb();
    await db.update(sitePrerequisites).set({ neededBy: '2026-10-22' }).where(eq(sitePrerequisites.activityCode, 'A1320'));
    const n = files().length;
    await runDeadlineReminders('2026-10-20');
    const romain = (await userOf('pm'))!;
    const rows = (await sendsOf(romain.personId)).filter((x) => x.runOn === '2026-10-20');
    expect(rows.some((x) => x.itemKey.startsWith('prerequisite:'))).toBe(true);
    expect(rows.every((x) => x.emailStatus === 'no_transport')).toBe(true);
    expect(files()).toHaveLength(n);
  }, 60_000);
});
