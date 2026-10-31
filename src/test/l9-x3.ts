// L9-X3 (owner, 31 Oct 2026): the demo data set files three of EXP-01's shipping documents in Codex (src/server/db/seed/shipments.ts
// `DEMO_FILED_SHIPPING_DOCUMENTS`, through the real filing). The golden tests compare Keystone with the prototype, which has none:
// they compare the documents vault without them (and say so), and the counts that include them say by how much.

/** The Codex index records the demo files (packing list, CMR, delivery note of EXP-01, rev A, released). */
export const L9X3_DOC_NUMBERS: readonly string[] = ['SHP-HLT-040', 'SHP-HLT-041', 'SHP-HLT-042'];
/** Records, stored PDFs and pending Codex deposits the demo filing adds. */
export const L9X3_FILED = 3;
/** The Codex document type the first filing adds to Keystone's register. */
export const L9X3_TYPE = 'SHP';

/** A list of index records without the L9-X3 ones (`number` or `id`). */
export function withoutL9X3<T extends { number?: string; id?: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !L9X3_DOC_NUMBERS.includes((r.number ?? r.id)!));
}

/** The document types register without the type L9-X3 added. */
export function withoutL9X3Type<T extends { code: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.code !== L9X3_TYPE);
}

/** Audit rows the demo filing writes: the shipment's and each record's (`object`, `who`: the logistics coordinator). */
export const L9X3_AUDIT_ROWS = 2 * L9X3_FILED;
export function isL9X3Audit(r: { object: string; who: string }): boolean {
  return r.who === 'Camille Verdier' && (r.object === 'Shipment EXP-01' || L9X3_DOC_NUMBERS.includes(r.object));
}
/** Activity events the demo filing writes (one per document, system message `shipment.documentFiled`). */
export function isL9X3Activity(r: { messageKey: string | null }): boolean {
  return r.messageKey === 'shipment.documentFiled';
}

/**
 * The Activity & integrations inputs as the prototype had them: the feed and the trail without the L9-X3 rows, the trail's
 * last-7-days count without those of them in the window (the 21 Sep filings; the demo date is Fri 25 Sep).
 */
export function withoutL9X3Plumbing<A extends { messageKey: string | null }, R extends { object: string; who: string; occurredAt: string }, C extends { auditLast7Days: number }>(
  activity: A[], audit: R[], counts: C,
): { activity: A[]; audit: R[]; counts: C } {
  const inWeek = audit.filter((a) => isL9X3Audit(a) && a.occurredAt >= '2026-09-17T22:00:00.000Z').length;
  return { activity: activity.filter((a) => !isL9X3Activity(a)), audit: audit.filter((a) => !isL9X3Audit(a)), counts: { ...counts, auditLast7Days: counts.auditLast7Days - inWeek } };
}
