// ISO 9001 export of the audit trail — GET /admin/integrations/audit.csv (docs/spec/10 §2.4f "exportable for ISO 9001
// audits", 00 §7.11). Every audit entry, newest first, as CSV (UTF-8 with BOM for spreadsheet tools; RFC 4180; ISO-8601
// UTC timestamps; values verbatim, column titles in the viewer's language). Only viewers with Activity & integrations in
// their workspace (director, PM) may export; the others get 403. R-008: counts in the export rate limit (429).
import { auditCsv, auditCsvFileName } from '@/domain/admin';
import { listAudit } from '@/server/dal/notifications';
import { TOO_MANY_REQUESTS, hitRateLimit, rateClient, tooManyRequestsResponse } from '@/server/http/request-guard';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export async function GET(request: Request): Promise<Response> {
  const [access, { t }] = await Promise.all([getScreenAccess('plumbing'), getI18n()]);
  if (!access.canEdit) return new Response(t('Activity & integrations is read-only for you'), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const limited = hitRateLimit('export', rateClient(request.headers, access.viewer));
  if (!limited.ok) return tooManyRequestsResponse('text', t(TOO_MANY_REQUESTS), limited.retryAfterSec);
  const rows = await listAudit({ limit: 1_000_000 });
  const csv = auditCsv(rows, [t('When (UTC)'), t('Who'), t('Object'), t('Change'), t('Area'), t('Project')]);
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${auditCsvFileName(new Date().toISOString().slice(0, 10))}"`,
      'Cache-Control': 'no-store',
    },
  });
}
