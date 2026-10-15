// POST /api/integrations/cursus/events — events Cursus pushes to Keystone (R-029, NEW-CURSUS-7 "a"): validated hours,
// absences, Go / No Go changes, travel-request decisions. Server to server: authenticated by the X-Api-Key Cursus presents
// (CURSUS_EVENTS_KEY), no session, no same-origin check. The work and the status codes: src/server/integrations/cursus/events.ts;
// the contract for the Cursus team: docs/integrations/cursus-contract.md (a proposal).
import { handleCursusEvent } from '@/server/integrations/cursus/events';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleCursusEvent(request);
}
