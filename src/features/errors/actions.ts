'use server';
// Error pages (R-176): an error raised in the browser has no server digest, so the page reports the identifier it shows
// ("C-1a2b3c4d") with the message and the page path; the server logger (R-009) writes one line (stderr), which IT
// finds from the identifier the user reads them. Nothing is stored. Input validated (./incident.ts), at most
// RATE_LIMITS.report reports a minute per viewer; Next's own Origin check applies to Server Functions.
import { hitActionRateLimit } from '@/server/http/request-guard';
import { log } from '@/server/log';
import { getViewer } from '@/server/session';
import { parseClientIncident } from './incident';

export async function reportClientIncidentAction(input: unknown): Promise<{ ok: boolean }> {
  const report = parseClientIncident(input);
  if (!report) return { ok: false };
  const viewer = await getViewer();
  if (!(await hitActionRateLimit('report', viewer)).ok) return { ok: false };
  log.error('Browser error', { component: 'error-page', incident: report.incident, path: report.path, message: report.message, role: viewer.role });
  return { ok: true };
}
