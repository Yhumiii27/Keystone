// Sign-in rules (R-038/R-039): roles from Entra app roles and mapped groups, the active role (highest by default), the
// identity e-mail, the sign-in decision (who is refused and why), titles, safe return paths and the public paths.
import { describe, expect, it } from 'vitest';
import {
  AuthConfigError, ROLE_PRIORITY, SIGN_IN_ERROR, SIGN_IN_REFUSAL_LABEL, activeRoleOf, decideSignIn, emailFromClaims, isPublicPath, isRoleKey,
  isSignInError, normaliseEmail, parseGroupRoleMap, roleOfAppRole, rolesFromClaims, safeReturnTo, sortRoles, userTitle, type SignInUser,
} from './auth';

describe('roles', () => {
  it('orders roles from the broadest workspace and drops unknown values', () => {
    expect(ROLE_PRIORITY).toEqual(['director', 'pm', 'depthead', 'englead', 'quality', 'procurement', 'member', 'client']);
    expect(sortRoles(['member', 'pm', 'admin', 'pm', 42, 'director'])).toEqual(['director', 'pm', 'member']);
    expect(isRoleKey('quality')).toBe(true);
    expect(isRoleKey('finance')).toBe(false);
  });

  it('starts in the highest role held, or the preferred one when held', () => {
    expect(activeRoleOf(['quality', 'depthead'])).toBe('depthead');
    expect(activeRoleOf(['quality', 'depthead'], 'quality')).toBe('quality');
    expect(activeRoleOf(['quality'], 'director')).toBe('quality'); // not held → highest
    expect(activeRoleOf([])).toBeNull();
    expect(activeRoleOf(['admin'])).toBeNull();
  });

  it('reads Entra app-role values with or without the application prefix, any case', () => {
    expect(roleOfAppRole('pm')).toBe('pm');
    expect(roleOfAppRole('Keystone.PM')).toBe('pm');
    expect(roleOfAppRole('keystone.Director')).toBe('director');
    expect(roleOfAppRole(' Quality ')).toBe('quality');
    expect(roleOfAppRole('Keystone.Admin')).toBeNull();
    expect(roleOfAppRole('Other.pm')).toBeNull();
    expect(roleOfAppRole(null)).toBeNull();
  });

  it('parses the group → role map and refuses a malformed one', () => {
    expect(parseGroupRoleMap(undefined)).toEqual({});
    expect(parseGroupRoleMap('  ')).toEqual({});
    expect(parseGroupRoleMap('{"AAAA-1": "pm", "bbbb-2": ["Keystone.Quality", "depthead"]}')).toEqual({ 'aaaa-1': ['pm'], 'bbbb-2': ['depthead', 'quality'] });
    expect(() => parseGroupRoleMap('{pm}')).toThrow(AuthConfigError);
    expect(() => parseGroupRoleMap('["pm"]')).toThrow(/JSON object/);
    expect(() => parseGroupRoleMap('{"g": "admin"}')).toThrow(/invalid role for group g/);
    expect(() => parseGroupRoleMap('{"g": []}')).toThrow(AuthConfigError);
  });

  it('grants the token app roles plus the roles of its mapped groups', () => {
    const map = parseGroupRoleMap('{"g-eng": "englead", "g-qual": ["quality", "depthead"]}');
    expect(rolesFromClaims({ roles: ['Keystone.PM', 'Unknown'], groups: ['G-ENG', 'other'] }, map)).toEqual(['pm', 'englead']);
    expect(rolesFromClaims({ groups: ['g-qual'] }, map)).toEqual(['depthead', 'quality']);
    expect(rolesFromClaims({ roles: 'pm' as unknown, groups: null }, map)).toEqual([]);
    expect(rolesFromClaims({})).toEqual([]);
  });
});

describe('identity e-mail', () => {
  it('takes email, else preferred_username, else upn, lower-cased; non-addresses are ignored', () => {
    expect(emailFromClaims({ email: ' Romain.Aubert@EPC2i.fr ', preferred_username: 'x@y.fr' })).toBe('romain.aubert@epc2i.fr');
    expect(emailFromClaims({ preferred_username: 'R.Aubert@epc2i.fr' })).toBe('r.aubert@epc2i.fr');
    expect(emailFromClaims({ preferred_username: 'raubert', upn: 'raubert@epc2i.fr' })).toBe('raubert@epc2i.fr');
    expect(emailFromClaims({ email: 'not an address', preferred_username: '' })).toBeNull();
    // An e-mail its domain owner did not verify is ignored (nOAuth): the UPN identifies the person instead.
    expect(emailFromClaims({ email: 'marie.lefebvre@epc2i.fr', xms_edov: false, preferred_username: 'guest_x.com#EXT#@epc2i.onmicrosoft.com' })).toBe('guest_x.com#ext#@epc2i.onmicrosoft.com');
    expect(emailFromClaims({ email: 'marie.lefebvre@epc2i.fr', xms_edov: true })).toBe('marie.lefebvre@epc2i.fr');
    expect(normaliseEmail('a@b')).toBeNull();
    expect(normaliseEmail('a b@c.fr')).toBeNull();
    expect(normaliseEmail(`${'a'.repeat(250)}@b.fr`)).toBeNull();
  });
});

describe('sign-in decision', () => {
  const user = (over: Partial<SignInUser> = {}): SignInUser => ({ userId: 'u1', personId: 'p1', entraObjectId: null, active: true, organisation: null, ...over });
  const base = { oid: 'oid-1', email: 'romain.aubert@epc2i.fr', roles: ['pm' as const], byObjectId: null, persons: [{ personId: 'p1', organisation: null }], userOfPerson: null };

  it('signs in the person of the e-mail, creating or reusing their user', () => {
    expect(decideSignIn(base)).toEqual({ ok: true, personId: 'p1', userId: null, roles: ['pm'], organisation: null });
    expect(decideSignIn({ ...base, userOfPerson: user() })).toMatchObject({ ok: true, userId: 'u1' });
    expect(decideSignIn({ ...base, userOfPerson: user({ entraObjectId: 'oid-1' }) })).toMatchObject({ ok: true, userId: 'u1' });
  });

  it('keeps the account already linked to the Microsoft object id, whatever the e-mail says', () => {
    const linked = user({ userId: 'u9', personId: 'p9', entraObjectId: 'oid-1' });
    expect(decideSignIn({ ...base, email: null, persons: [], byObjectId: linked })).toMatchObject({ ok: true, personId: 'p9', userId: 'u9' });
  });

  it('refuses unknown, ambiguous or missing e-mails, other accounts, deactivated users and role-less tokens', () => {
    expect(decideSignIn({ ...base, email: null, persons: [] })).toEqual({ ok: false, reason: 'no_email' });
    expect(decideSignIn({ ...base, persons: [] })).toEqual({ ok: false, reason: 'unknown_user' });
    expect(decideSignIn({ ...base, persons: [{ personId: 'p1', organisation: null }, { personId: 'p2', organisation: null }] })).toEqual({ ok: false, reason: 'ambiguous_user' });
    expect(decideSignIn({ ...base, userOfPerson: user({ entraObjectId: 'someone-else' }) })).toEqual({ ok: false, reason: 'account_mismatch' });
    expect(decideSignIn({ ...base, userOfPerson: user({ active: false }) })).toEqual({ ok: false, reason: 'inactive' });
    expect(decideSignIn({ ...base, byObjectId: user({ active: false, entraObjectId: 'oid-1' }) })).toEqual({ ok: false, reason: 'inactive' });
    expect(decideSignIn({ ...base, roles: [] })).toEqual({ ok: false, reason: 'no_role' });
  });

  it('needs a client organisation for the client role (P-10a)', () => {
    expect(decideSignIn({ ...base, roles: ['client'] })).toEqual({ ok: false, reason: 'no_organisation' });
    expect(decideSignIn({ ...base, roles: ['client'], persons: [{ personId: 'p1', organisation: 'Port authority' }] })).toMatchObject({ ok: true, organisation: 'Port authority' });
    expect(decideSignIn({ ...base, roles: ['client'], userOfPerson: user({ organisation: 'Nordvolt' }) })).toMatchObject({ ok: true, organisation: 'Nordvolt' });
  });

  it('has a message for every refusal and failure, and an audit label for every refusal', () => {
    for (const code of ['no_email', 'unknown_user', 'ambiguous_user', 'no_role', 'inactive', 'no_organisation', 'account_mismatch'] as const) {
      expect(SIGN_IN_ERROR[code]).toBeTruthy();
      expect(SIGN_IN_REFUSAL_LABEL[code]).toBeTruthy();
    }
    expect(isSignInError('state')).toBe(true);
    expect(isSignInError('toString')).toBe(false);
    expect(isSignInError('<script>')).toBe(false);
  });
});

describe('titles and paths', () => {
  it('titles a client by organisation, staff by job title, else by highest role', () => {
    expect(userTitle('Structural engineer', ['member'], null)).toBe('Structural engineer');
    expect(userTitle(null, ['quality', 'depthead'], null)).toBe('Head of department');
    expect(userTitle('Buyer', ['client'], 'Port authority')).toBe('Client — Port authority');
    expect(userTitle(null, [], null)).toBe('Team member');
  });

  it('returns only to same-origin paths', () => {
    expect(safeReturnTo('/projects/HLT-026/plan?tab=gantt')).toBe('/projects/HLT-026/plan?tab=gantt');
    for (const bad of ['https://evil.test/', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/a\nb', '/a\\b', '', null, 42, '/sign-in', '/sign-in?error=x', '/api/auth/callback', `/${'a'.repeat(3000)}`])
      expect(safeReturnTo(bad)).toBe('/');
  });

  it('lets the sign-in page and routes, the health probe and static files through without a session', () => {
    for (const p of ['/sign-in', '/api/auth/sign-in', '/api/auth/callback', '/api/auth/sign-out', '/api/health', '/api/health/db', '/_next/static/chunk.js', '/favicon.ico', '/next.svg'])
      expect(isPublicPath(p), p).toBe(true);
    for (const p of ['/', '/projects/HLT-026/plan', '/api/export/budget', '/api/healthz', '/sign-in/x', '/admin/integrations/audit.csv', '/projects/x.js', '/api/authx'])
      expect(isPublicPath(p), p).toBe(false);
  });
});
