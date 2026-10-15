// R-145 (NEW-D5-2 = a) on the data layer, on its own in-memory database (the per-zone goldens of delivery5.test.ts stay
// on the untouched seed): the warranty status is the one in force today, computed on read — an expired extension reads
// Out of warranty, a running extension Extended with its end, an extension ending within three months is ending soon —
// while the "Warranty end" column keeps the contractual date; the warranty cost tile counts the claims reported this
// calendar year only (a claim of 2025 is left out of the value and of its chargeable sub-line, never out of the per-machine
// figures nor the other tiles). No extension writer exists: the rows are inserted as data would bring them.
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fleetKpis, savKpis } from '@/domain/aftersales';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { machines, warrantyClaims } from '@/server/db/schema';
import { fleetView, savView } from '@/features/aftersales/model';
import { getFleetScreen, getSavScreen } from './aftersales';
import { listMachines } from './fleet';

beforeAll(async () => {
  setDb(await openDatabase());
  const db = await getDb();
  const [{ position }] = await db.select({ position: machines.position }).from(machines).where(eq(machines.number, 'MCH-040'));
  const rows = await db
    .insert(machines)
    .values([
      // Extension expired on 31 Aug 2026 (stored status still "Extended").
      { number: 'MCH-090', machineTypeCode: 'EMP', name: 'Gantry crane 30 t', clientName: 'Port authority', siteText: 'Le Havre · quay 9', deliveredOn: '2022-05-01', warrantyEndOn: '2024-05-01', warrantyStatus: 'extended', extendedUntil: '2026-08-31', position: position + 50 },
      // Extension running until 15 Dec 2026: Extended, ending within three months.
      { number: 'MCH-091', machineTypeCode: 'MEMU', name: 'Overhead crane 10 t', clientName: 'Port authority', siteText: 'Le Havre · hall 2', deliveredOn: '2023-01-10', warrantyEndOn: '2025-01-10', warrantyStatus: 'extended', extendedUntil: '2026-12-15', position: position + 51 },
      // Contractual end passed yesterday (stored status still "In warranty").
      { number: 'MCH-092', machineTypeCode: 'EMP', name: 'Gantry crane 25 t', clientName: 'Port authority', siteText: 'Le Havre · quay 8', deliveredOn: '2024-09-29', warrantyEndOn: '2026-09-29', warrantyStatus: 'in_warranty', extendedUntil: null, position: position + 52 },
    ])
    .returning({ id: machines.id, number: machines.number });
  const id = (n: string) => rows.find((r) => r.number === n)!.id;
  await db.insert(warrantyClaims).values([
    { number: 'WC-090', machineId: id('MCH-090'), issue: 'Hoist motor overheating', severity: 'major', reportedOn: '2025-11-10', status: 'closed', coverage: 'extended_warranty', costKeur: 9, ownerName: 'T. Kerbrat', nextStep: '—', position: 90 },
    { number: 'WC-091', machineId: id('MCH-090'), issue: 'Cabin glass broken', severity: 'minor', reportedOn: '2025-12-02', status: 'closed', coverage: 'chargeable', costKeur: 4, ownerName: 'T. Kerbrat', nextStep: '—', position: 91 },
  ]);
}, 60_000);

describe('R-145 warranty in force (listMachines, Installed base)', () => {
  it('status, status text and ending alert come from the warranty in force; the warranty end column keeps the contractual date', async () => {
    const by = new Map((await listMachines()).map((m) => [m.number, m]));
    const pick = (n: string) => {
      const m = by.get(n)!;
      return [m.warrantyStatus, m.warrantyText, m.warrantyEndOn, m.warrantyEndingSoon, m.warrantyEndsInDays];
    };
    expect(pick('MCH-090')).toEqual(['out_of_warranty', 'Out of warranty', '2024-05-01', false, null]);
    expect(pick('MCH-091')).toEqual(['extended', 'Extended → 15 Dec 2026', '2025-01-10', true, 75]);
    expect(pick('MCH-092')).toEqual(['out_of_warranty', 'Out of warranty', '2026-09-29', false, null]);
    // The seed reads as before: MCH-022's extension runs until 4 Jun 2027, MCH-029 is out, MCH-035 ends in 31 days.
    expect(pick('MCH-022')).toEqual(['extended', 'Extended → 4 Jun 2027', '2025-06-04', false, null]);
    expect(pick('MCH-029')[0]).toBe('out_of_warranty');
    expect(pick('MCH-035')).toEqual(['in_warranty', 'In warranty', '2026-11-01', true, 31]);
  });

  it('Installed base tiles and rows (EN, FR)', async () => {
    const data = await getFleetScreen(null);
    const tiles = Object.fromEntries(fleetKpis(data.machines).map((k) => [k.label, [k.value, k.sub]]));
    expect(tiles['In warranty']).toEqual(['6', '2 extended']);
    expect(tiles['Warranty ending < 90 days']).toEqual(['2', 'MCH-035 · MCH-091']);
    const fr = fleetView(data, null, makeT('fr'), 'fr');
    const row = (n: string) => fr.rows.find((r) => r.number === n)!;
    expect([row('MCH-090').status, row('MCH-090').statusClass, row('MCH-090').warrantyEnd]).toEqual(['Hors garantie', 'tag tag-outline', '1 mai 2024']);
    expect([row('MCH-091').statusClass, row('MCH-091').warrantyEnd, row('MCH-091').warrantyEndSub]).toEqual(['tag tag-accent', '10 janv. 2025', 'finit dans 75 j']);
    expect(row('MCH-091').status).toBe('Étendue → 15 déc. 2026');
  });
});

describe('R-145 warranty cost of the calendar year (Warranty & claims)', () => {
  it('the 2025 claims are left out of the tile and its sub-line, not out of the per-machine costs nor the other tiles', async () => {
    const data = await getSavScreen(null);
    expect(data.claims.map((c) => c.number)).toEqual(expect.arrayContaining(['WC-090', 'WC-091']));
    const tile = savKpis(data.claims, data.interventions, 'en').find((k) => k.label === 'Warranty cost YTD')!;
    expect([tile.value, tile.sub]).toEqual(['€34k', '€6k chargeable']); // the seed's 2026 figures
    expect(savKpis(data.claims, data.interventions, 'en').find((k) => k.label === 'Open claims')!.value).toBe('5');
    // A new year: nothing counted yet.
    const jan = savKpis(data.claims, data.interventions, 'en', '2027-01-05').find((k) => k.label === 'Warranty cost YTD')!;
    expect([jan.value, jan.sub]).toEqual(['€0k', '€0k chargeable']);
    // The costs per machine keep every claim (the register is not a year figure).
    const costs = savView(data, 'costs', null, makeT('en'), 'en').costs!;
    expect(costs.find((r) => r.number === 'MCH-090')).toMatchObject({ claims: 2, warrantyCost: '€9k', chargeable: '€4k', sub: 'Port authority · Out of warranty' });
  });

  it('FR label « Coût garantie de l’année » (NEW-D5-2)', async () => {
    const fr = savView(await getSavScreen(null), 'claims', null, makeT('fr'), 'fr');
    expect(fr.kpis[2]).toMatchObject({ label: 'Coût garantie de l’année', value: '34 k€', sub: '6 k€ facturable' });
  });
});
