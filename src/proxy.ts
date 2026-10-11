// Proxy (Next 16's middleware — node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md). R-008:
// every page, Route Handler and Server Function response carries a per-request Content-Security-Policy with a nonce
// (src/server/http/proxy-security.ts). The static security headers (nosniff, frame denial, referrer, permissions, HSTS
// in production) come from next.config.ts `headers()`, which also covers the static assets this matcher skips.
// Permissions are never decided here: every Server Function and Route Handler checks the viewer itself.
import type { NextRequest, NextResponse } from 'next/server';
import { nextWithCsp } from '@/server/http/proxy-security';

export function proxy(request: NextRequest): NextResponse {
  return nextWithCsp(request);
}

export const config = {
  // Build output, image optimiser and favicon need no CSP (they are not documents and run no script).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
