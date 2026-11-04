// S-27 — supplier schedule slips told to the buyer and the project's leads on the demo database (HLT-026, PO-1078): once per
// slip level (5, 10, 15… working days), nothing new while the level holds or falls, again after the schedule came back under
// the threshold.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { listNotifications } from './notifications';
import { runSupplierSlipAlerts } from './supplier-slip-notices';
import { createSupplierSchedule, saveSupplierActivity } from './supplier-schedules';

const BUYER = { name: 'Fabien Bertrand', role: 'procurement' };
const manufacturing = (duration: number) =>
  saveSupplierActivity('HLT-026', 'PO-1078', 'F10', { code: 'F10', name: 'Manufacturing', duration: String(duration), committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: false }, BUYER);
const slipNotices = async (role: 'procurement' | 'pm' | 'director') => (await listNotifications(role)).filter((n) => n.title.startsWith('Supplier schedule slipping'));

beforeAll(async () => {
  setDb(await openDatabase());
  await createSupplierSchedule('HLT-026', 'PO-1078', { template: false }, BUYER);
  await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F10', name: 'Manufacturing', duration: '20', committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: true }, BUYER);
}, 120_000);

describe('supplier slip alerts (S-27)', () => {
  it('on time: watched, nothing told', async () => {
    const r = await runSupplierSlipAlerts(DEMO_TODAY_ISO);
    expect(r).toMatchObject({ watched: 1, slipping: 0, raised: 0, notified: 0 });
    expect(await slipNotices('procurement')).toEqual([]);
  });

  it('a slip of 5 working days or more alerts the buyer and the project manager, once per level', async () => {
    await manufacturing(30); // ≈ 10 working days late: level 2, told once
    const r = await runSupplierSlipAlerts(DEMO_TODAY_ISO);
    expect(r).toMatchObject({ watched: 1, slipping: 1, raised: 1 });
    expect(r.notified).toBeGreaterThanOrEqual(2);
    const [n] = await slipNotices('procurement');
    expect(n.title).toMatch(/^Supplier schedule slipping · PO-1078 · \+\d+ working days$/);
    expect(await slipNotices('pm')).toHaveLength(1);
    // Not the directors (not on the order, not a lead of HLT-026).
    expect(await slipNotices('director')).toEqual([]);
    // Same level the next morning: nothing new.
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(0);
    await manufacturing(32); // still level 2
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(0);
  }, 120_000);

  it('a further level is told; a level reached again after falling is not', async () => {
    await manufacturing(36); // level 3
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(1);
    expect(await slipNotices('pm')).toHaveLength(2);
    await manufacturing(30); // back to level 2
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(0);
    await manufacturing(36); // level 3 again: already told
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(0);
  }, 120_000);

  it('back under the threshold clears the levels: a new slip is told again', async () => {
    await manufacturing(20);
    expect(await runSupplierSlipAlerts(DEMO_TODAY_ISO)).toMatchObject({ slipping: 0, cleared: 1 });
    await manufacturing(27); // level 1
    expect((await runSupplierSlipAlerts(DEMO_TODAY_ISO)).raised).toBe(1);
    expect(await slipNotices('pm')).toHaveLength(3);
  }, 120_000);
});
