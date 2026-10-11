// Throwaway review test (seams): R-098 stock issues × R-073 EVM (AC / CPI / EAC) × Budget work packages.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { applyStockMovement, listStock } from '@/server/dal/stock';
import { getCostControl } from '@/server/dal/cost';
import { getProjectEvm } from '@/server/dal/evm';
import { getProject } from '@/server/dal/projects';

beforeAll(async () => {
  setDb(await openDatabase());
}, 120_000);

const snap = async () => {
  const cc = (await getCostControl('HLT-026'))!;
  const evm = (await getProjectEvm('HLT-026'))!;
  const p = (await getProject('HLT-026'))!;
  const wpSum = cc.workPackages.reduce((s, w) => s + w.actual, 0);
  return { wp: cc.workPackages.map((w) => [w.wbs, Math.round(w.actual * 10) / 10, w.eac]), wpSum: Math.round(wpSum * 10) / 10, acLast: cc.ac.at(-1), evmAc: evm.ac, cpi: evm.cpi, registerActual: p.actual, cpiText: (p.budget * p.progress) / p.actual };
};

describe('stock issue × EVM', () => {
  it('an issue moves the WP actual but not AC / CPI / EAC / register actual', async () => {
    const before = await snap();
    const l = (await listStock()).find((s) => s.ref === 'FD-SPR-HD' && s.location === 'Entrepôt central — Lyon')!;
    await applyStockMovement(l.id, { op: 'issue', qty: 500, projectCode: 'HLT-026', activityCode: 'A1250' } as never, 'Fabien Bertrand');
    const after = await snap();
    (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-Keystone/daa84d35-0be7-57a3-895a-75069f5e62a4/scratchpad/rv/stock-evm.json', JSON.stringify({ unit: l.unitCostEur, before, after }, null, 1));
    expect(after.wpSum).toBeGreaterThan(before.wpSum);
  }, 300_000);
});
