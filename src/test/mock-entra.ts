// Test double of Microsoft Entra ID (R-038 tests): an in-process OpenID provider with a real RSA signing key, served
// through a stubbed `fetch` — discovery, JWKS and token endpoints — so the whole authorization-code + PKCE flow runs
// without any network call. `authorize(url)` plays the user signing in at Microsoft: it reads the authorization request
// (state, nonce, S256 challenge) and returns the code the browser would bring back to the callback.
import { b64urlEncode, pkceChallenge } from '@/server/auth/crypto';

const enc = new TextEncoder();

export const TENANT = '11111111-2222-4333-8444-555555555555';
export const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
export const CLIENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const CLIENT_SECRET = 'test-client-secret';
export const ORIGIN = 'https://keystone.epc2i.test';
export const REDIRECT_URI = `${ORIGIN}/api/auth/callback`;
export const SESSION_SECRET = 'test-session-secret-0123456789-abcdefghij';

/** Environment of the Entra mode against this provider. */
export const ENTRA_ENV: Record<string, string> = {
  KEYSTONE_AUTH: 'entra',
  KEYSTONE_SESSION_SECRET: SESSION_SECRET,
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: CLIENT_ID,
  ENTRA_CLIENT_SECRET: CLIENT_SECRET,
  ENTRA_REDIRECT_URI: REDIRECT_URI,
};

interface KeyPair {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

async function newKey(kid: string): Promise<KeyPair> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kid, privateKey: kp.privateKey, jwk: { kty: 'RSA', n: pub.n, e: pub.e, use: 'sig', kid } };
}

export async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

interface PendingCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

export interface MockEntra {
  /** The stubbed fetch (install with vi.stubGlobal('fetch', idp.fetch)). */
  fetch: typeof fetch;
  /** URLs requested, in order. */
  calls: string[];
  /** The user signing in at Microsoft: answers the authorization request with a code for these claims. */
  authorize(authorizationUrl: string, claims: Record<string, unknown>): { code: string; state: string };
  /** Signs an ID token with the provider's current key (or another key / header for negative tests). */
  idToken(claims: Record<string, unknown>, opts?: { header?: Record<string, unknown>; key?: CryptoKey }): Promise<string>;
  /** Signing-key rollover: a new key (new kid) signs from now on and is published in the JWKS. */
  rotateKey(): Promise<void>;
  /** A key the provider never published (forged tokens). */
  foreignKey(): Promise<CryptoKey>;
  /** Overrides the next token response (e.g. a token signed by another key). */
  nextTokenResponse: ((body: URLSearchParams) => Promise<Response>) | null;
  endSession: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function createMockEntra(): Promise<MockEntra> {
  const keys: KeyPair[] = [await newKey('key-1')];
  const codes = new Map<string, PendingCode>();
  let seq = 0;
  const endSession = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/logout`;
  const meta = {
    issuer: ISSUER,
    authorization_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    jwks_uri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
    end_session_endpoint: endSession,
  };
  const current = () => keys[keys.length - 1];
  const idp: MockEntra = {
    calls: [],
    nextTokenResponse: null,
    endSession,
    async idToken(claims, opts = {}) {
      const k = current();
      const now = Math.floor(Date.now() / 1000);
      return signJwt(
        { alg: 'RS256', typ: 'JWT', kid: k.kid, ...opts.header },
        { iss: ISSUER, aud: CLIENT_ID, tid: TENANT, iat: now, nbf: now, exp: now + 3600, ...claims },
        opts.key ?? k.privateKey,
      );
    },
    authorize(authorizationUrl, claims) {
      const u = new URL(authorizationUrl);
      if (`${u.origin}${u.pathname}` !== meta.authorization_endpoint) throw new Error(`unexpected authorization endpoint ${u.origin}${u.pathname}`);
      const p = u.searchParams;
      if (p.get('client_id') !== CLIENT_ID || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256') throw new Error('bad authorization request');
      const code = `code-${++seq}`;
      codes.set(code, { nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, claims });
      return { code, state: p.get('state')! };
    },
    async rotateKey() {
      keys.push(await newKey(`key-${keys.length + 1}`));
    },
    async foreignKey() {
      return (await newKey('foreign')).privateKey;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      idp.calls.push(url);
      if (url === `${ISSUER}/.well-known/openid-configuration`) return json(meta);
      if (url === meta.jwks_uri) return json({ keys: keys.map((k) => k.jwk) });
      if (url === meta.token_endpoint && init?.method === 'POST') {
        const body = new URLSearchParams(String(init.body));
        if (idp.nextTokenResponse) {
          const r = idp.nextTokenResponse(body);
          idp.nextTokenResponse = null;
          return r;
        }
        const pending = codes.get(body.get('code') ?? '');
        if (body.get('grant_type') !== 'authorization_code' || body.get('client_id') !== CLIENT_ID || body.get('client_secret') !== CLIENT_SECRET)
          return json({ error: 'invalid_client' }, 401);
        if (!pending || pending.redirectUri !== body.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400);
        if ((await pkceChallenge(body.get('code_verifier') ?? '')) !== pending.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE' }, 400);
        codes.delete(body.get('code')!);
        return json({ token_type: 'Bearer', id_token: await idp.idToken({ nonce: pending.nonce, ...pending.claims }), access_token: 'unused' });
      }
      throw new Error(`mock Entra: unexpected request ${init?.method ?? 'GET'} ${url}`);
    }) as typeof fetch,
  };
  return idp;
}

/** `name=value` pairs of a response's Set-Cookie headers (value '' = deleted). */
export function setCookies(res: Response): Record<string, { value: string; attrs: string }> {
  const out: Record<string, { value: string; attrs: string }> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i).trim()] = { value: decodeURIComponent(pair.slice(i + 1).trim()), attrs: attrs.join(';').toLowerCase() };
  }
  return out;
}
