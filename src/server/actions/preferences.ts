'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRole } from '@/config/personas';
import { COOKIE, type ZoneKey } from '@/server/session';

const YEAR = 60 * 60 * 24 * 365;

/** "View as": switch persona and land on Home (prototype: {role, screen:'home'}). */
export async function setViewAs(role: string) {
  if (!isRole(role)) return;
  (await cookies()).set(COOKIE.role, role, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  redirect('/');
}

export async function setLanguage(lang: string) {
  if (lang !== 'fr' && lang !== 'en') return;
  (await cookies()).set(COOKIE.lang, lang, { path: '/', maxAge: YEAR, sameSite: 'lax' });
}

export async function setNavOpen(map: Record<string, boolean>) {
  (await cookies()).set(COOKIE.nav, JSON.stringify(map), { path: '/', maxAge: YEAR, sameSite: 'lax' });
}

export async function setLastProject(code: string) {
  (await cookies()).set(COOKIE.project, code, { path: '/', maxAge: YEAR, sameSite: 'lax' });
}

export async function setZone(zone: ZoneKey | null) {
  const c = await cookies();
  if (zone) c.set(COOKIE.zone, zone, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  else c.delete(COOKIE.zone);
}
