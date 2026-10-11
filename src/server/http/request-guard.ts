import 'server-only';
import { headers as nextHeaders } from 'next/headers';
// Request guards of the Route Handlers and of the upload / analysis Server Functions (R-008, docs/spec/00 §8.12).
//
// Same origin — Server Functions get Next's own Origin check; Route Handlers do not. A state-changing Route Handler (an
// upload, an import, an export that is logged or stamps a connector) refuses a request the browser flags as coming from
// another site (Sec-Fetch-Site cross-site or same-site: a GET navigation carries no Origin header) or whose Origin names
// another host. Requests without either header (scripts, tests, old clients) pass, as Next does for Server Functions:
// the "View as" cookie / session is what a forged cross-site request would abuse, and browsers always send one of them.
//
// Rate limits — a sliding window per client and per kind of request, in this server process's memory (one instance today;
// several instances would each count on their own — a shared store comes with them, R-003). The client is the viewer
// (persona, or the signed-in user once R-038 lands) at its address (the last X-Forwarded-For hop, which the TLS proxy
// appends, else the socket address Next.js records). Limits are generous for a person working and stop a script or a
// stuck client from flooding the server with uploads, file generations or paid Claude analyses.

/** Kinds of rate-limited requests. */
export type RateBucket = 'upload' | 'import' | 'export' | 'analysis';

/** Requests allowed per client within `windowMs`. */
export const RATE_LIMITS: Readonly<Record<RateBucket, { limit: number; windowMs: number }>> = {
  /** Task attachments, meeting transcripts (files up to 20 MB). */
  upload: { limit: 30, windowMs: 60_000 },
  /** MS Project / P6 / Excel imports (switched off by D-7b, refused anyway). */
  import: { limit: 10, windowMs: 60_000 },
  /** CSV / Excel / PDF exports, MS Project XML, audit CSV (generated on the server). */
  export: { limit: 60, windowMs: 60_000 },
  /** Transcript analyses (Claude is billed per call; the local analyser is CPU-bound). */
  analysis: { limit: 10, windowMs: 60_000 },
};

/** EN source message of a refusal (translated by the caller). */
export const TOO_MANY_REQUESTS = 'Too many requests — please wait a minute and try again';

/** Clients remembered at most (oldest forgotten first), so forged addresses cannot grow the map without bound. */
const MAX_CLIENTS = 5000;

const g = globalThis as unknown as { __ksRateLimits?: Map<string, number[]> };
const store = (): Map<string, number[]> => (g.__ksRateLimits ??= new Map<string, number[]>());

/** Forgets every counter (tests). */
export function resetRateLimits(): void {
  g.__ksRateLimits = undefined;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Counts one request of `client` in `bucket`; refuses it (without counting) when the window already holds the limit.
 * `retryAfterSec`: seconds until the oldest request of the window leaves it.
 */
export function hitRateLimit(bucket: RateBucket, client: string, now: number = Date.now()): RateDecision {
  const { limit, windowMs } = RATE_LIMITS[bucket];
  const key = `${bucket}|${client}`;
  const map = store();
  const recent = (map.get(key) ?? []).filter((at) => at > now - windowMs);
  map.delete(key);
  if (recent.length >= limit) {
    map.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  map.set(key, recent);
  while (map.size > MAX_CLIENTS) map.delete(map.keys().next().value as string);
  return { ok: true };
}

/** Address of the client: the last X-Forwarded-For hop (appended by the TLS proxy, or the socket address set by Next.js). */
export function clientAddress(headers: Headers): string {
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) ?? headers.get('x-real-ip')?.trim() ?? 'local';
}

/** Rate-limit key of a viewer at an address. */
export const rateClient = (headers: Headers, viewer: string) => `${clientAddress(headers)}|${viewer}`;

/** Headers of the current request in a Server Function; empty outside a request (scripts, tests). */
export async function requestHeaders(): Promise<Headers> {
  try {
    return new Headers(await nextHeaders());
  } catch {
    return new Headers();
  }
}

/** Rate limit of a Server Function: `viewer` = the acting viewer's name. */
export async function hitActionRateLimit(bucket: RateBucket, viewer: string): Promise<RateDecision> {
  return hitRateLimit(bucket, rateClient(await requestHeaders(), viewer));
}

/** 429 answer of a Route Handler: JSON `{ ok: false, error }` or plain text, with Retry-After. */
export function tooManyRequestsResponse(kind: 'json' | 'text', message: string, retryAfterSec: number): Response {
  const headers = { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' };
  return kind === 'json'
    ? Response.json({ ok: false, error: message }, { status: 429, headers })
    : new Response(message, { status: 429, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Same-origin check of a state-changing Route Handler (see the header): false when the browser says the request comes
 * from another site, or when its Origin is another host (or "null").
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
