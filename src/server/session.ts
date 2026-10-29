import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { DEFAULT_ROLE, PERSONA_BY_ROLE, isRole, type Persona } from '@/config/personas';
import { AUTH_PATHS } from '@/domain/auth';
import { authMode } from '@/server/auth/config';
import { DEFAULT_PROJECT } from '@/config/screens';
import { resolveCurrentProject } from '@/server/dal/current-project';
import { currentDelegation } from '@/server/delegation-scope';
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
 * R-051 (P-7d): during ONE decision a substitute records on an approver's behalf (`runOnBehalf`, src/server/delegation-scope.ts),
 * the approver — so the module's Server Function applies the approver's rights to that item only.
 */
export const getViewer = async (): Promise<Viewer> => currentDelegation()?.approver ?? signedInViewer();

/** The person signed in (demo persona or Entra user), memoised per request; see getViewer. */
const signedInViewer = cache(async (): Promise<Viewer> => {
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

/**
 * Current project of the global pages (R-011): the last project used when it still exists, else the prototype's default
 * project when the database has it (demo), else the first project of the register; null when there is no project yet. A
 * client only gets a project of their organisation.
 */
export const getCurrentProject = cache(async (): Promise<string | null> =>
  resolveCurrentProject((await cookies()).get(COOKIE.project)?.value ?? null, await getViewer()),
);

/**
 * Last project used, for links to project-scoped screens from global pages: getCurrentProject(), or DEFAULT_PROJECT when
 * the database has no project yet (such links then open the not-found page; screens that need a project read
 * getCurrentProject() and show their empty state).
 */
export const getLastProject = cache(async (): Promise<string> => (await getCurrentProject()) ?? DEFAULT_PROJECT);

export const getZone = cache(async (): Promise<ZoneKey | null> => {
  const v = (await cookies()).get(COOKIE.zone)?.value;
  return v === 'euna' || v === 'afr' || v === 'apac' ? v : null;
});
