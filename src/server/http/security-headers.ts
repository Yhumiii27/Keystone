// HTTP security headers of every Keystone response (R-008, docs/spec/00 §8.12). Pure module without `server-only`: it is
// imported by next.config.ts (the static headers, every path including /_next/static) and by src/proxy.ts (the
// Content-Security-Policy, which carries a fresh nonce per request — node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md).
//
// Content-Security-Policy (pages, Route Handlers, Server Functions; static assets excluded by the proxy matcher):
// - scripts: only those carrying the request's nonce, and what they load ('strict-dynamic'). Next.js puts the nonce on its
//   framework, page and inline (RSC payload) scripts itself when it finds it in the request's CSP header; every route is
//   rendered per request (the root layout reads cookies), so every page gets it. Development adds 'unsafe-eval' (React
//   rebuilds server error stacks with eval; not needed in production).
// - styles: 'unsafe-inline', because React renders data-driven `style` attributes (bar widths, positions, colours) that a
//   nonce cannot cover; style injection cannot run scripts.
// - images: self, data: and blob: (generated previews); fonts: self (next/font serves Inter from /_next/static).
// - connect: self only — the browser talks to Keystone alone; Codex, Vigie and Cursus are reached by the server or by
//   links (navigation is not restricted by CSP).
// - no plugins (object-src), no <base> hijack, forms post to Keystone only, no framing (frame-ancestors, plus
//   X-Frame-Options for old browsers); upgrade-insecure-requests only when the request arrived over HTTPS, so the local
//   http://localhost runs (Mac app, end-to-end tests) keep loading their assets.
// Static headers: nosniff, no framing, strict referrer, a closed Permissions-Policy (camera kept for the page itself: site
// photos may come from a tablet camera), Cross-Origin-Opener-Policy, and HSTS in production only (browsers ignore it over
// plain HTTP, so it is harmless on a local `next start`).

export interface CspOptions {
  /** Per-request nonce (base64). */
  nonce: string;
  /** `next dev`: allows eval (React's dev stack traces). */
  dev: boolean;
  /** Request arrived over HTTPS (directly or through a TLS-terminating proxy): adds upgrade-insecure-requests. */
  https: boolean;
}

/** Content-Security-Policy header value for one request. */
export function buildCsp({ nonce, dev, https }: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'", 'data:'],
    ['connect-src', "'self'"],
    ['media-src', "'self'", 'blob:'],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['frame-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (https) directives.push(['upgrade-insecure-requests']);
  return directives.map((d) => d.join(' ')).join('; ');
}

/** A nonce: 128 random bits, base64 (CSP nonce-source grammar). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Whether a request came over HTTPS: its URL, or the X-Forwarded-Proto set by the TLS-terminating proxy. */
export function isHttpsRequest(url: string, forwardedProto: string | null): boolean {
  const proto = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  if (proto) return proto === 'https';
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** HSTS: one year, this host only (EPC2i's other hosts are not known to be HTTPS-only). */
export const HSTS_VALUE = 'max-age=31536000';

/** Features the pages never use are closed; the camera stays available to Keystone itself (site photos from a tablet). */
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()';

/** Headers set on every response (next.config.ts `headers()`); HSTS in production only. */
export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: HSTS_VALUE }] : []),
  ];
}
