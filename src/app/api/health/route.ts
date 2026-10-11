// GET /api/health — readiness of this server instance for the hosting platform (R-009): 200 { status: "ok" } when the
// database answers and its schema is up to date, 503 { status: "unavailable" } otherwise (src/server/health.ts). Public:
// it needs no session and reveals no configuration. Never cached.
import { checkHealth } from '@/server/health';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  const report = await checkHealth();
  return new Response(JSON.stringify(report), { status: report.status === 'ok' ? 200 : 503, headers: HEADERS });
}

export async function HEAD(): Promise<Response> {
  const report = await checkHealth();
  return new Response(null, { status: report.status === 'ok' ? 200 : 503, headers: HEADERS });
}
