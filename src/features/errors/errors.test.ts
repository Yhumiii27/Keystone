// R-176 — error and "page not found" pages: incident identifiers (server digest shown as is, browser "C-…" identifiers
// validated and reported to the server log), the pages rendered in French by default and in English, the root, shell and
// global error boundaries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'pm' as RoleKey, lang: 'fr' as 'en' | 'fr' };
vi.mock('next/font/google', () => ({ Inter: () => ({ variable: 'font-inter', className: 'font-inter' }) }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }), getViewer: async () => PERSONA_BY_ROLE[state.role] };
});

import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShellError from '@/app/(app)/error';
import ShellNotFound from '@/app/(app)/not-found';
import RootError from '@/app/error';
import GlobalError from '@/app/global-error';
import RootNotFound from '@/app/not-found';
import { I18nProvider } from '@/i18n/client';
import { RATE_LIMITS, resetRateLimits } from '@/server/http/request-guard';
import { reportClientIncidentAction } from './actions';
import { NotFoundPage } from './not-found-page';
import { CLIENT_INCIDENT_RE, newClientIncidentId, parseClientIncident, serverIncidentOf } from './incident';

const inLang = (lang: 'fr' | 'en', el: ReactElement) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const serverError = () => Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '2338012040' });

beforeEach(() => {
  state.lang = 'fr';
  state.role = 'pm';
  resetRateLimits();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('incident identifiers', () => {
  it('browser identifiers: "C-" + 8 hex digits, random', () => {
    const a = newClientIncidentId();
    expect(a).toMatch(CLIENT_INCIDENT_RE);
    expect(newClientIncidentId()).not.toBe(a);
  });

  it("server errors keep Next's digest; anything else has none", () => {
    expect(serverIncidentOf(serverError())).toBe('2338012040');
    expect(serverIncidentOf(new Error('client'))).toBeNull();
    expect(serverIncidentOf({ digest: '<script>' })).toBeNull();
    expect(serverIncidentOf({ digest: 42 })).toBeNull();
    expect(serverIncidentOf(null)).toBeNull();
  });

  it('a browser report is validated: identifier format, path without query, single-line bounded message', () => {
    expect(parseClientIncident({ incident: 'C-0a1b2c3d', message: 'Boom\nat x', path: '/projects/HLT-026/plan?tab=x#a' }))
      .toEqual({ incident: 'C-0a1b2c3d', message: 'Boom at x', path: '/projects/HLT-026/plan' });
    expect(parseClientIncident({ incident: 'C-0a1b2c3d', message: 'x'.repeat(1000), path: '/' })?.message).toHaveLength(300);
    expect(parseClientIncident({ incident: 'C-0a1b2c3d', path: '/' })).toEqual({ incident: 'C-0a1b2c3d', message: '', path: '/' });
    expect(parseClientIncident({ incident: 'C-XYZ', message: '', path: '/' })).toBeNull();
    expect(parseClientIncident({ incident: '2338012040', message: '', path: '/' })).toBeNull();
    expect(parseClientIncident({ incident: 'C-0a1b2c3d', message: '', path: 'https://evil.example/' })).toBeNull();
    expect(parseClientIncident('C-0a1b2c3d')).toBeNull();
    expect(parseClientIncident(null)).toBeNull();
  });

  it('the report Server Function writes one JSON line to the server log, refuses bad input and floods', async () => {
    // The server logger (R-009) writes JSON in production; LOG_FORMAT forces it here.
    vi.stubEnv('LOG_FORMAT', 'json');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await reportClientIncidentAction({ incident: 'C-0a1b2c3d', message: 'Cannot read x', path: '/resources/what-if' })).toEqual({ ok: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      level: 'error', msg: 'Browser error', component: 'error-page', incident: 'C-0a1b2c3d', path: '/resources/what-if', message: 'Cannot read x', role: 'pm',
    });
    expect(await reportClientIncidentAction({ incident: 'nope', message: '', path: '/' })).toEqual({ ok: false });
    for (let i = 1; i < RATE_LIMITS.report.limit; i++) await reportClientIncidentAction({ incident: 'C-0a1b2c3d', message: '', path: '/' });
    expect(await reportClientIncidentAction({ incident: 'C-0a1b2c3d', message: '', path: '/' })).toEqual({ ok: false });
    expect(log).toHaveBeenCalledTimes(RATE_LIMITS.report.limit);
  });
});

describe('error pages', () => {
  it('screen error inside the shell — French by default: title, text, incident ID, Try again, Back to Home', () => {
    const html = inLang('fr', h(ShellError, { error: serverError(), retry: () => {} }));
    expect(text(html)).toBe(
      'Incident Une erreur est survenue Keystone n’a pas pu afficher cette page. Réessayez ; si le problème persiste, communiquez l’identifiant d’incident au service informatique. Identifiant d’incident 2338012040 Réessayer Retour à l’accueil',
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('Server Components render');
  });

  it('English; a browser error shows its identifier once mounted (none in the server HTML)', () => {
    const html = inLang('en', h(RootError, { error: new Error('x is undefined'), retry: () => {} }));
    expect(text(html)).toBe('Incident Something went wrong Keystone could not display this page. Try again; if the problem persists, give the incident ID to IT. Try again Back to Home');
    expect(html).not.toContain('x is undefined');
  });

  it('global error renders its own document, French by default', () => {
    const html = renderToStaticMarkup(h(GlobalError, { error: serverError(), retry: () => {} }));
    expect(html.startsWith('<html lang="fr" class="font-inter">')).toBe(true);
    expect(html).toContain('<title>Keystone PM</title>');
    expect(text(html)).toContain('Une erreur est survenue');
    expect(text(html)).toContain('Identifiant d’incident 2338012040');
  });
});

describe('page not found', () => {
  it('inside the shell and outside, in French by default', async () => {
    for (const [page, layout] of [[ShellNotFound, 'shell'], [RootNotFound, 'page']] as const) {
      const el = page() as ReactElement<{ layout: string }>;
      expect([el.type, el.props.layout]).toEqual([NotFoundPage, layout]);
      const html = renderToStaticMarkup(await NotFoundPage({ layout }));
      expect(text(html)).toBe('Erreur 404 Page introuvable Cette adresse ne correspond à aucune page de Keystone, ou ce qu’elle désignait n’existe plus. Retour à l’accueil');
      expect(html).toContain('href="/"');
    }
  });

  it('in English', async () => {
    state.lang = 'en';
    const html = renderToStaticMarkup(await NotFoundPage({ layout: 'page' }));
    expect(text(html)).toBe('Error 404 Page not found This address matches no Keystone page, or what it pointed to no longer exists. Back to Home');
  });
});
