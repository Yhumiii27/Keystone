// Golden-value tests of the after-sales domain logic (src/domain/aftersales.ts) on the prototype's own data (FLEET,
// CLAIMS, INTERVENTIONS), against the prototype's render values (src/domain/aftersales.golden.json, written by
// scripts/proto-golden-aftersales.ts: renderValsEN / renderVals over design lines 3096–5239, every zone and view).
// The configuration counts come from Vigie's ECO effectivity (DAL); here only their tags are checked.
// Deliberate deviations asserted inline: "1 client" (the prototype wrote "1 clients"); the claims screen's zone notice
// tests the list on show, not the machine list (07 A.1); dates and numbers parsed by the add-forms; a machine added
// with a past warranty end is Out of warranty; R-145 (NEW-D5-2 = a): the warranty cost tile counts the calendar year's
// claims and the warranty status is the one in force (the seed's figures do not move: every claim is of 2026).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { claimCoverage, claimStatus, interventionStatus, isoOfDemoDate, ncrSeverity, warrantyStatus, type ZoneCode } from '@/server/db/codes';
import { money } from '@/lib/format';
import GOLDEN from './aftersales.golden.json';
import {
  SAV_VIEWS, SAV_VIEW_LABEL, SEVERITY_TONE, WARRANTY_TONE, addedWarrantyStatus, claimCostRows, claimStatusTone, configItems, costBarPct, coverageTone, fleetKpis,
  fleetZoneEmpty, interventionTone, machineClaimStats, machinesInZone, nextPlanned, ofMachinesInZone, openFirst, parseNewClaim, parseNewMachine,
  savBadge, savKpis, savViewOf, savZoneEmpty, warrantyEnding, warrantyInForce, warrantyStatusText, type ClaimFacts, type InterventionFacts,
} from './aftersales';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const P = PROTO as any;
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const ZONES: [string, ZoneCode | null][] = [['all', null], ['euna', 'euna'], ['afr', 'afr'], ['apac', 'apac']];
const iso = (s: string) => (s && s !== '—' ? isoOfDemoDate(s) : null);
const day = (i: string | null) => {
  if (!i) return '—';
  const [y, m, d] = i.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};

/** Machine zone as the prototype resolves it (`machineZone` 4981): the site's city → country → zone. */
const zoneOfSite = (site: string): ZoneCode => P.COUNTRY_ZONE[P.CITY_COUNTRY[site.split(' · ')[0].trim()]] ?? 'euna';

const machines = (P.FLEET as string[][]).map(([number, type, name, client, site, project, delivered, wend, status]) => {
  const ext = /^Extended → (.+)$/.exec(status);
  return {
    number, type, name, client, site, project, zone: zoneOfSite(site), deliveredOn: iso(delivered), warrantyEndOn: iso(wend),
    warrantyStatus: ext ? ('extended' as const) : warrantyStatus.code(status), extendedUntil: ext ? iso(ext[1]) : null,
  };
});
const claims: ClaimFacts[] = (P.CLAIMS as any[][]).map(([number, machineNumber, , sev, date, status, cover, cost, eco]) => ({
  number, machineNumber, reportedOn: iso(date)!, severity: ncrSeverity.code(sev), status: claimStatus.code(status), coverage: claimCoverage.code(cover), costKeur: cost, ecoNumber: eco || null,
}));
const ivs: InterventionFacts[] = (P.INTERVENTIONS as string[][]).map(([number, machineNumber, date, , , , status]) => ({
  number, machineNumber, scheduledOn: iso(date)!, status: interventionStatus.code(status),
}));
const withOpen = (ms: typeof machines) => ms.map((m) => ({ ...m, openClaims: machineClaimStats(m.number, claims).open }));
const kpiView = (ks: ReturnType<typeof fleetKpis>) => ks.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.alert ? LO : k.muted ? 'var(--color-neutral-200)' : OK }));
const goldenKpis = (ks: any[]) => ks.map((k: any) => ({ ...k, value: String(k.value) }));
const cls = (tone: string) => `tag tag-${tone}`;
/** The prototype's today for warranties and claims (NOW_ISO / PG_NOW ≈ 30 Sep 2026): passed explicitly since R-013. */
const NOW = '2026-09-30';

describe('Installed base (fleetRows / fleetKpis 4985, 4993)', () => {
  it.each(ZONES)('zone %s: machines shown, KPI tiles and row figures equal the prototype', (key, zone) => {
    const g = G.en.fleet[key];
    const shown = machinesInZone(machines, zone);
    expect(shown.map((m) => m.number)).toEqual(g.rows.map((r: any) => r.id));
    // "1 clients" in the prototype (Asia Pacific, Africa): singular here.
    expect(kpiView(fleetKpis(withOpen(shown), NOW))).toEqual(goldenKpis(g.kpis).map((k: any) => ({ ...k, sub: k.sub.replace(/^1 clients$/, '1 client') })));
    expect(fleetZoneEmpty(zone, shown.length)).toBe(g.zoneEmpty);
    expect(
      shown.map((m) => {
        const end = warrantyEnding(m.warrantyEndOn, NOW);
        const st = machineClaimStats(m.number, claims);
        return {
          id: m.number, status: warrantyStatusText(m.warrantyStatus, m.extendedUntil), stClass: cls(WARRANTY_TONE[m.warrantyStatus]), delivered: day(m.deliveredOn),
          wend: day(m.warrantyEndOn), wendColor: end.soon ? LO : OK, wendSub: end.soon ? `ends in ${end.days} d` : '', open: st.open, openText: st.open ? `${st.open} open` : '—',
          openColor: st.open ? LO : 'var(--color-neutral-500)', cost: st.warrantyKeur,
        };
      }),
    ).toEqual(g.rows.map((r: any) => ({ id: r.id, status: r.status, stClass: r.stClass, delivered: r.delivered, wend: r.wend, wendColor: r.wendColor, wendSub: r.wendSub, open: r.open, openText: r.openText, openColor: r.openColor, cost: r.cost })));
  });

  it('configuration tags: counts in the order pending · retrofit · pinned with the prototype tag classes', () => {
    for (const r of G.en.fleet.all.rows) {
      const n = (k: string) => Number((r.cfgItems.find((c: any) => c.text.endsWith(' ' + k))?.text ?? '0').split(' ')[0]);
      const items = configItems({ pending: n('pending'), retrofit: n('retrofit'), pinned: n('pinned') });
      expect(items.map((c) => ({ text: c.text, cls: cls(c.tone) })), r.id).toEqual(r.cfgItems);
      expect(items.length > 0).toBe(r.hasCfg);
    }
    expect(configItems(null)).toEqual([]);
  });

  it('warranty ending: strictly after now and at most three months ahead', () => {
    expect(warrantyEnding('2026-11-01', NOW)).toEqual({ soon: true, days: 31 });
    expect(warrantyEnding('2026-09-30', NOW)).toEqual({ soon: false, days: null }); // = now (8.97)
    expect(warrantyEnding('2026-12-29', NOW)).toEqual({ soon: true, days: 89 });
    expect(warrantyEnding('2027-01-02', NOW).soon).toBe(false);
    expect(warrantyEnding(null, NOW)).toEqual({ soon: false, days: null });
    expect(warrantyStatusText('extended', '2027-06-04')).toBe('Extended → 4 Jun 2027');
    // A machine added in Keystone: In warranty (the prototype's stamp) unless its warranty end is already past.
    expect([addedWarrantyStatus(null, NOW), addedWarrantyStatus('2028-09-30', NOW), addedWarrantyStatus('2026-09-30', NOW), addedWarrantyStatus('2026-09-29', NOW), addedWarrantyStatus('2021-03-01', NOW)])
      .toEqual(['in_warranty', 'in_warranty', 'in_warranty', 'out_of_warranty', 'out_of_warranty']);
    expect(warrantyStatusText('out_of_warranty', null)).toBe('Out of warranty');
  });
});

describe('Warranty claims & interventions (claimRows / ivRows / savCostRows / savKpis 4987–4992)', () => {
  it.each(ZONES)('zone %s: claims (open first), interventions, costs per machine and KPI tiles equal the prototype in every view', (key, zone) => {
    const shown = machinesInZone(machines, zone);
    const zc = openFirst(ofMachinesInZone(claims, machines, zone));
    const zi = ofMachinesInZone(ivs, machines, zone);
    const costs = claimCostRows(shown, zc);
    for (const view of SAV_VIEWS) {
      const g = G.en.sav[key][view];
      expect(kpiView(savKpis(zc, zi, 'en', NOW))).toEqual(goldenKpis(g.kpis));
      expect(savKpis(zc, zi, 'fr', NOW).map((k) => k.value)).toEqual(G.fr.sav[key][view].kpis.map((k: any) => String(k.value)));
      expect(g.seg.map((o: any) => o.label)).toEqual(SAV_VIEWS.map((v) => SAV_VIEW_LABEL[v]));
    }
    const g = G.en.sav[key];
    expect(zc.map((c) => c.number)).toEqual(g.claims.claims.map((r: any) => r.id));
    expect(zc.map((c) => ({ sevClass: cls(SEVERITY_TONE[c.severity]), stClass: cls(claimStatusTone(c.status)), coverClass: cls(coverageTone(c.coverage)), costText: c.costKeur ? money(c.costKeur, 'en') : '—', hasEco: !!c.ecoNumber })))
      .toEqual(g.claims.claims.map((r: any) => ({ sevClass: r.sevClass, stClass: r.stClass, coverClass: r.coverClass, costText: r.costText, hasEco: r.hasEco })));
    expect(zi.map((i) => [i.number, cls(interventionTone(i.status))])).toEqual(g.interventions.interventions.map((r: any) => [r.id, r.stClass]));
    expect(costs.map((c) => ({ id: c.machine.number, claims: c.claims, warrantyCost: money(c.warrantyKeur, 'en'), chargeable: money(c.chargeableKeur, 'en'), barW: `${c.barPct}%` })))
      .toEqual(g.costs.costs.map((r: any) => ({ id: r.id, claims: r.claims, warrantyCost: r.warrantyCost, chargeable: r.chargeable, barW: r.barW })));
    expect(savBadge(claims)).toBe(G.en.sav[key].claims.badge);
  });

  it('zone notice: the prototype tested the machine list; the rebuild tests the list on show', () => {
    for (const [key, zone] of ZONES) for (const view of SAV_VIEWS) expect(G.en.sav[key][view].zoneEmpty, `${key} ${view}`).toBe(fleetZoneEmpty(zone, machinesInZone(machines, zone).length));
    // Asia Pacific has a machine (MCH-040) and a closed claim, but no intervention.
    const apac = { claims: ofMachinesInZone(claims, machines, 'apac'), ivs: ofMachinesInZone(ivs, machines, 'apac') };
    expect([apac.claims.length, apac.ivs.length]).toEqual([1, 0]);
    expect(savZoneEmpty('apac', apac.claims.length)).toBe(false);
    expect(savZoneEmpty('apac', apac.ivs.length)).toBe(true); // the prototype showed an empty table without the notice
    expect(savZoneEmpty(null, 0)).toBe(false);
  });

  it('badge, next planned intervention, bar width and view parameter', () => {
    expect(savBadge([])).toBe('');
    expect(savBadge([{ status: 'closed', severity: 'critical' }, { status: 'open', severity: 'minor' }])).toBe('');
    expect(savBadge([{ status: 'diagnosed', severity: 'critical' }])).toBe('1');
    expect(nextPlanned(ivs)?.number).toBe('IV-081');
    expect(nextPlanned([])).toBeNull();
    expect([costBarPct(0), costBarPct(3), costBarPct(20), costBarPct(25), costBarPct(40)]).toEqual([0, 12, 80, 100, 100]);
    expect([savViewOf('costs'), savViewOf('interventions'), savViewOf(null), savViewOf('nope')]).toEqual(['costs', 'interventions', 'claims', 'claims']);
  });
});

describe('add-forms (AF fleet / AF sav, afSubmit 5121)', () => {
  const TYPES = ['EMP', 'MEMU', 'SPUR', 'AUTRE'];

  it('"Add machine" reads the prototype inputs as the prototype recorded them (dates parsed)', () => {
    const { NEW_MACHINE, BARE_MACHINE } = G.inputs;
    const a = parseNewMachine(NEW_MACHINE, TYPES, 2026);
    expect(a).toEqual({ ok: true, value: { name: NEW_MACHINE.name, machineType: 'MEMU', client: 'Port authority', site: 'Abidjan · quay 1', deliveredOn: '2026-10-01', warrantyEndOn: '2028-09-30' } });
    const added = G.en.added.machine.fleet.rows.at(-1);
    expect([a.ok && day(a.value.deliveredOn), a.ok && day(a.value.warrantyEndOn), added.status]).toEqual([added.delivered, added.wend, 'In warranty']);
    const b = parseNewMachine(BARE_MACHINE, TYPES, 2026);
    expect(b).toEqual({ ok: true, value: { name: BARE_MACHINE.name, machineType: 'EMP', client: 'Transit BU', site: null, deliveredOn: null, warrantyEndOn: null } });
    expect(G.en.added.bareMachine.fleet.rows.at(-1)).toMatchObject({ type: 'EMP', delivered: '—', wend: '—', site: '' });
    expect(parseNewMachine({ ...NEW_MACHINE, delivered: '14/12/2025', warranty: '13 déc. 2027' }, TYPES, 2026)).toMatchObject({ ok: true, value: { deliveredOn: '2025-12-14', warrantyEndOn: '2027-12-13' } });
  });

  it('"Add machine" refuses what the prototype accepted', () => {
    expect(parseNewMachine({ name: ' ', client: 'x' }, TYPES, 2026)).toEqual({ ok: false, error: 'Machine is required' });
    expect(parseNewMachine({ name: 'x', client: '' }, TYPES, 2026)).toEqual({ ok: false, error: 'Client is required' });
    expect(parseNewMachine({ name: 'x', client: 'y', type: 'CRANE' }, TYPES, 2026)).toEqual({ ok: false, error: 'Unknown machine type' });
    expect(parseNewMachine({ name: 'x', client: 'y', delivered: 'soon' }, TYPES, 2026)).toEqual({ ok: false, error: 'Enter the delivery date as a date, e.g. 14 Dec 2025' });
    expect(parseNewMachine({ name: 'x', client: 'y', warranty: '31 Feb 2027' }, TYPES, 2026)).toEqual({ ok: false, error: 'Enter the warranty end as a date, e.g. 13 Dec 2027' });
    expect(parseNewMachine({ name: 'x', client: 'y', delivered: '1 Oct 2026', warranty: '1 Sep 2026' }, TYPES, 2026)).toEqual({ ok: false, error: 'Warranty end is before delivery' });
    expect(parseNewMachine({ name: 'x'.repeat(201), client: 'y' }, TYPES, 2026)).toEqual({ ok: false, error: 'Text is too long' });
  });

  it('"New warranty claim": defaults (first machine, Minor, Warranty, first owner), codes, refusals', () => {
    const MCH = machines.map((m) => m.number);
    const OWNERS = ['T. Kerbrat', 'C. Morvan', 'S. Haddad', 'J. Wagner'];
    const { NEW_CLAIM, MINOR_CLAIM } = G.inputs;
    expect(parseNewClaim({ ...NEW_CLAIM, machine: 'MCH-044', sev: 'critical', cover: 'extended_warranty' }, MCH, OWNERS)).toEqual({
      ok: true, value: { machineNumber: 'MCH-044', issue: NEW_CLAIM.issue, severity: 'critical', coverage: 'extended_warranty', owner: 'S. Haddad', description: NEW_CLAIM.desc },
    });
    // The prototype's second claim (issue only) took the first option of every select.
    const second = G.en.added.twoClaims.sav.claims.claims.find((c: any) => c.issue === MINOR_CLAIM.issue);
    expect(second).toMatchObject({ mch: 'MCH-041', sev: 'Minor', cover: 'Warranty', owner: 'T. Kerbrat', next: '—', status: 'Open', date: '30 Sep 2026', costText: '—' });
    expect(parseNewClaim(MINOR_CLAIM, MCH, OWNERS)).toEqual({ ok: true, value: { machineNumber: 'MCH-041', issue: MINOR_CLAIM.issue, severity: 'minor', coverage: 'warranty', owner: 'T. Kerbrat', description: null } });
    expect(parseNewClaim({ machine: 'MCH-999', issue: 'x' }, MCH, OWNERS)).toEqual({ ok: false, error: 'Unknown machine' });
    expect(parseNewClaim({ issue: ' ' }, MCH, OWNERS)).toEqual({ ok: false, error: 'Issue is required' });
    expect(parseNewClaim({ issue: 'x', sev: 'Major' }, MCH, OWNERS)).toEqual({ ok: false, error: 'Unknown severity' });
    expect(parseNewClaim({ issue: 'x', cover: 'free' }, MCH, OWNERS)).toEqual({ ok: false, error: 'Unknown coverage' });
    expect(parseNewClaim({ issue: 'x', owner: 'M. Lefebvre' }, MCH, OWNERS)).toEqual({ ok: false, error: 'Unknown owner' });
    expect(parseNewClaim({ issue: 'x', desc: 'y'.repeat(1001) }, MCH, OWNERS)).toEqual({ ok: false, error: 'Text is too long' });
  });

  it('a claim opened by the prototype counts in the KPIs and the badge (Critical = major)', () => {
    const extra: ClaimFacts = { number: 'WC-020', machineNumber: 'MCH-044', reportedOn: '2026-09-30', severity: 'critical', status: 'open', coverage: 'extended_warranty', costKeur: 0, ecoNumber: null };
    const all = openFirst([...claims, extra]);
    expect(kpiView(savKpis(all, ivs, 'en', NOW))).toEqual(goldenKpis(G.en.added.claim.sav.claims.kpis));
    expect(savBadge(all)).toBe(G.en.added.claim.sav.claims.badge);
    expect(all.map((c) => c.number).slice(0, 6)).toEqual(G.en.added.claim.sav.claims.claims.slice(0, 6).map((c: any) => c.id.replace('WC-20', 'WC-020')));
  });
});

describe('R-145 (NEW-D5-2 = a): warranty cost of the calendar year, warranty in force', () => {
  const cost = (cs: readonly ClaimFacts[], today?: string) => {
    const k = savKpis(cs, ivs, 'en', today ?? NOW).find((x) => x.label === 'Warranty cost YTD')!;
    return [k.value, k.sub];
  };
  const claim = (over: Partial<ClaimFacts>): ClaimFacts => ({ number: 'WC-099', machineNumber: 'MCH-041', reportedOn: '2025-12-20', severity: 'minor', status: 'closed', coverage: 'warranty', costKeur: 7, ecoNumber: null, ...over });

  it('a claim reported last year counts in neither the value nor the chargeable sub-line', () => {
    const seed = cost(claims);
    expect(seed).toEqual(['€34k', '€6k chargeable']); // every seeded claim is of 2026: the prototype's figures
    expect(cost([...claims, claim({}), claim({ number: 'WC-098', coverage: 'chargeable', costKeur: 5 })])).toEqual(seed);
    // A claim of the current year counts — also one dated after the frozen business date (no upper bound).
    expect(cost([...claims, claim({ reportedOn: '2026-10-02' })])).toEqual(['€41k', '€6k chargeable']);
    expect(cost([...claims, claim({ reportedOn: '2026-01-01', coverage: 'chargeable', costKeur: 5 })])).toEqual(['€34k', '€11k chargeable']);
    // The other tiles keep every claim shown (open claims).
    expect(savKpis([...claims, claim({ status: 'open' })], ivs, 'en', NOW)[0].value).toBe(String(claims.filter((c) => c.status !== 'closed').length + 1));
  });

  it('a new year starts at 0', () => {
    expect(cost(claims, '2027-01-05')).toEqual(['€0k', '€0k chargeable']);
    expect(cost(claims, '2026-01-01')).toEqual(['€34k', '€6k chargeable']);
  });

  it('warranty in force: extension running, expired, contractual end passed, no dates', () => {
    type W = 'in_warranty' | 'extended' | 'out_of_warranty';
    const m = (warrantyEndOn: string | null, extendedUntil: string | null, warrantyStatus: W = 'in_warranty') => ({ warrantyEndOn, extendedUntil, warrantyStatus });
    // MCH-022 of the seed: contractual end 4 Jun 2025, extended to 4 Jun 2027 → Extended, end in force = the extension's.
    expect(warrantyInForce(m('2025-06-04', '2027-06-04', 'extended'), NOW)).toEqual({ status: 'extended', endOn: '2027-06-04' });
    // An expired extension is Out of warranty (the stored status still says Extended).
    expect(warrantyInForce(m('2025-06-04', '2026-09-29', 'extended'), NOW)).toEqual({ status: 'out_of_warranty', endOn: '2026-09-29' });
    // The extension's last day is still covered.
    expect(warrantyInForce(m('2025-06-04', '2026-09-30', 'extended'), NOW).status).toBe('extended');
    // A contractual end just passed, no extension → Out of warranty (the stored status still says In warranty).
    expect(warrantyInForce(m('2026-09-29', null), NOW)).toEqual({ status: 'out_of_warranty', endOn: '2026-09-29' });
    expect(warrantyInForce(m('2026-09-30', null), NOW)).toEqual({ status: 'in_warranty', endOn: '2026-09-30' });
    // Default (no prototype precedent): an extension recorded before the contractual end has passed already reads Extended.
    expect(warrantyInForce(m('2026-12-31', '2027-12-31'), NOW)).toEqual({ status: 'extended', endOn: '2027-12-31' });
    // An extension that is not later than the contractual end is ignored.
    expect(warrantyInForce(m('2027-12-31', '2027-06-30', 'extended'), NOW)).toEqual({ status: 'in_warranty', endOn: '2027-12-31' });
    // An extension without a contractual end.
    expect(warrantyInForce(m(null, '2027-01-31'), NOW)).toEqual({ status: 'extended', endOn: '2027-01-31' });
    // No date at all: the stored status.
    expect([warrantyInForce(m(null, null, 'out_of_warranty'), NOW), warrantyInForce(m(null, null, 'extended'), NOW)]).toEqual([
      { status: 'out_of_warranty', endOn: null },
      { status: 'extended', endOn: null },
    ]);
    // The clock is a parameter (R-013): the seed's extension lapses after 4 Jun 2027.
    expect(warrantyInForce(m('2025-06-04', '2027-06-04', 'extended'), '2027-06-05').status).toBe('out_of_warranty');
  });

  it('Installed base tiles: an extension ending within three months is ending soon; an expired one is not in warranty', () => {
    const base = withOpen(machines);
    const tiles = (ms: typeof base) => Object.fromEntries(fleetKpis(ms, NOW).map((k) => [k.label, [k.value, k.sub]]));
    const seed = tiles(base);
    expect([seed['In warranty'], seed['Warranty ending < 90 days']]).toEqual([['6', '1 extended'], ['1', 'MCH-035']]);
    // MCH-022's extension ending on 15 Dec 2026 is ending soon (its contractual end of 2025 never was).
    const soon = base.map((m) => (m.number === 'MCH-022' ? { ...m, extendedUntil: '2026-12-15' } : m));
    expect([tiles(soon)['In warranty'], tiles(soon)['Warranty ending < 90 days']]).toEqual([['6', '1 extended'], ['2', 'MCH-035 · MCH-022']]);
    // An expired extension: neither In warranty nor Extended any more.
    const expired = base.map((m) => (m.number === 'MCH-022' ? { ...m, extendedUntil: '2026-08-31' } : m));
    expect(tiles(expired)['In warranty']).toEqual(['6', '0 extended']);
    // A contractual end just passed (stored In warranty): no longer counted In warranty.
    const lapsed = base.map((m) => (m.number === 'MCH-041' ? { ...m, warrantyEndOn: '2026-09-29' } : m));
    expect(tiles(lapsed)['In warranty']).toEqual(['5', '1 extended']);
  });
});
