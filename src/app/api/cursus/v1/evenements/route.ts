// POST /api/cursus/v1/evenements — the address Cursus posts its events to (Cursus's contract, authoritative: Cursus
// docs/API-KEYSTONE.md « Événements envoyés par Cursus »; R-029, R-031). Same handler as the earlier alias
// POST /api/integrations/cursus/events: server to server, authenticated by `Authorization: Bearer <CURSUS_EVENTS_KEY>` (Cursus's
// KEYSTONE_TOKEN) or `X-Api-Key`, no session, no same-origin check. The work and the status codes:
// src/server/integrations/cursus/events.ts; Keystone's notes: docs/integrations/cursus-contract.md.
import { handleCursusEvent } from '@/server/integrations/cursus/events';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleCursusEvent(request);
}
