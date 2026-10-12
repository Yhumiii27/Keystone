// Delivery 8, R-168: the sign-in audit rows (area "Sign-in", users.ts) carry the user that signed in, the roles and department
// before / after when they change, and their system message (R-184); a refused sign-in names no user.
import { desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries } from '@/server/db/schema';
import { recordActiveRole, recordSignOut, signInUser } from './users';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const last = async () => (await (await getDb()).select().from(auditEntries).where(eq(auditEntries.area, 'Sign-in')).orderBy(desc(auditEntries.occurredAt)).limit(1))[0];

describe('R-168: sign-in audit rows', () => {
  it('an Entra sign-in names its user, with the roles before / after; sign-out and role switch too', async () => {
    const r = await signInUser({ oid: 'oid-romain-d8', email: 'romain.aubert@epc2i.fr', roles: ['director', 'pm'], at: new Date('2026-10-01T08:00:00Z') });
    expect(r.ok).toBe(true);
    const userId = r.ok ? r.account.userId : '';
    expect(await last()).toMatchObject({
      actorName: 'Romain Aubert', actorUserId: userId, change: 'Signed in · Portfolio director / Project manager', messageKey: 'signin.signedIn',
      messageParams: { roles: ['Portfolio director', 'Project manager'] }, before: { roles: ['pm'] }, after: { roles: ['director', 'pm'] },
    });
    // Signing in again with the same roles changes nothing: no before / after.
    await signInUser({ oid: 'oid-romain-d8', email: 'romain.aubert@epc2i.fr', roles: ['director', 'pm'], at: new Date('2026-10-01T09:00:00Z') });
    expect(await last()).toMatchObject({ actorUserId: userId, before: null, after: null });
    await recordActiveRole(userId, 'director', 'pm');
    expect(await last()).toMatchObject({ actorUserId: userId, change: 'Active role · Portfolio director → Project manager', messageKey: 'signin.activeRole', before: { activeRole: 'director' }, after: { activeRole: 'pm' } });
    await recordSignOut(userId);
    expect(await last()).toMatchObject({ actorUserId: userId, change: 'Signed out', messageKey: 'signin.signedOut' });
  });

  it('a refused sign-in names the token e-mail and no user', async () => {
    const r = await signInUser({ oid: 'oid-nobody-d8', email: 'nobody@epc2i.fr', roles: ['director'], at: new Date('2026-10-02T08:00:00Z') });
    expect(r).toEqual({ ok: false, reason: 'unknown_user' });
    const [row] = await (await getDb()).select().from(auditEntries).where(eq(auditEntries.actorName, 'nobody@epc2i.fr'));
    expect(row).toMatchObject({ actorName: 'nobody@epc2i.fr', actorUserId: null, actorPersonId: null, change: 'Sign-in refused · Unknown e-mail', messageKey: 'signin.refused' });
  });
});
