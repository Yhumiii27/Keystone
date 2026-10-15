// Cryptography of the sign-in (R-038), on the platform WebCrypto only (Node ≥ 20 and the proxy runtime): base64url,
// random tokens, PKCE (RFC 7636, S256), sealed cookies (AES-256-GCM, key derived by HKDF-SHA-256 from
// KEYSTONE_SESSION_SECRET, one key per purpose) and RS256 JWT signature checks against a JWKS (RFC 7515/7517).
// No `server-only` import: the proxy unseals the session cookie with it.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url decoding (unpadded alphabet only); null on any other character. */
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `bytes` random bytes as base64url (32 bytes → 43 characters). */
export function randomToken(bytes = 32): string {
  return b64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge of a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64urlEncode(await subtle().digest('SHA-256', enc.encode(verifier)));
}

/** Constant-time string comparison (state, nonce). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ── Sealed cookies ────────────────────────────────────────────────────────────────────────────────────

const keyCache = new Map<string, Promise<CryptoKey>>();

function sealKey(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}\u0000${secret}`;
  let k = keyCache.get(id);
  if (!k) {
    k = (async () => {
      const base = await subtle().importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
      return subtle().deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('keystone-pm'), info: enc.encode(`keystone-${purpose}-v1`) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(id, k);
  }
  return k;
}

const SEAL_PREFIX = 'v1';

/**
 * Encrypts and authenticates `payload` (JSON) for a purpose ('session', 'signin'): `v1.<iv>.<ciphertext>`. The payload
 * carries its own `exp` (epoch seconds), checked by unseal().
 */
export async function seal(payload: { exp: number } & Record<string, unknown>, secret: string, purpose: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await sealKey(secret, purpose), enc.encode(JSON.stringify(payload)));
  return `${SEAL_PREFIX}.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

/** The payload of a sealed value, or null when it is malformed, tampered with, sealed for another purpose or expired. */
export async function unseal<T extends { exp: number }>(value: string | undefined | null, secret: string, purpose: string, nowSec = Math.floor(Date.now() / 1000)): Promise<T | null> {
  if (!value || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== SEAL_PREFIX) return null;
  const iv = b64urlDecode(parts[1]);
  const ct = b64urlDecode(parts[2]);
  if (!iv || iv.length !== 12 || !ct || ct.length < 17) return null;
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await sealKey(secret, purpose), ct);
    const data = JSON.parse(dec.decode(pt)) as T;
    if (!data || typeof data !== 'object' || typeof data.exp !== 'number' || data.exp <= nowSec) return null;
    return data;
  } catch {
    return null;
  }
}

// ── JWT (RS256) ───────────────────────────────────────────────────────────────────────────────────────

export interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

export class JwtError extends Error {}

export interface DecodedJwt {
  header: { alg?: unknown; kid?: unknown; typ?: unknown; crit?: unknown };
  payload: Record<string, unknown>;
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

/** Splits and decodes a compact JWS (no verification). */
export function decodeJwt(token: string): DecodedJwt {
  if (typeof token !== 'string' || token.length > 16_384) throw new JwtError('malformed token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('malformed token');
  const [h, p, s] = parts.map(b64urlDecode);
  if (!h || !p || !s) throw new JwtError('malformed token');
  let header: DecodedJwt['header'];
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(dec.decode(h));
    payload = JSON.parse(dec.decode(p));
  } catch {
    throw new JwtError('malformed token');
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new JwtError('malformed token');
  return { header, payload, signingInput: enc.encode(`${parts[0]}.${parts[1]}`), signature: s };
}

/**
 * Verifies the RS256 signature of `token` with the JWKS key named by its `kid`. Only RS256 is accepted (Entra ID signs
 * ID tokens with it): `none`, HMAC and every other algorithm are refused. Returns the decoded token; the claims are
 * checked by the caller. Throws JwtError('unknown key') when no key matches, so the caller may refresh the JWKS once.
 */
export async function verifyRs256(token: string, keys: readonly Jwk[]): Promise<DecodedJwt> {
  const jwt = decodeJwt(token);
  if (jwt.header.alg !== 'RS256') throw new JwtError('unsupported algorithm');
  if (jwt.header.crit !== undefined) throw new JwtError('unsupported critical header');
  const kid = typeof jwt.header.kid === 'string' ? jwt.header.kid : null;
  const candidates = keys.filter((k) => k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256') && typeof k.n === 'string' && typeof k.e === 'string');
  const jwk = kid ? candidates.find((k) => k.kid === kid) : candidates.length === 1 ? candidates[0] : undefined;
  if (!jwk) throw new JwtError('unknown key');
  let key: CryptoKey;
  try {
    key = await subtle().importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    throw new JwtError('invalid key');
  }
  const ok = await subtle().verify('RSASSA-PKCS1-v1_5', key, jwt.signature, jwt.signingInput);
  if (!ok) throw new JwtError('bad signature');
  return jwt;
}
