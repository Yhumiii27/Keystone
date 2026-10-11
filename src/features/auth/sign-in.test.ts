// Sign-in page and account menu (R-038) — static render: the page shows the refusal message in French by default and
// a plain link to the sign-in route (with a safe return path), goes Home in demo mode or when already signed in; the
// sidebar shows the account menu instead of "View as" in Entra mode.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, refresh() {} }),
}));
vi.mock('@/server/auth/viewer', () => ({ entraViewer: async () => (jar.has('signed-in') ? { role: 'pm' } : null) }));
vi.mock('@/server/actions/auth', () => ({ setActiveRole: async () => undefined }));
vi.mock('@/server/actions/preferences', () => ({ setViewAs: async () => undefined, setNavOpen: async () => {} }));

import SignInPage from '@/app/sign-in/page';
import { AccountMenu } from '@/components/app/shell/account-menu';
import { I18nProvider } from '@/i18n/client';
import { ENTRA_ENV } from '@/test/mock-entra';

const render = async (sp: Record<string, string>) => renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  jar.clear();
  for (const [k, v] of Object.entries(ENTRA_ENV)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe('sign-in page', () => {
  it('explains a refusal in French and links to the Microsoft sign-in', async () => {
    const html = await render({ error: 'unknown_user' });
    expect(html).toContain('Votre adresse e-mail n’est pas enregistrée dans Keystone');
    expect(html).toContain('Connexion à Keystone');
    expect(html).toContain('href="/api/auth/sign-in"');
    expect(html).toContain('Se connecter avec Microsoft');
    expect(html).toContain('role="alert"');
  });

  it('shows the generic failure for an unknown code, never the raw parameter', async () => {
    const html = await render({ error: '<img src=x>' });
    expect(html).toContain('La connexion a échoué');
    expect(html).not.toContain('<img');
  });

  it('confirms the sign-out and keeps a safe return path only', async () => {
    jar.set('ks-lang', 'en');
    const html = await render({ signedOut: '1', returnTo: '/portfolio?zone=afr' });
    expect(html).toContain('You are signed out.');
    expect(html).toContain('href="/api/auth/sign-in?returnTo=%2Fportfolio%3Fzone%3Dafr"');
    expect(await render({ signedOut: '1', returnTo: 'https://evil.test' })).toContain('href="/api/auth/sign-in"');
  });

  it('goes Home in demo mode and when already signed in', async () => {
    vi.stubEnv('KEYSTONE_AUTH', 'demo');
    await expect(render({})).rejects.toThrow('REDIRECT:/');
    vi.stubEnv('KEYSTONE_AUTH', 'entra');
    jar.set('signed-in', '1');
    await expect(render({})).rejects.toThrow('REDIRECT:/');
    expect(await render({ error: 'session' })).toContain('Votre session a pris fin');
  });
});

describe('account menu', () => {
  it('shows the signed-in user and the active role (several roles) in French', () => {
    const account = { name: 'Marion Kerviel', title: 'Head of engineering', initials: 'MK', role: 'quality' as const, roles: [{ role: 'depthead' as const, label: 'Head of department' }, { role: 'quality' as const, label: 'Quality manager' }] };
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(AccountMenu, { account }) }));
    expect(html).toContain('Marion Kerviel');
    expect(html).toContain('Responsable qualité');
    const single = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(AccountMenu, { account: { ...account, role: 'depthead', roles: [account.roles[0]] } }) }));
    expect(single).toContain('Responsable ingénierie'); // one role: the job title
  });
});
