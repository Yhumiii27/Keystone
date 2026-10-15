import 'server-only';
// POST /api/integrations/cursus/events — the entry point of the events Cursus pushes to Keystone (R-029, NEW-CURSUS-7 "a";
// contract: docs/integrations/cursus-contract.md, a proposal). Server to server: no viewer, no session (isPublicPath lets it
// through the Entra proxy), no same-origin check; the caller is authenticated by its key only.
// Order of the checks (each answer is JSON `{ ok, … }`, never cached):
//   429  too many requests from that address (bucket "events", generous: Cursus re-sends its backlog after an outage)
//   503  no events key configured (production without CURSUS_EVENTS_KEY) — Retry-After: Cursus keeps the event
//   401  X-Api-Key missing or wrong (constant-time comparison of SHA-256 digests)
//   413  body over 256 KB
//   400  not JSON, or not a valid event
//   503  Cursus connector disabled by IT (D-7a), or the database unavailable — Retry-After
//   200  { ok: true, id, status } — or { ok: true, id, duplicate: true } for an event id already received
// Nothing in a refusal echoes the key or the body.
import { createHash, timingSafeEqual } from 'node:crypto';
import { MAX_CURSUS_EVENT_BYTES, parseCursusEvent } from '@/domain/cursus-events';
import { CURSUS_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { clientAddress, hitRateLimit } from '@/server/http/request-guard';
import { log, logError } from '@/server/log';
import { cursusEventsKey } from './connection';
import { refreshCursusSiteNow } from './connector';
import { markCursusEventError, receiveCursusEvent } from './inbox';

/** The endpoint's path (public in Entra mode: src/domain/auth.ts). */
export const CURSUS_EVENTS_PATH = '/api/integrations/cursus/events';
/** Seconds Cursus waits before retrying a 503. */
export const CURSUS_RETRY_AFTER_SEC = 60;

const HEADERS = { 'Cache-Control': 'no-store' } as const;
const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const unavailable = (error: string) => json(503, { ok: false, error }, { 'Retry-After': String(CURSUS_RETRY_AFTER_SEC) });

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
/** Constant-time comparison of the presented key with the configured one (digests: equal lengths whatever the input). */
export function sameKey(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Reads the body as text, refusing more than `max` bytes (whatever Content-Length says). */
async function readBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The Route Handler's work (src/app/api/integrations/cursus/events/route.ts). */
export async function handleCursusEvent(request: Request): Promise<Response> {
  const rate = hitRateLimit('events', clientAddress(request.headers));
  if (!rate.ok) return json(429, { ok: false, error: 'Too many requests' }, { 'Retry-After': String(rate.retryAfterSec) });
  const key = cursusEventsKey();
  if (!key) {
    log.warn('Cursus event refused: CURSUS_EVENTS_KEY is not set', { component: 'cursus' });
    return unavailable('Events are not accepted yet');
  }
  if (!sameKey(request.headers.get('x-api-key'), key)) return json(401, { ok: false, error: 'Invalid API key' });
  const text = await readBody(request, MAX_CURSUS_EVENT_BYTES).catch(() => null);
  if (text == null) return json(413, { ok: false, error: 'Event too large (256 KB at most)' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: 'Body is not JSON' });
  }
  const parsed = parseCursusEvent(body);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
  const ev = parsed.event;
  let received;
  try {
    // D-7a: a connector IT disabled exchanges nothing — Cursus keeps the event and retries.
    if (!(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return unavailable('The Cursus connector is disabled');
    received = await receiveCursusEvent(ev);
  } catch (e) {
    logError('Cursus event', e, { component: 'cursus', event: ev.id, type: ev.type });
    return unavailable('Keystone cannot store the event now');
  }
  if (received.duplicate) return json(200, { ok: true, id: ev.id, duplicate: true });
  // verdict.modifie (HTTP mode): the site's Go / No Go is refreshed now, after the event is stored.
  if (received.refreshProject) {
    try {
      await refreshCursusSiteNow(received.refreshProject);
    } catch (e) {
      logError('Cursus event · site refresh', e, { component: 'cursus', event: ev.id, project: received.refreshProject });
      await markCursusEventError(ev.id, `Go / No Go refresh failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => null);
      return json(200, { ok: true, id: ev.id, status: 'error' });
    }
  }
  log.info('Cursus event received', { component: 'cursus', event: ev.id, type: ev.type, status: received.status });
  return json(200, { ok: true, id: ev.id, status: received.status });
}
