// OpenID Connect client (R-038) against the in-process Entra double (no network): discovery, the authorization request,
// the code exchange with PKCE, and every ID-token check (issuer, audience, expiry, nonce, tenant, signature, rollover).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID, ENTRA_ENV, ISSUER, REDIRECT_URI, TENANT, createMockEntra, type MockEntra } from '@/test/mock-entra';
import { entraConfig } from './config';
import { pkceChallenge } from './crypto';
import { OidcError, authorizationUrl, clearOidcCache, discover, endSessionUrl, exchangeCode, verifyIdToken } from './oidc';

let idp: MockEntra;
const cfg = entraConfig(ENTRA_ENV);

beforeEach(async () => {
  clearOidcCache();
  idp = await createMockEntra();
  vi.stubGlobal('fetch', idp.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery and requests', () => {
  it('reads the tenant configuration once and builds a PKCE authorization request', async () => {
    const meta = await discover(cfg);
    await discover(cfg);
    expect(idp.calls.filter((c) => c.endsWith('openid-configuration'))).toHaveLength(1);
    const url = new URL(authorizationUrl(meta, cfg, { state: 'st', nonce: 'no', codeChallenge: 'ch' }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, response_mode: 'query', scope: 'openid profile email', state: 'st', nonce: 'no',
      code_challenge: 'ch', code_challenge_method: 'S256',
    });
    expect(endSessionUrl(meta, cfg)).toBe(`${idp.endSession}?client_id=${CLIENT_ID}&post_logout_redirect_uri=${encodeURIComponent('https://keystone.epc2i.test/sign-in?signedOut=1')}`);
  });

  it('refuses a discovery document of another issuer', async () => {
    await expect(discover({ issuer: `https://login.microsoftonline.com/${TENANT}/v2.0/other` })).rejects.toThrow(OidcError);
  });

  it('exchanges the code with the verifier and the client secret', async () => {
    const meta = await discover(cfg);
    const verifier = 'v'.repeat(43);
    const url = authorizationUrl(meta, cfg, { state: 's', nonce: 'n1', codeChallenge: await pkceChallenge(verifier) });
    const { code } = idp.authorize(url, { oid: 'o1' });
    const token = await exchangeCode(meta, cfg, code, verifier);
    expect((await verifyIdToken(meta, cfg, token, { nonce: 'n1' })).oid).toBe('o1');
  });

  it('fails the exchange with a wrong verifier (PKCE) or secret', async () => {
    const meta = await discover(cfg);
    const url = authorizationUrl(meta, cfg, { state: 's', nonce: 'n', codeChallenge: await pkceChallenge('right'.repeat(9)) });
    const { code } = idp.authorize(url, {});
    await expect(exchangeCode(meta, cfg, code, 'wrong'.repeat(9))).rejects.toThrow(/400 \(invalid_grant\)/);
    const { code: code2 } = idp.authorize(url, {});
    await expect(exchangeCode(meta, { ...cfg, clientSecret: 'nope' }, code2, 'right'.repeat(9))).rejects.toThrow(/401/);
  });
});

describe('ID token checks', () => {
  const verify = async (claims: Record<string, unknown>, opts?: Parameters<MockEntra['idToken']>[1], nonce = 'n') =>
    verifyIdToken(await discover(cfg), cfg, await idp.idToken({ nonce: 'n', oid: 'o', ...claims }, opts), { nonce });

  it('accepts a fresh token of the tenant for the app', async () => {
    expect(await verify({})).toMatchObject({ iss: ISSUER, aud: CLIENT_ID, oid: 'o' });
    expect(await verify({ aud: [CLIENT_ID] })).toMatchObject({ oid: 'o' });
  });

  it('refuses the wrong issuer, audience, nonce, tenant and expired or future tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verify({ iss: 'https://login.microsoftonline.com/other/v2.0' })).rejects.toThrow('issuer');
    await expect(verify({ aud: 'another-app' })).rejects.toThrow('audience');
    await expect(verify({ aud: [CLIENT_ID, 'x'] })).rejects.toThrow('authorized party');
    await expect(verify({}, undefined, 'other-nonce')).rejects.toThrow('nonce');
    await expect(verify({ nonce: undefined })).rejects.toThrow('nonce');
    await expect(verify({ tid: '99999999-2222-4333-8444-555555555555' })).rejects.toThrow('tenant');
    await expect(verify({ exp: now - 600 })).rejects.toThrow('expired');
    await expect(verify({ iat: now + 3600 })).rejects.toThrow('future');
    await expect(verify({ nbf: now + 3600 })).rejects.toThrow('not yet valid');
    await expect(verify({ exp: 'soon' })).rejects.toThrow('expired');
  });

  it('refuses tokens signed by an unpublished key or with another algorithm', async () => {
    await expect(verify({}, { key: await idp.foreignKey() })).rejects.toMatchObject({ kind: 'token', message: /bad signature/ });
    await expect(verify({}, { header: { alg: 'HS256' } })).rejects.toMatchObject({ kind: 'token' });
  });

  it('refreshes the keys once on a signing-key rollover', async () => {
    await verify({}); // caches key-1
    await idp.rotateKey();
    const jwksCalls = () => idp.calls.filter((c) => c.endsWith('/keys')).length;
    const before = jwksCalls();
    expect(await verify({})).toMatchObject({ oid: 'o' });
    expect(jwksCalls()).toBe(before + 1);
  });

  it('reports an unreachable provider as a provider error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(discover(cfg)).rejects.toMatchObject({ kind: 'provider' });
  });
});
