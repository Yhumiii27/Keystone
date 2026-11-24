import 'server-only';
// The signed-in viewer in Entra mode (R-038/R-039): the sealed session cookie names the user and the active role; the
// user is re-read from the database on every request (memoised per request by getViewer), so deactivating a user,
// relinking the Microsoft account or removing a role takes effect at once. Loaded by getViewer() only when
// KEYSTONE_AUTH=entra (dynamic import), so the demo mode never touches it.
import { cookies } from 'next/headers';
import type { Persona } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { activeRoleOf, rolesFromClavisAccess, userTitle } from '@/domain/auth';
import { getUserAccount, type UserAccount } from '@/server/dal/users';
import { readClavisAccess } from '@/server/integrations/clavis/access';
import { accessFromClavis, sessionConfig } from './config';
import { readSession, type SessionData } from './session-cookie';

/** The viewer of a user account in its active role (same shape as the demo personas). */
export function viewerOfAccount(a: UserAccount, role: RoleKey): Persona {
  return {
    role, roles: a.roles, name: a.fullName ?? a.shortName, title: a.title, initials: a.initials, short: a.shortName, email: a.email,
    department: a.department, personId: a.personId, userId: a.userId,
  };
}

/** The session of this request (cookie only; null when absent, tampered with or expired). */
export async function currentSession(): Promise<SessionData | null> {
  const cfg = sessionConfig();
  return readSession(cfg, (await cookies()).get(cfg.cookieName)?.value);
}

/** The signed-in viewer, or null: no valid session, unknown or deactivated user, other Microsoft account, no role left. */
export async function entraViewer(): Promise<Persona | null> {
  const s = await currentSession();
  if (!s) return null;
  const a = await getUserAccount(s.uid);
  if (!a || !a.active || a.entraObjectId !== s.oid) return null;
  // One database (KEYSTONE_ACCESS_FROM_CLAVIS): the rights IT sets in Clavis are read on every request, so a withdrawn
  // access or a changed role applies at the next page. A failed read refuses (fail closed).
  if (accessFromClavis()) {
    let roles: RoleKey[];
    try {
      roles = rolesFromClavisAccess(await readClavisAccess(s.oid));
    } catch (e) {
      console.error('[auth] clavis.pub_acces not read:', e instanceof Error ? e.message : e);
      return null;
    }
    const held = activeRoleOf(roles, s.role);
    // The title stored at sign-in names the role held then: follow the role Clavis grants now.
    return held ? viewerOfAccount({ ...a, roles, title: userTitle(a.jobTitle, roles) }, held) : null;
  }
  const role = activeRoleOf(a.roles, s.role);
  return role ? viewerOfAccount(a, role) : null;
}
