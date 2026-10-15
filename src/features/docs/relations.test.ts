// Clickable Deliverable, Order and Punch-item relations of a document record (Delivery 8, R-128; D-2 context, spec 10
// OQ15), on a seeded in-memory database: each relation resolves in the record's OWN project (never the vault page's) —
// deliverable by number, purchase order by number then by Sage X3 reference (SC-4b), punch item by number (one list per
// project, A-6) —; a QMS record, a reference not found there and a client's drawer stay inert.
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { purchaseOrders } from '@/server/db/schema';
import { depositInCodex, getDocumentRecord } from '@/server/dal/documents';
import { drawerView, type DocsState } from './model';

const S0: DocsState = { scope: 'all', view: 'all', family: null, status: null, q: '', doc: null };
const DIRECTOR = { short: 'M. Lefebvre', role: 'director' };

async function links(number: string, page = 'HLT-026', viewer = DIRECTOR) {
  const record = (await getDocumentRecord(number))!;
  return drawerView({ project: page, record, state: { ...S0, doc: number }, viewer, canEdit: true }, makeT('en'), 'en').links;
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('relation targets (R-128)', () => {
  it('seeded records: deliverable and punch item open their screens; the seed’s PO-2026-118 is not an HLT-026 order (inert)', async () => {
    expect(await links('PID-HLT-026')).toEqual([{ kind: 'Deliverable', ref: 'D-016', href: '/projects/HLT-026/quality?tab=dlv&dlv=D-016' }]);
    expect(await links('PHO-HLT-011')).toEqual([{ kind: 'Punch item', ref: 'P-01', href: '/projects/HLT-026/itp?view=punch#punch-P-01' }]);
    expect(await links('NCR-HLT-029')).toEqual([{ kind: 'Punch item', ref: 'P-01', href: '/projects/HLT-026/itp?view=punch#punch-P-01' }]);
    expect((await links('REC-HLT-009'))[0]).toEqual({ kind: 'Purchase order', ref: 'PO-2026-118', href: null });
    expect((await links('CER-HLT-039'))[1]).toEqual({ kind: 'Purchase order', ref: 'PO-2026-104', href: null });
    // Article and change request keep their links.
    expect((await links('REC-HLT-009'))[1].href).toBe('/reference/parts?part=EL-VFD-200');
    expect(await links('CTR-HLT-002')).toEqual([{ kind: 'Change request', ref: 'CR-004', href: '/projects/HLT-026/changes?cr=CR-004' }]);
    const record = (await getDocumentRecord('PID-HLT-026'))!;
    expect(record.links).toEqual([{ kind: 'deliverable', kindLabel: 'Deliverable', ref: 'D-016', target: { screen: 'deliverable', project: 'HLT-026', ref: 'D-016' } }]);
  });

  it('a record deposited with a real HLT-026 order links to it; by Sage X3 reference too (SC-4b)', async () => {
    const { number } = await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'PO-1082', title: 'Mill certificate' }, 'Romain Aubert');
    expect((await links(number)).find((l) => l.ref === 'PO-1082')!.href).toBe('/projects/HLT-026/orders?po=PO-1082');
    const db = await getDb();
    await db.update(purchaseOrders).set({ x3Ref: 'X3-CMD-55821' }).where(eq(purchaseOrders.number, 'PO-1082'));
    const x3 = await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'X3-CMD-55821', title: 'Mill certificate (X3)' }, 'Romain Aubert');
    expect((await links(x3.number)).find((l) => l.ref === 'X3-CMD-55821')!.href).toBe('/projects/HLT-026/orders?po=PO-1082');
  });

  it('resolved in the record’s own project, whatever the vault page; unknown refs, another project’s order and QMS records stay inert', async () => {
    const { number } = await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'PO-1082', title: 'Mill certificate' }, 'Romain Aubert');
    // Opened from NDC-031's vault ("All projects"): the target is still HLT-026's order.
    expect((await links(number, 'NDC-031')).find((l) => l.ref === 'PO-1082')!.href).toBe('/projects/HLT-026/orders?po=PO-1082');
    const ndc = await depositInCodex({ typeCode: 'CER', project: 'NDC-031', linkedPo: 'PO-1082', title: 'Wrong project' }, 'Marie Lefebvre');
    expect((await links(ndc.number, 'NDC-031')).find((l) => l.ref === 'PO-1082')!.href).toBeNull();
    const unknown = await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'PO-9999', title: 'Unknown order' }, 'Romain Aubert');
    expect((await links(unknown.number)).find((l) => l.ref === 'PO-9999')!.href).toBeNull();
    const qms = await depositInCodex({ typeCode: 'CER', project: 'QMS', linkedPo: 'PO-1082', title: 'QMS certificate' }, 'Marie Lefebvre');
    expect((await getDocumentRecord(qms.number))!.links.map((l) => l.target)).toEqual([null]);
    expect((await links(qms.number)).find((l) => l.ref === 'PO-1082')!.href).toBeNull();
  });

  it('a client’s drawer keeps every relation inert (internal screens send the client home, P-1)', async () => {
    const client = { short: 'N. Bensaïd', role: 'client' };
    expect(await links('PID-HLT-026', 'HLT-026', client)).toEqual([{ kind: 'Deliverable', ref: 'D-016', href: null }]);
  });
});
