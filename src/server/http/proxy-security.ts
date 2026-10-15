// Content-Security-Policy of a request (R-008), applied by src/proxy.ts: a fresh nonce, the policy of ./security-headers.ts
// on the response, and the same policy on the request headers — Next.js reads the nonce from there while rendering and puts
// it on its own scripts (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). `x-nonce` lets a Server
// Component read it (headers()) for a script of its own; none needs it today.
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, isHttpsRequest, newNonce } from './security-headers';

/** `NextResponse.next()` with the request's CSP (use it wherever the proxy lets a request through). */
export function nextWithCsp(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === 'development', https: isHttpsRequest(request.url, request.headers.get('x-forwarded-proto')) });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
