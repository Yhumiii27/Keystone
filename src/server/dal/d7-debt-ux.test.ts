// Delivery 7 — lot debt-ux against an in-memory database: R-170 (no run-time read of the prototype data: zones and their
// managers, the header project switcher, Settings "Reset to defaults" from the stored defaults, the added-activity
// numbering) and R-169 (prototype constants replaced by data: CCB approver, delivery terms of new orders, site premium,
// notification channels, where-used default part).
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { projectOptionHaystack, projectOptionSub } from '@/components/app/shell/project-options';
import { APP_SETTING_DEFAULTS } from '@/domain/settings-defaults';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { appSettings, connectors, persons, referenceValues, storageLocations, zones } from '@/server/db/schema';
import { listChangeRequestDetails } from './changes';
import { setMultiplier } from './hr';
import { listConnectors } from './integrations';
import { getPlanData, projectIdxOf } from './plan';
import { getProject } from './projects';
import { createWizardProject, getNewProjectSetup } from './projects-register';
import { awardRfq, createDraftPurchaseOrders, getPurchaseOrder } from './purchasing';
import { addLocation, addReferenceValue, getSettings, readSettingsDefaults, removeReferenceValue, resetSettings, setHealthThresholds } from './settings';
import { listZoneDefs, zoneBarOf, zoneLabel } from './shell';
import { getSite } from './site';

const DIRECTOR = { role: 'director', name: 'Marie Lefebvre' };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-170 — zones and their managers from the zones table', () => {
  it('reads the seeded zones (the prototype values), then follows a change of manager or label', async () => {
    expect(await listZoneDefs()).toEqual([
      { key: 'euna', label: 'Europe & North America', manager: 'Olivier Castel' },
      { key: 'afr', label: 'Africa', manager: 'Aïcha Diallo' },
      { key: 'apac', label: 'Asia Pacific', manager: 'Sophie Nguyen' },
    ]);
    expect(await zoneBarOf('overview', null)).toMatchObject({ ownerLabel: 'Zone managers', ownerName: 'O. Castel · A. Diallo · S. Nguyen' });
    const db = await getDb();
    const [aubert] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Romain Aubert'));
    await db.update(zones).set({ managerPersonId: aubert.id, label: 'Africa & Middle East' }).where(eq(zones.code, 'afr'));
    expect(await zoneBarOf('overview', 'afr')).toMatchObject({ ownerLabel: 'Zone manager', ownerName: 'Romain Aubert' });
    expect((await zoneBarOf('fleet', null)).options.map((o) => o.label)).toEqual(['All zones', 'Europe & North America', 'Africa & Middle East', 'Asia Pacific']);
    expect([await zoneLabel('afr'), await zoneLabel(null)]).toEqual(['Africa & Middle East', '']);
    await db.update(zones).set({ managerPersonId: null }).where(eq(zones.code, 'afr'));
    expect((await zoneBarOf('overview', 'afr')).ownerName).toBe('—');
    expect((await zoneBarOf('overview', null)).ownerName).toBe('O. Castel · S. Nguyen');
  });
});

describe('R-170 — header project switcher from the project record', () => {
  it('the seeded projects read as the prototype did; a wizard project shows its own codes', async () => {
    const hlt = (await getProject('HLT-026'))!;
    expect(projectOptionSub(hlt)).toBe('HAV004 · DAS 2 · EMP · R. Aubert');
    expect(projectOptionHaystack(hlt, 'Extension du terminal Harbor Line')).toBe('hlt-026 harbor line terminal expansion #026 hav004 r. aubert port authority extension du terminal harbor line');
    expect(projectOptionSub((await getProject('EWA-051'))!)).toBe(' · DAS — ·  · S. Perrin');
    const setup = await getNewProjectSetup();
    const created = await createWizardProject({
      name: 'Sun Valley Farm', client: 'Energy BU', das: '3', machineType: 'SPUR', currency: 'EUR', templateCode: 'blank', categories: [], contingencyPct: 5,
      calendar: 'standard_5x8', pmPersonId: setup.managers.find((m) => m.short === 'R. Aubert')!.id,
    });
    const p = (await getProject(created.code))!;
    expect(projectOptionSub(p)).toMatch(/^[A-Z]{3}\d{3} · DAS 3 · SPUR · R\. Aubert$/);
    expect(projectOptionHaystack(p, p.name)).toContain('sun valley farm');
  });
});

describe('R-170 — added-activity numbering without the prototype DEFS', () => {
  it('takes the digit after "A" of the project activities (the DEFS idx of the six projects)', async () => {
    expect(projectIdxOf(['A3110', 'A3120'])).toBe(3);
    expect(projectIdxOf(['X1', 'B2'])).toBe(1);
    expect(projectIdxOf([])).toBe(1);
    for (const [code, idx] of [['HLT-026', 1], ['NDC-031', 3], ['RCF-019', 2], ['ERP-202', 4], ['WSA-044', 5], ['MSR-012', 6]] as const) {
      expect([code, (await getPlanData(code))!.projectIdx]).toEqual([code, idx]);
    }
  });
});

describe('R-170 — Settings "Reset to defaults" from the stored defaults', () => {
  it('the seed stores the defaults document (lists, six locations, thresholds)', async () => {
    const d = (await readSettingsDefaults())!;
    expect(d.locations).toHaveLength(6);
    expect(d.health).toEqual({ risk: 0.97, off: 0.9 });
    expect(d.lists.filter((e) => e.listKey === 'riskCats').map((e) => e.code)).toEqual((await getSettings()).lists.riskCats.map((r) => r.code));
  });

  it('restores what the stored document says — a document IT changes is what Reset restores', async () => {
    await addReferenceValue('riskCats', 'Cyber security', DIRECTOR);
    await removeReferenceValue('riskCats', 'technical', DIRECTOR);
    await addLocation('Yard — Dakar', 'site_store', DIRECTOR);
    await setHealthThresholds({ risk: 0.95, off: 0.85 }, DIRECTOR);
    await resetSettings(DIRECTOR);
    const s = await getSettings();
    const stored = (await readSettingsDefaults())!;
    expect(s.lists.riskCats.map((r) => r.code)).toEqual(stored.lists.filter((e) => e.listKey === 'riskCats').map((e) => e.code));
    expect(s.locations.map((l) => l.name)).toEqual(stored.locations.map((l) => l.name));
    expect(s.health).toEqual({ risk: 0.97, off: 0.9 });
    // IT changes the defaults document (no Keystone screen does): Reset follows it.
    const db = await getDb();
    const doc = { ...stored, lists: stored.lists.filter((e) => !(e.listKey === 'riskCats' && e.code !== 'technical')), locations: stored.locations.slice(0, 2), health: { risk: 0.99, off: 0.8 } };
    await db.update(appSettings).set({ value: doc }).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    await resetSettings(DIRECTOR);
    const after = await getSettings();
    expect(after.lists.riskCats.map((r) => r.code)).toEqual(['technical']);
    expect(after.locations.map((l) => l.name)).toEqual(stored.locations.slice(0, 2).map((l) => l.name));
    expect(after.health).toEqual({ risk: 0.99, off: 0.8 });
    expect(after.lists.skills.length).toBe(stored.lists.filter((e) => e.listKey === 'skills').length);
    // An invalid document is ignored: entries flagged default (current order), locations untouched, default thresholds.
    await db.update(appSettings).set({ value: { lists: 'nope' } }).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    expect(await readSettingsDefaults()).toBeNull();
    await resetSettings(DIRECTOR);
    const fb = await getSettings();
    expect(fb.health).toEqual({ risk: 0.97, off: 0.9 });
    expect(fb.locations.map((l) => l.name)).toEqual(after.locations.map((l) => l.name));
    const defaults = await db.select({ code: referenceValues.code }).from(referenceValues).where(and(eq(referenceValues.listKey, 'riskCats'), eq(referenceValues.isDefault, true)));
    expect(fb.lists.riskCats.map((r) => r.code).sort()).toEqual(defaults.map((r) => r.code).sort());
    // Restore the seeded document for the other tests.
    await db.update(appSettings).set({ value: stored }).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    await resetSettings(DIRECTOR);
  });

  it('only the portfolio director resets (A-14)', async () => {
    await expect(resetSettings({ role: 'pm', name: 'Romain Aubert' })).rejects.toThrow(/portfolio director/);
    await expect(resetSettings({ role: 'member', name: 'Julien Wagner' })).rejects.toThrow(/outside your workspace|portfolio director/);
  });

  it('a database seeded before Delivery 7 gets the document on its next start (backfill)', async () => {
    const db = await getDb();
    await db.delete(appSettings).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    expect(await readSettingsDefaults()).toBeNull();
    const { seedIfEmpty } = await import('@/server/db/seed');
    expect(await seedIfEmpty(db)).toBe(false);
    expect((await readSettingsDefaults())!.locations).toHaveLength(6);
  });
});

describe('R-169 — prototype constants replaced by data', () => {
  it('CCB step: the portfolio director who records the decision (P-6a), not "Monthly · next 8 Oct"', async () => {
    const cr8 = (await listChangeRequestDetails('HLT-026')).find((c) => c.id === 'CR-008')!;
    expect(cr8.chain.find((s) => s.step === 'ccb')!.approver).toBe('Marie Lefebvre');
  });

  it('delivery terms of a new order: RFQ incoterm + winning quote terms; nothing known for a shortfall draft', async () => {
    const { purchaseOrderNumber } = await awardRfq('RFQ-2026-031', 'Dillinger', 'Fabien Bertrand');
    expect((await getPurchaseOrder(purchaseOrderNumber!))!.deliveryTerms).toBe('Net 45');
    const [n] = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    expect((await getPurchaseOrder(n))!.deliveryTerms).toBe('');
    // Seeded orders keep the prototype's text.
    expect((await getPurchaseOrder('PO-1082'))!.deliveryTerms).toBe('Site gate 2 · DAP · Net 30');
  });

  it('site premium: the weekend multipliers of the rate grid, as Resources › Rates sets them', async () => {
    expect((await getSite('HLT-026'))!.premium).toEqual({ sat: 1.5, sun: 2 });
    // R-083: the factor in force on the business date (25 Sep 2026) — a version from that date.
    await setMultiplier('sat', 1.4, '2026-09-25', { name: 'Marie Lefebvre', role: 'director' });
    expect((await getSite('HLT-026'))!.premium).toEqual({ sat: 1.4, sun: 2 });
    await setMultiplier('sat', 1.5, '2026-09-25', { name: 'Marie Lefebvre', role: 'director' });
  });

  it('notification channels: in-app only while no e-mail or Teams connector is live (R-021 over R-169)', async () => {
    const { notificationChannels } = await import('@/domain/admin');
    // R-021 (A-15, X-6): the seeded e-mail and Teams rows have no connector code behind them — not channels, enabled or not.
    expect(notificationChannels(await listConnectors())).toEqual({ count: 1, sub: 'In-app · e-mail and Teams not connected' });
    const db = await getDb();
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Microsoft Teams'));
    expect(notificationChannels(await listConnectors())).toEqual({ count: 1, sub: 'In-app · e-mail and Teams not connected' });
    await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Microsoft Teams'));
  });

  it('storage locations untouched by the stored-defaults test helpers', async () => {
    const db = await getDb();
    expect((await db.select().from(storageLocations).where(eq(storageLocations.active, true))).length).toBe(6);
  });
});
