// R-010 — the edit forms under optimistic locking, writer by writer: contract sheet, payment milestone, cost category, warranty
// claim. Each time, two people read the record; the first save wins, the second (read on the old version) is refused with who
// saved meanwhile, and nothing of it is written; read again, it is saved.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { updateProjectCostCategory } from './budget-categories';
import { getClaim, updateClaim } from './claims';
import { getContract, updateContractSheet, updatePaymentMilestone } from './contract';
import { getCostControl } from './cost';
import { StaleRecordError } from './record-version';

const ROMAIN = 'Romain Aubert';
const MARIE = 'Marie Lefebvre';
const refused = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(StaleRecordError);
  return e as StaleRecordError;
};

describe('edit forms refuse a record changed meanwhile by someone else', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('contract sheet: a field saved by Romain makes Marie\'s sheet stale', async () => {
    const token = (await getContract('HLT-026'))!.sheet.version;
    await updateContractSheet('HLT-026', { warranty: '24 months' }, ROMAIN, { version: token });
    expect((await refused(updateContractSheet('HLT-026', { scope: 'Changed by Marie' }, MARIE, { version: token }))).by).toBe(ROMAIN);
    const c = (await getContract('HLT-026'))!;
    expect([c.sheet.warranty, c.sheet.scope === 'Changed by Marie']).toEqual(['24 months', false]);
    await updateContractSheet('HLT-026', { scope: 'Changed by Marie' }, MARIE, { version: c.sheet.version });
    expect((await getContract('HLT-026'))!.sheet.scope).toBe('Changed by Marie');
  });

  it('payment milestone "Edit": the second form opened on the same version is refused', async () => {
    const m = (await getContract('HLT-026'))!.milestones.find((x) => x.status === 'planned' && x.amendment == null)!;
    const patch = { label: m.label, sharePct: m.sharePct, contractualDue: '2027-02-01', condition: m.condition };
    await updatePaymentMilestone('HLT-026', m.number, patch, { name: ROMAIN, role: 'pm' }, { version: m.version });
    const e = await refused(updatePaymentMilestone('HLT-026', m.number, { ...patch, contractualDue: '2027-03-01' }, { name: MARIE, role: 'director' }, { version: m.version }));
    expect(e.by).toBe(ROMAIN);
    expect((await getContract('HLT-026'))!.milestones.find((x) => x.number === m.number)!.contractualDue).toBe('2027-02-01');
  });

  it('cost category "Edit category": refused after another person renamed it', async () => {
    const c = (await getCostControl('NDC-031'))!.categories[0];
    await updateProjectCostCategory('NDC-031', c.code, { name: `${c.name} (Romain)` }, ROMAIN, { version: c.version });
    expect((await refused(updateProjectCostCategory('NDC-031', c.code, { name: `${c.name} (Marie)` }, MARIE, { version: c.version }))).by).toBe(ROMAIN);
    expect((await getCostControl('NDC-031'))!.categories[0].name).toBe(`${c.name} (Romain)`);
  });

  it('warranty claim "Edit claim": refused after another person changed it; the same person\'s second save passes', async () => {
    const c = (await getClaim('WC-013'))!;
    const input = { coverage: c.coverage, owner: c.owner, costKeur: c.costKeur + 1, nextStep: c.nextStep, diagnosis: c.diagnosis ?? 'Worn part', ecoNumber: c.ecoNumber };
    await updateClaim(c.number, input, { name: ROMAIN, role: 'pm' }, { version: c.version });
    await updateClaim(c.number, { ...input, costKeur: c.costKeur + 2 }, { name: ROMAIN, role: 'pm' }, { version: c.version });
    expect((await refused(updateClaim(c.number, { ...input, costKeur: 0 }, { name: MARIE, role: 'pm' }, { version: c.version }))).by).toBe(ROMAIN);
    expect((await getClaim('WC-013'))!.costKeur).toBe(c.costKeur + 2);
  });
});
