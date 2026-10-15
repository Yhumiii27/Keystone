import 'server-only';
// Keystone notices of what a Vigie refresh brings (R-015, X-6a). DORMANT until Vigie publishes its API (V-3): called only by
// the HTTP connectors' full refresh (eco-connector.ts, quality-connector.ts), with the records that are new for the mirror —
// never from upsertMirror / upsertNcrMirror, which the seed also calls, nor from the mock. Bell only (X-6b), after the
// refresh's transaction commits, best effort (the caller logs a failure; the mirror is already refreshed). Rules:
// src/domain/vigie-events.ts.
import { ncrSeverity } from '@/server/db/codes';
import { getDb } from '@/server/db/client';
import { VIGIE_NOTICE, pendingApprovalKeys } from '@/domain/vigie-events';
import { notifyPersonIds, personIdsWithRoles, projectLeadIds, projectReferentIds } from '@/server/dal/person-notices';
import type { VigieEcoRecord, VigieNcrRecord } from './types';

/** "NCR raised": each new NCR to its project's leads and quality / engineering referents (else the leads). Returns the recipients per NCR. */
export async function notifyNewNcrs(records: readonly VigieNcrRecord[]): Promise<{ number: string; to: string[] }[]> {
  const db = await getDb();
  const out: { number: string; to: string[] }[] = [];
  for (const r of records) {
    const [leads, referents] = await Promise.all([projectLeadIds(db, r.projectCode), projectReferentIds(db, r.projectCode, ['quality', 'englead'])]);
    const sub = [r.number, ncrSeverity.isCode(r.severity) ? ncrSeverity.label(r.severity) : r.severity, r.title, r.raisedBy].filter(Boolean).join(' · ');
    const to = await notifyPersonIds(
      { kind: 'quality', title: VIGIE_NOTICE.ncrRaised, sub, screen: 'quality', params: { qTab: 'ncr', ncr: r.number }, projectCode: r.projectCode },
      [...leads, ...referents], null,
    );
    out.push({ number: r.number, to });
  }
  return out;
}

/** "ECO waiting for your approval": the holders of its pending keys (PM key → leads of the affected projects). */
export async function notifyEcosToApprove(records: readonly VigieEcoRecord[]): Promise<{ number: string; to: string[] }[]> {
  const db = await getDb();
  const out: { number: string; to: string[] }[] = [];
  for (const r of records) {
    const keys = pendingApprovalKeys(r);
    const holders: string[] = [];
    if (keys.includes('pm')) for (const code of r.projects) holders.push(...(await projectLeadIds(db, code)));
    const roles = keys.filter((k) => k === 'quality' || k === 'englead');
    if (roles.length) holders.push(...(await personIdsWithRoles(db, roles)));
    const to = await notifyPersonIds(
      { kind: 'eco', title: VIGIE_NOTICE.ecoToApprove, sub: `${r.number} · ${r.title}`, screen: 'eco', params: { eco: r.number }, projectCode: null },
      holders, null,
    );
    out.push({ number: r.number, to });
  }
  return out;
}
