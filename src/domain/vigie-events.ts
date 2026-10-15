// Events Keystone notices in a Vigie refresh (R-015, X-6a) — dormant until Vigie publishes its API (V-3): only the HTTP
// connectors' full refresh compares the mirror before and after (src/server/integrations/vigie/notices.ts); the seed and
// the mock never do. Pure rules.
// - an NCR Vigie reports for the first time ("NCR raised") → the project's leads, plus its quality and engineering
//   referents (team role "referent"), else the leads alone;
// - an ECO entering "In approval" (new, or coming from another status) → the holder of each pending approval key: the PM
//   key → the leads of the affected projects; the quality and englead keys → the users holding those roles (the director
//   holds none).
// The first refresh of an empty mirror (a production database has no Vigie mirror; the first live read returns Vigie's whole
// history) is the baseline: it announces nothing. A closed NCR is never announced as raised.

export interface NcrKey {
  projectCode: string;
  number: string;
}

const ncrKey = (k: NcrKey) => `${k.projectCode}|${k.number}`;

/** The NCRs of `records` the mirror did not hold before the refresh (by project and number). */
export function newNcrs<R extends NcrKey>(before: readonly NcrKey[], records: readonly R[]): R[] {
  const known = new Set(before.map(ncrKey));
  return records.filter((r) => !known.has(ncrKey(r)));
}

/**
 * The NCRs a refresh announces as raised: the new ones (`newNcrs`) not already closed in Vigie — none when the mirror held no
 * NCR before (first refresh = baseline).
 */
export function ncrsToAnnounce<R extends NcrKey & { status: string }>(before: readonly NcrKey[], records: readonly R[]): R[] {
  if (!before.length) return [];
  return newNcrs(before, records).filter((r) => r.status !== 'closed');
}

/** The ECOs that enter "In approval" with this refresh: in approval now, absent before or in another status. */
export function ecosEnteringApproval<R extends { number: string; status: string }>(before: ReadonlyMap<string, string>, records: readonly R[]): R[] {
  return records.filter((r) => r.status === 'in_approval' && before.get(r.number) !== 'in_approval');
}

/** The ECOs a refresh announces (`ecosEnteringApproval`) — none when the mirror held no ECO before (first refresh = baseline). */
export function ecosToAnnounce<R extends { number: string; status: string }>(before: ReadonlyMap<string, string>, records: readonly R[]): R[] {
  return before.size ? ecosEnteringApproval(before, records) : [];
}

/** Approval keys still waiting for a decision on an ECO (Vigie's own values). */
export function pendingApprovalKeys(eco: { approvals: readonly { key: string; decision: string }[] }): string[] {
  return eco.approvals.filter((a) => a.decision === 'pending').map((a) => a.key);
}

/** Fixed EN titles of the Vigie notices (translated by t(); the NCR / ECO text stays in the sub-line). */
export const VIGIE_NOTICE = {
  ncrRaised: 'Non-conformity raised in Vigie',
  ecoToApprove: 'Change order waiting for your approval',
} as const;
