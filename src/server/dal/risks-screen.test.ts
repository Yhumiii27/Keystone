// Risk register / Contingency screen reads and the Risk register nav badge, against an in-memory PGlite migrated
// from ./drizzle and seeded from the prototype (docs/spec/07 §1.1 badges "risks 1", §2.1; 04 §5).
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { PROTO } from '@/server/prototype';
import { riskBadge, riskBadges } from './risks-badge';
import { getContingencyScreen, getRiskScreen, riskOwnerOptions } from './risks-screen';
import { updateRisk } from './risks';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('getRiskScreen', () => {
  it('HLT-026: 8 risks, contingency €150k (PD.recon.cont), owners = DEFS team', async () => {
    const s = (await getRiskScreen('HLT-026'))!;
    expect(s.register.risks).toHaveLength(8);
    expect(s.contingency).toBe(150);
    expect(s.team).toEqual(PROTO.DEFS['HLT-026'].team);
  });

  it('other projects with data compare with DEFS.cont (NDC-031 → 100)', async () => {
    const s = (await getRiskScreen('NDC-031'))!;
    expect([s.register.risks.length, s.contingency, s.register.openEmv]).toEqual([4, 100, 115]);
    expect(s.team).toEqual(PROTO.DEFS['NDC-031'].team);
  });

  it('projects without data: empty register, contingency = default provision, owners = the whole pool', async () => {
    const s = (await getRiskScreen('EWA-051'))!;
    expect(s.register.risks).toEqual([]);
    const c = (await getContingencyScreen('EWA-051'))!.contingency;
    expect([c.isDefault, s.contingency]).toEqual([true, c.initial]);
    expect(await riskOwnerOptions('EWA-051')).toEqual((PROTO.PEOPLE as [string][]).map((p) => p[0]));
    expect(await getRiskScreen('NOPE-000')).toBeNull();
  });
});

describe('getContingencyScreen', () => {
  // Delivery 7 (C-4): no approver is chosen any more; "Linked to" offers the project's change requests (not drafts), risks
  // (open first) and NCRs.
  it('HLT-026 register and the items a draw-down can be linked to', async () => {
    const s = (await getContingencyScreen('HLT-026'))!;
    expect([s.contingency.initial, s.contingency.drawn, s.contingency.remaining, s.contingency.exposure]).toEqual([150, 48, 102, 340]);
    expect(s.links.filter((l) => l.type === 'change_request').map((l) => l.value)).toEqual(['CR-004', 'CR-006', 'CR-007', 'CR-008', 'CR-005']);
    expect(s.links.find((l) => l.value === 'CR-004')!.label).toBe('CR-004 · Additional piling — soft ground at Bay 4');
    expect(s.links.filter((l) => l.type === 'risk').map((l) => l.value).at(-1)).toBe('R-05');
    expect(s.links.some((l) => l.type === 'ncr')).toBe(true);
    expect(await getContingencyScreen('NOPE-000')).toBeNull();
  });
});

describe('riskBadge (open risks with score ≥ 15)', () => {
  it('"1" for every project with a register, "" otherwise', async () => {
    expect(await riskBadge('HLT-026')).toBe('1');
    expect(await riskBadge('EWA-051')).toBe('');
    expect(await riskBadges()).toEqual({ 'HLT-026': '1', 'NDC-031': '1', 'RCF-019': '1', 'ERP-202': '1', 'WSA-044': '1', 'MSR-012': '1' });
  });

  it('follows drawer edits: R-07 to P 3 (15) → 2; closing R-03 → 1', async () => {
    await updateRisk('HLT-026', 'R-07', { probability: 3 }, 'Marie Lefebvre');
    expect(await riskBadge('HLT-026')).toBe('2');
    await updateRisk('HLT-026', 'R-03', { status: 'closed' }, 'Marie Lefebvre');
    expect(await riskBadge('HLT-026')).toBe('1');
    expect((await riskBadges())['HLT-026']).toBe('1');
  });
});
