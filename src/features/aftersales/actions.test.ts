// After-sales Server Functions against an in-memory database: workspace gate, form parsing (translated refusals), the
// writes through the data layer with the viewer as the actor, and the screens afterwards compared with the prototype's
// own result of the same submissions (src/domain/aftersales.golden.json › added: AF `fleet` / AF `sav` via afSubmit).
// Deliberate deviations: machines added in Keystone are numbered MCH-050… and claims WC-020… (the prototype wrote
// "MCH-50", "WC-20"); a machine added in Keystone can receive a claim (07 OQ20); dates are parsed (the prototype kept
// any text). Session and screen access are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getScreenAccess: async () => ({ viewer: { name: viewer.name, role: viewer.role }, outside: !viewer.canEdit, canEdit: viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getFleetScreen, getSavScreen } from '@/server/dal/aftersales';
import { listClaims, savNavBadge } from '@/server/dal/claims';
import { machinesByZone } from '@/server/dal/fleet';
import { listAudit } from '@/server/dal/notifications';
import GOLDEN from '@/domain/aftersales.golden.json';
import { addMachineAction, openClaimAction } from './actions';
import { fleetView, savView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const { NEW_MACHINE, BARE_MACHINE, NEW_CLAIM, MINOR_CLAIM } = G.inputs;
const num = (s: string) => s.replace(/^MCH-(\d\d)$/, 'MCH-0$1').replace(/^WC-(\d\d)$/, (m, n) => (+n >= 20 ? `WC-0${n}` : m));
const agree = (s: string) => s.replace(/^1 clients$/, '1 client').replace(/^1 étendues$/, '1 étendue').replace(/^0 étendues$/, '0 étendue');

async function fleet(lang: Lang, zone: 'afr' | null = null) {
  return fleetView(await getFleetScreen(zone), zone, makeT(lang), lang);
}
async function claimsView(lang: Lang) {
  return savView(await getSavScreen(null), 'claims', null, makeT(lang), lang);
}

describe('after-sales Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    Object.assign(viewer, { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' });
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside the workspace (EN / FR), malformed values and unknown options; nothing is written', async () => {
    viewer.canEdit = false;
    expect(await addMachineAction(NEW_MACHINE)).toEqual({ error: 'The installed base is read-only for you' });
    expect(await openClaimAction(NEW_CLAIM)).toEqual({ error: 'Warranty claims are read-only for you' });
    viewer.lang = 'fr';
    expect(await addMachineAction(NEW_MACHINE)).toEqual({ error: 'Le parc installé est en consultation pour vous' });
    expect(await openClaimAction(NEW_CLAIM)).toEqual({ error: 'Les réclamations sont en consultation pour vous' });
    viewer.canEdit = true;
    expect(await addMachineAction({ ...NEW_MACHINE, warranty: 'bientôt' })).toEqual({ error: 'Saisissez la fin de garantie sous forme de date, par ex. 13 déc. 2027' });
    expect(await openClaimAction({ machine: 'MCH-041', issue: '' })).toEqual({ error: 'Le problème est obligatoire' });
    viewer.lang = 'en';
    expect(await addMachineAction({ ...NEW_MACHINE, type: 'R&D' })).toEqual({ error: 'Unknown machine type' });
    expect(await addMachineAction({ ...NEW_MACHINE, type: 'rnd' })).toEqual({ error: 'Unknown machine type' });
    expect(await addMachineAction({ ...NEW_MACHINE, delivered: '1 Oct 2026', warranty: '1 Jan 2026' })).toEqual({ error: 'Warranty end is before delivery' });
    expect(await addMachineAction(null as never)).toEqual({ error: 'Machine is required' });
    expect(await openClaimAction({ machine: 'MCH-999', issue: 'x' })).toEqual({ error: 'Unknown machine' });
    expect(await openClaimAction({ machine: 'MCH-041', issue: 'x', sev: 'Major' })).toEqual({ error: 'Unknown severity' });
    expect(await openClaimAction({ machine: 'MCH-041', issue: 'x', owner: 'R. Aubert' })).toEqual({ error: 'Unknown owner' });
    expect(await openClaimAction({ machine: 'MCH-041', issue: 42 } as never)).toEqual({ error: 'Issue is required' });
    expect((await machinesByZone()).total).toBe(8);
    expect(await listClaims()).toHaveLength(8);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"Add machine": toast, MCH-050 in Africa (Abidjan), rows and KPIs as the prototype after the same submission', async () => {
    viewer.name = 'Gabriel Comte';
    viewer.role = 'quality';
    expect(await addMachineAction(NEW_MACHINE)).toEqual({ toast: 'Machine added to the installed base' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    for (const lang of ['en', 'fr'] as const) {
      const g = G[lang].added.machine.fleet;
      const v = await fleet(lang);
      expect(v.rows.map((r) => r.number)).toEqual(g.rows.map((r: any) => num(r.id)));
      const last = v.rows.at(-1)!;
      const gl = g.rows.at(-1);
      expect([last.name, last.sub, last.status, last.statusClass, last.project, last.site, last.delivered, last.warrantyEnd, last.warrantyEndSub, last.openText, last.config, last.cost])
        .toEqual([gl.name, `${gl.type} · ${gl.client}`, gl.status, gl.stClass, gl.proj, gl.site, gl.delivered, gl.wend, gl.wendSub, gl.openText, null, '0 k€']);
      expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual(g.kpis.map((k: any) => [k.label, String(k.value), agree(k.sub)]));
      const ga = G[lang].added.machineInAfrica.fleet;
      expect((await fleet(lang, 'afr')).rows.map((r) => r.number)).toEqual(ga.rows.map((r: any) => num(r.id)));
      expect((await fleet(lang, 'afr')).kpis.map((k) => [k.value, k.sub])).toEqual(ga.kpis.map((k: any) => [String(k.value), agree(k.sub)]));
    }
    const z = await machinesByZone();
    expect([z.total, z.byZone.euna, z.byZone.afr, z.byZone.apac]).toEqual(G.en.added.machine.fleet.zoneSeg.map((o: any) => o[1]));
    expect((await listAudit()).find((a) => a.object === 'MCH-050')).toMatchObject({ who: 'Gabriel Comte' });
  });

  it('"Add machine" with the name and client only: EMP, no site, no dates, In warranty (MCH-051)', async () => {
    viewer.role = 'pm';
    viewer.name = 'Romain Aubert';
    expect(await addMachineAction(BARE_MACHINE)).toEqual({ toast: 'Machine added to the installed base' });
    const last = (await fleet('en')).rows.at(-1)!;
    const g = G.en.added.bareMachine.fleet.rows.at(-1);
    expect([last.number, last.name, last.sub, last.site, last.delivered, last.warrantyEnd, last.status]).toEqual(['MCH-051', g.name, `${g.type} · ${g.client}`, g.site, g.delivered, g.wend, g.status]);
  });

  it('"Add machine" with a warranty end already past: Out of warranty (the prototype stamped "In warranty")', async () => {
    expect(await addMachineAction({ name: 'Gantry crane 25 t', client: 'Port authority', site: 'Le Havre · quay 5', delivered: '1 Mar 2019', warranty: '28 Feb 2021' })).toEqual({ toast: 'Machine added to the installed base' });
    const v = await fleet('en');
    expect(v.rows.at(-1)).toMatchObject({ number: 'MCH-052', status: 'Out of warranty', statusClass: 'tag tag-outline', warrantyEnd: '28 Feb 2021', warrantyEndSub: '' });
    // Still 8 + 2 machines "In warranty" (MCH-050, MCH-051 added above), 11 in service.
    expect(v.kpis.slice(0, 2).map((k) => k.value)).toEqual(['11', '8']);
  });

  it('"New warranty claim": toast, WC-020 open first, KPIs and badge as the prototype; a second one takes the defaults', async () => {
    viewer.role = 'procurement';
    viewer.name = 'Fabien Bertrand';
    viewer.lang = 'fr';
    expect(await openClaimAction({ ...NEW_CLAIM, machine: 'MCH-044', sev: 'critical', cover: 'extended_warranty' })).toEqual({ toast: 'Réclamation garantie ouverte' });
    for (const lang of ['en', 'fr'] as const) {
      const g = G[lang].added.claim.sav.claims;
      const v = await claimsView(lang);
      expect(v.claims!.map((c) => c.number)).toEqual(g.claims.map((c: any) => num(c.id)));
      const c = v.claims!.find((x) => x.number === 'WC-020')!;
      const gc = g.claims.find((x: any) => x.id === 'WC-20');
      // The prototype's next step is the description (as typed: no translation in Keystone).
      expect([c.machineName, c.machineSub, c.issue, c.severity, c.severityClass, c.date, c.status, c.statusClass, c.coverage, c.coverageClass, c.cost, c.owner, c.next, c.eco])
        .toEqual([gc.mname, `${gc.mch} · ${gc.client}`, gc.issue, gc.sev, gc.sevClass, gc.date, gc.status, gc.stClass, gc.cover, gc.coverClass, gc.costText, gc.owner, NEW_CLAIM.desc, null]);
      expect(v.kpis.map((k) => [k.label, k.value, k.color])).toEqual(g.kpis.map((k: any) => [k.label, String(k.value), k.color]));
    }
    expect(await savNavBadge()).toBe(G.en.added.claim.sav.claims.badge);
    viewer.lang = 'en';
    expect(await openClaimAction(MINOR_CLAIM)).toEqual({ toast: 'Warranty claim opened' });
    const g2 = G.en.added.twoClaims.sav.claims;
    const v2 = await claimsView('en');
    expect(v2.claims!.map((c) => c.number)).toEqual(g2.claims.map((c: any) => num(c.id)));
    const c2 = v2.claims!.find((x) => x.number === 'WC-021')!;
    const gc2 = g2.claims.find((x: any) => x.id === 'WC-21');
    expect([c2.machineSub, c2.issue, c2.severity, c2.coverage, c2.owner, c2.next, c2.date]).toEqual([`${gc2.mch} · ${gc2.client}`, gc2.issue, gc2.sev, gc2.cover, gc2.owner, gc2.next, gc2.date]);
    expect(v2.kpis.map((k) => [k.value, k.sub])).toEqual(g2.kpis.map((k: any) => [String(k.value), k.sub]));
    expect((await listAudit()).find((a) => a.object === 'WC-020')).toMatchObject({ who: 'Fabien Bertrand' });
  });

  it('a machine added in Keystone can receive a claim (the prototype offered the seed machines only)', async () => {
    expect(await openClaimAction({ machine: 'MCH-050', issue: 'Trolley rail misalignment', sev: 'major' })).toEqual({ toast: 'Warranty claim opened' });
    const v = await fleet('en');
    expect(v.rows.find((r) => r.number === 'MCH-050')).toMatchObject({ openText: '1 open', cost: '0 k€' });
    const costs = savView(await getSavScreen(null), 'costs', null, makeT('en'), 'en').costs!;
    expect(costs.find((r) => r.number === 'MCH-050')).toMatchObject({ claims: 1, warrantyCost: '€0k', chargeable: '€0k', barPct: 0 });
    expect(await savNavBadge()).toBe('4');
  });
});
