// POST /api/integrations/cursus/events — events Cursus pushes to Keystone (R-029, NEW-CURSUS-7 "a"): validated hours,
// absences, Go / No Go changes, travel-request decisions. Keystone's earlier address, kept as an alias of the one Cursus's
// contract names, POST /api/cursus/v1/evenements (src/app/api/cursus/v1/evenements/route.ts, same handler). Server to server:
// authenticated by CURSUS_EVENTS_KEY (Bearer or X-Api-Key), no session, no same-origin check. The work and the status codes:
// src/server/integrations/cursus/events.ts; notes: docs/integrations/cursus-contract.md.
import { handleCursusEvent } from '@/server/integrations/cursus/events';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleCursusEvent(request);
}
