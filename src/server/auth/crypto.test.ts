// Sign-in cryptography (R-038): base64url, PKCE S256 (RFC 7636 test vector), sealed cookies (tampering, purpose, secret,
// expiry) and the RS256 signature check (forged, tampered, `none`/HMAC, unknown key).
import { describe, expect, it } from 'vitest';
import { signJwt } from '@/test/mock-entra';
import { JwtError, b64urlDecode, b64urlEncode, decodeJwt, pkceChallenge, randomToken, safeEqual, seal, unseal, verifyRs256, type Jwk } from './crypto';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';
const now = () => Math.floor(Date.now() / 1000);

describe('encoding and tokens', () => {
  it('round-trips base64url and refuses other alphabets', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 128]);
    const s = b64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(b64urlDecode(s)).toEqual(bytes);
    expect(b64urlDecode('ab+/')).toBeNull();
    expect(b64urlDecode('a')).toBeNull();
  });

  it('draws 256-bit random tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('computes the PKCE S256 challenge of RFC 7636 appendix B', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('sealed cookies', () => {
  it('round-trips a payload', async () => {
    // A long marker: a 2-character uid can appear by chance in the random base64url ciphertext.
    const uid = 'plaintext-user-marker-42';
    const v = await seal({ uid, exp: now() + 60 }, SECRET, 'session');
    expect(v).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(v).not.toContain(uid);
    expect(await unseal(v, SECRET, 'session')).toMatchObject({ uid });
  });

  it('refuses tampering, another purpose, another secret, expiry and garbage', async () => {
    const v = await seal({ uid: 'u1', exp: now() + 60 }, SECRET, 'session');
    const [p, iv, ct] = v.split('.');
    const flipped = ct.slice(0, -2) + (ct.at(-2) === 'A' ? 'B' : 'A') + ct.at(-1);
    expect(await unseal(`${p}.${iv}.${flipped}`, SECRET, 'session')).toBeNull();
    expect(await unseal(v, SECRET, 'signin')).toBeNull();
    expect(await unseal(v, `${SECRET}x`, 'session')).toBeNull();
    expect(await unseal(await seal({ uid: 'u1', exp: now() - 1 }, SECRET, 'session'), SECRET, 'session')).toBeNull();
    for (const bad of [undefined, '', 'v1', 'v2.a.b', 'v1.!!.??', 'x'.repeat(5000)]) expect(await unseal(bad, SECRET, 'session')).toBeNull();
  });
});

describe('RS256 signatures', () => {
  const keyPair = async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    return { priv: kp.privateKey, jwk: { kty: 'RSA', n: pub.n, e: pub.e, kid: 'k1', use: 'sig' } as Jwk };
  };

  it('accepts a token signed by the published key', async () => {
    const { priv, jwk } = await keyPair();
    const token = await signJwt({ alg: 'RS256', kid: 'k1' }, { sub: 'x' }, priv);
    expect((await verifyRs256(token, [jwk])).payload).toEqual({ sub: 'x' });
  });

  it('refuses forged, tampered, unsigned, HMAC and unknown-key tokens', async () => {
    const { priv, jwk } = await keyPair();
    const other = await keyPair();
    const token = await signJwt({ alg: 'RS256', kid: 'k1' }, { sub: 'x' }, priv);
    await expect(verifyRs256(await signJwt({ alg: 'RS256', kid: 'k1' }, { sub: 'x' }, other.priv), [jwk])).rejects.toThrow('bad signature');
    const [h, , s] = token.split('.');
    const forgedPayload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ sub: 'admin' })));
    await expect(verifyRs256(`${h}.${forgedPayload}.${s}`, [jwk])).rejects.toThrow('bad signature');
    const none = `${b64urlEncode(new TextEncoder().encode('{"alg":"none","kid":"k1"}'))}.${forgedPayload}.`;
    await expect(verifyRs256(none, [jwk])).rejects.toThrow(JwtError);
    const hs = `${b64urlEncode(new TextEncoder().encode('{"alg":"HS256","kid":"k1"}'))}.${forgedPayload}.${s}`;
    await expect(verifyRs256(hs, [jwk])).rejects.toThrow('unsupported algorithm');
    await expect(verifyRs256(await signJwt({ alg: 'RS256', kid: 'k2' }, { sub: 'x' }, priv), [jwk])).rejects.toThrow('unknown key');
    await expect(verifyRs256(await signJwt({ alg: 'RS256', kid: 'k1', crit: ['exp'] }, { sub: 'x' }, priv), [jwk])).rejects.toThrow('critical');
    expect(() => decodeJwt('a.b')).toThrow('malformed');
  });
});
