import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { DEFAULT_ROLE, PERSONA_BY_ROLE, isRole, type Persona } from '@/config/personas';
import { AUTH_PATHS } from '@/domain/auth';
import { authMode } from '@/server/auth/config';
import { DEFAULT_PROJECT } from '@/config/screens';
import { DEFAULT_LANG, makeT, type Lang, type T } from '@/i18n/translate';

/** Cookie names for user preferences (stand-in until real users/preferences exist in the DB). */
export const COOKIE = {
  role: 'ks-role',
  lang: 'ks-lang',
  nav: 'ks-nav',
  project: 'ks-project',
  zone: 'ks-zone',
} as const;

export type ZoneKey = 'euna' | 'afr' | 'apac';

/** The person using Keystone: a demo persona or a signed-in user (same shape, R-039). */
export type Viewer = Persona;

/**
 * Current viewer (docs/spec/00 §8.12, R-038). Demo mode (KEYSTONE_AUTH=demo, the default): the "View as" persona of
 * the `ks-role` cookie, the director when none — exactly as before. Entra mode: the signed-in user, re-read from the
 * database on every request (sealed session cookie → active user → active role); without a valid session the request
 * is sent to the sign-in page (the proxy normally redirects first — this is the server-side check).
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (authMode() === 'entra') {
    const { entraViewer } = await import('@/server/auth/viewer');
    const v = await entraViewer();
    if (!v) redirect(`${AUTH_PATHS.page}?error=session`);
    return v;
  }
  const v = (await cookies()).get(COOKIE.role)?.value;
  return PERSONA_BY_ROLE[isRole(v) ? v : DEFAULT_ROLE];
});

export const getLang = cache(async (): Promise<Lang> => {
  const v = (await cookies()).get(COOKIE.lang)?.value;
  return v === 'en' || v === 'fr' ? v : DEFAULT_LANG;
});

/** `{ lang, t }` for Server Components. */
export const getI18n = cache(async (): Promise<{ lang: Lang; t: T }> => {
  const lang = await getLang();
  return { lang, t: makeT(lang) };
});

/** Sidebar open/closed map (`navOpen`, persisted). Keys: section keys and 'sub:<group label>'. */
export const getNavOpen = cache(async (): Promise<Record<string, boolean>> => {
  try {
    return JSON.parse((await cookies()).get(COOKIE.nav)?.value ?? '{}');
  } catch {
    return {};
  }
});

/** Last project used (for links to project-scoped screens from global pages). */
export const getLastProject = cache(async (): Promise<string> => (await cookies()).get(COOKIE.project)?.value ?? DEFAULT_PROJECT);

export const getZone = cache(async (): Promise<ZoneKey | null> => {
  const v = (await cookies()).get(COOKIE.zone)?.value;
  return v === 'euna' || v === 'afr' || v === 'apac' ? v : null;
});
