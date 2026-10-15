'use server';
// Account Server Functions (R-038/R-039, Entra mode): switching the active role among the roles the signed-in user
// holds. The role is checked against the user's roles in the database (getViewer re-reads them), the sealed session is
// re-issued with the same expiry, the switch is audited, and the user lands on Home like "View as" (prototype
// {role, screen:'home'}). Signing out is the POST route /api/auth/sign-out (it must also end the Microsoft session).
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLE_SWITCH_DEMO, ROLE_SWITCH_REFUSED, isRoleKey } from '@/domain/auth';
import { authMode, sessionConfig } from '@/server/auth/config';
import { cookieOptions, readSession, sealSession } from '@/server/auth/session-cookie';
import { recordActiveRole } from '@/server/dal/users';
import { getI18n, getViewer } from '@/server/session';

export async function setActiveRole(role: string): Promise<{ ok: false; error: string } | undefined> {
  const { t } = await getI18n();
  if (authMode() !== 'entra') return { ok: false, error: t(ROLE_SWITCH_DEMO) };
  const viewer = await getViewer(); // no valid session → redirected to the sign-in page
  if (!isRoleKey(role) || !viewer.userId || !viewer.roles.includes(role)) return { ok: false, error: t(ROLE_SWITCH_REFUSED) };
  const cfg = sessionConfig();
  const jar = await cookies();
  const s = await readSession(cfg, jar.get(cfg.cookieName)?.value);
  if (!s || s.uid !== viewer.userId) return { ok: false, error: t(ROLE_SWITCH_REFUSED) };
  if (role !== viewer.role) {
    // Same issue time → same absolute expiry: switching roles never extends a session.
    const { value, data } = await sealSession(cfg, { uid: s.uid, oid: s.oid, role, iat: s.iat });
    jar.set(cfg.cookieName, value, cookieOptions(cfg, Math.max(0, data.exp - Math.floor(Date.now() / 1000))));
    await recordActiveRole(viewer.userId, viewer.role, role);
    revalidatePath('/', 'layout');
  }
  redirect('/');
}
