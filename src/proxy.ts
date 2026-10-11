// Proxy (Next 16's middleware, R-038). Demo mode (KEYSTONE_AUTH=demo, the default): does nothing — the "View as"
// cookie stays the session. Entra mode: every request needs a valid session cookie, except the sign-in page and routes,
// the health probe and static assets. Without one, a page request is redirected to the Microsoft sign-in (back to the
// same page afterwards); an API call or a Server Function POST gets 401. This is the optimistic check (cookie only, no
// database): getViewer() re-checks the user on the server for every page, Route Handler and Server Function.
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_PATHS, isPublicPath } from '@/domain/auth';
import { authMode, sessionConfig } from '@/server/auth/config';
import { readSession } from '@/server/auth/session-cookie';

const unauthorized = () => new NextResponse('Sign-in required', { status: 401, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let mode;
  try {
    mode = authMode();
  } catch (e) {
    // KEYSTONE_AUTH has an unknown value: refuse everything rather than run unauthenticated.
    console.error('[auth]', e instanceof Error ? e.message : e);
    return new NextResponse('Authentication is misconfigured', { status: 500 });
  }
  if (mode !== 'entra') return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  let ok = false;
  try {
    const cfg = sessionConfig();
    ok = !!(await readSession(cfg, request.cookies.get(cfg.cookieName)?.value));
  } catch (e) {
    console.error('[auth]', e instanceof Error ? e.message : e);
    const page = request.method === 'GET' && !pathname.startsWith('/api/');
    return page ? NextResponse.redirect(new URL(`${AUTH_PATHS.page}?error=config`, request.url)) : unauthorized();
  }
  if (ok) return NextResponse.next();
  if (pathname.startsWith('/api/') || (request.method !== 'GET' && request.method !== 'HEAD')) return unauthorized();
  const target = new URL(AUTH_PATHS.signIn, request.url);
  target.searchParams.set('returnTo', pathname + search);
  return NextResponse.redirect(target);
}

export const config = {
  // Next's build output and image optimiser never need a session; everything else goes through the checks above.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
