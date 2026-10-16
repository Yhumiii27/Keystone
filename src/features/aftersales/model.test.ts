// Installed base and Warranty claims & interventions view models from the seeded in-memory database, in EN and FR, for
// every zone and every claims view, compared with the prototype's own render values (src/domain/aftersales.golden.json,
// scripts/proto-golden-aftersales.ts: renderVals() for the director, EN and FR — deepTr applied).
// Deliberate deviations asserted inline:
// - counts agree in number ("1 client", FR "1 étendue", "1 ouverte", "0 majeure"; the prototype always used the plural);
// - FR intervention statuses agree with "intervention" ("Planifiée", "Terminée");
// - the machine sub-line drops the trailing " · " when no generation is recorded (MCH-044, MCH-040);
// - the claims screen's zone notice tests the list on show (Asia Pacific › Interventions shows it; 07 A.1) and names
//   what is missing: "No machine in this zone", else the view's list (R-155, X-16);
// - FR "Warranty cost YTD" reads « Coût garantie de l’année » (R-145, NEW-D5-2 = a: the calendar year's claims);
// - the configuration tags link to the first ECO on the Change orders screen and to Vigie; a claim's design ECO not
//   reported by Vigie (ECO-031) links to Vigie;
// - the add-forms store codes; FR "Issue" is "Problème" (the dictionary's "Sortie" is a stock issue).
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { SAV_VIEWS, type SavView, type ZoneCode } from '@/domain/aftersales';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { claimFormOptions, getFleetScreen, getSavScreen, machineTypeOptions } from '@/server/dal/aftersales';
import { vigieEcoUrl } from '@/server/integrations/vigie/links';
import GOLDEN from '@/domain/aftersales.golden.json';
import { claimFormDef, localizeForm, machineFormDef } from './forms';
import { claimHref, ecoHref, savHref } from './links';
import { fleetView, savView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const ZONES: [string, ZoneCode | null][] = [['all', null], ['euna', 'euna'], ['afr', 'afr'], ['apac', 'apac']];
const LANGS: Lang[] = ['en', 'fr'];
const FR_SINGULAR: Record<string, string> = { clients: 'client', étendues: 'étendue', ouvertes: 'ouverte', majeures: 'majeure' };
/** The prototype's count sub-lines, agreed in number. */
const agree = (s: string) => s.replace(/^1 clients$/, '1 client').replace(/^([01]) (clients|étendues|ouvertes|majeures)$/, (_, n, w) => `${n} ${FR_SINGULAR[w]}`);
const FR_IV: Record<string, string> = { Planifié: 'Planifiée', Terminé: 'Terminée' };
/** R-145 (NEW-D5-2 = a): the tile counts the calendar year's claims; FR label « Coût garantie de l’année » (was « cumulé »). */
const YEAR_LABEL: Record<string, string> = { 'Coût garantie cumulé': 'Coût garantie de l’année' };
const kpis = (ks: any[]) => ks.map((k: any) => ({ label: YEAR_LABEL[k.label] ?? k.label, value: String(k.value), sub: agree(k.sub), color: k.color }));
/** R-155 (X-16): the machine lists' zone notices (the prototype showed "No project in this zone for this view"). */
const NOTICE: Record<Lang, Record<'machine' | SavView, string>> = {
  en: { machine: 'No machine in this zone', claims: 'No claim in this zone', interventions: 'No intervention in this zone', costs: 'No warranty cost in this zone' },
  fr: { machine: 'Aucune machine dans cette zone', claims: 'Aucune réclamation dans cette zone', interventions: 'Aucune intervention dans cette zone', costs: 'Aucun coût de garantie dans cette zone' },
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

// R-013: "ends in n d" counts from the business date (25 Sep 2026 on the demo data set), not the prototype's 30 Sep: MCH-035
// (1 Nov 2026) ends in 36 days, not 31.
const ending = (s: string) => s.replace('ends in 31 d', 'ends in 36 d').replace('finit dans 31 j', 'finit dans 36 j');

describe('Installed base view model', () => {
  it.each(LANGS.flatMap((l) => ZONES.map(([k, z]) => [l, k, z] as const)))('%s · zone %s: KPI tiles, notice and rows equal the prototype', async (lang, key, zone) => {
    const g = G[lang].fleet[key];
    const view = fleetView(await getFleetScreen(zone), zone, makeT(lang), lang);
    expect(view.kpis).toEqual(kpis(g.kpis));
    // R-155 (X-16): "No machine in this zone" (the prototype's text was the project screens'); no seeded zone is empty.
    expect(view.zoneEmpty).toBe(g.zoneEmpty ? NOTICE[lang].machine : null);
    expect(view.rows.map((r) => ({ ...r, config: r.config && { items: r.config.items, href: r.config.href, vigieHref: r.config.vigieHref } }))).toEqual(
      g.rows.map((r: any) => ({
        number: r.id, name: r.name, sub: [r.type, r.client, r.gen].filter(Boolean).join(' · '), status: r.status, statusClass: r.stClass, project: r.proj, site: r.site,
        delivered: r.delivered, warrantyEnd: r.wend, warrantyEndColor: r.wendColor, warrantyEndSub: ending(r.wendSub), openText: agree(r.openText), openColor: r.openColor,
        config: r.hasCfg ? { items: r.cfgItems.map((c: any) => ({ text: c.text, cls: c.cls })), href: ecoHref(r.firstEco), vigieHref: vigieEcoUrl(r.firstEco) } : null,
        cost: `${r.cost} k€`,
      })),
    );
  });

  it('configuration tags: tooltip lists the ECOs counted; "Open in Vigie" names the first', async () => {
    const view = fleetView(await getFleetScreen(null), null, makeT('fr'), 'fr');
    const m = view.rows.find((r) => r.number === 'MCH-029')!;
    expect(m.config!.title.split(' · ')).toHaveLength(4);
    expect(m.config!.title.startsWith(m.config!.href.split('eco=')[1])).toBe(true);
    expect(m.config!.vigieLabel).toBe(`Ouvrir dans Vigie · ${m.config!.href.split('eco=')[1]}`);
  });

  it('the client (outside the workspace) gets no Vigie link: the tags still open the Change orders screen', async () => {
    const staff = fleetView(await getFleetScreen(null), null, makeT('en'), 'en');
    const client = fleetView(await getFleetScreen(null), null, makeT('en'), 'en', { vigie: false });
    expect(client.rows.map((r) => r.config && { ...r.config, vigieHref: 'x' })).toEqual(staff.rows.map((r) => r.config && { ...r.config, vigieHref: 'x' }));
    expect(client.rows.filter((r) => r.config).map((r) => r.config!.vigieHref)).toEqual(Array(5).fill(null));
  });
});

describe('Warranty claims & interventions view model', () => {
  const cases = LANGS.flatMap((l) => ZONES.flatMap(([k, z]) => SAV_VIEWS.map((v) => [l, k, z, v] as const)));

  it.each(cases)('%s · zone %s · %s: switch, KPI tiles and the register equal the prototype', async (lang, key, zone, view) => {
    const g = G[lang].sav[key][view];
    const t = makeT(lang);
    const v = savView(await getSavScreen(zone), view as SavView, zone, t, lang);
    expect(v.view).toBe(view);
    expect(v.seg).toEqual(SAV_VIEWS.map((x, i) => ({ value: x, label: g.seg[i].label, href: savHref(x) })));
    expect(g.seg.map((o: any) => o.color === 'var(--color-accent)')).toEqual(SAV_VIEWS.map((x) => x === view));
    expect(v.kpis).toEqual(kpis(g.kpis));
    // The prototype tested the machine list (never empty in a zone); the rebuild tests the list on show.
    const shown = view === 'claims' ? g.claims.length : view === 'interventions' ? g.interventions.length : g.costs.length;
    // R-155 (X-16 + 07 A.1): every seeded zone has machines, so an empty list names the view's list.
    expect(v.zoneEmpty).toBe(zone && !shown ? NOTICE[lang][view] : null);
    if (key === 'apac' && view === 'interventions') expect([g.zoneEmpty, v.zoneEmpty]).toEqual([false, NOTICE[lang].interventions]);
    expect(v.claims).toEqual(
      view !== 'claims' ? null : g.claims.map((c: any) => ({
        number: c.id, machineName: c.mname, machineSub: `${c.mch} · ${c.client}`, color: c.color, issue: c.issue,
        eco: c.hasEco ? { text: c.eco, href: vigieEcoUrl(c.eco), external: true, label: `${t('Open in Vigie')} · ${c.eco}` } : null,
        severity: c.sev, severityClass: c.sevClass, date: c.date, status: c.status, statusClass: c.stClass, coverage: c.cover, coverageClass: c.coverClass,
        cost: c.costText, owner: c.owner, next: c.next,
        // R-143: each row opens the claim's drawer (no displayed value changes).
        href: claimHref(c.id), selected: false,
      })),
    );
    expect(v.interventions).toEqual(
      view !== 'interventions' ? null : g.interventions.map((i: any) => ({
        number: i.id, machineName: i.mname, machineSub: `${i.mch} · ${i.site}`, date: i.date, technicians: i.tech, type: i.type, duration: i.dur,
        status: lang === 'fr' ? FR_IV[i.status] : i.status, statusClass: i.stClass,
        // R-143: "Mark done" for editors only (the view model's default viewer reads), no done line on the seed.
        done: null, doneLine: null,
      })),
    );
    expect(v.costs).toEqual(
      view !== 'costs' ? null : g.costs.map((m: any) => ({
        number: m.id, name: m.name, sub: `${m.client} · ${m.status}`, claims: m.claims, warrantyCost: m.warrantyCost, chargeable: m.chargeable, barPct: parseInt(m.barW, 10),
      })),
    );
  });
});

describe('R-155 (X-16): zone notices of the machine lists', () => {
  it.each(LANGS)('%s: a zone without machines says so on both screens; a zone with machines names the empty list', async (lang) => {
    const t = makeT(lang);
    const none = { ...(await getSavScreen('apac')), machines: [], claims: [], interventions: [] };
    expect(fleetView({ machines: [], today: DEMO_TODAY_ISO }, 'apac', t, lang).zoneEmpty).toBe(NOTICE[lang].machine);
    for (const view of SAV_VIEWS) expect(savView(none, view, 'apac', t, lang).zoneEmpty, view).toBe(NOTICE[lang].machine);
    // Asia Pacific of the seed: one machine (MCH-040), one closed claim, no intervention.
    const apac = await getSavScreen('apac');
    expect(SAV_VIEWS.map((view) => savView(apac, view, 'apac', t, lang).zoneEmpty)).toEqual([null, NOTICE[lang].interventions, null]);
    const noClaim = { ...apac, claims: [] };
    expect(SAV_VIEWS.map((view) => savView(noClaim, view, 'apac', t, lang).zoneEmpty)).toEqual([NOTICE[lang].claims, NOTICE[lang].interventions, NOTICE[lang].costs]);
    // No zone selected: never a notice.
    expect(savView(none, 'claims', null, t, lang).zoneEmpty).toBeNull();
    expect(fleetView({ machines: [], today: DEMO_TODAY_ISO }, null, t, lang).zoneEmpty).toBeNull();
  });
});

describe('Vigie links and the client', () => {
  it('a design ECO Vigie does not report is a plain tag for the client (the prototype\'s inert tag), a Vigie link for staff', async () => {
    const data = await getSavScreen(null);
    const eco = (vigie: boolean) => savView(data, 'claims', null, makeT('fr'), 'fr', { vigie }).claims!.find((c) => c.number === 'WC-013')!.eco;
    expect(eco(true)).toEqual({ text: 'ECO-031', href: vigieEcoUrl('ECO-031'), external: true, label: 'Ouvrir dans Vigie · ECO-031' });
    expect(eco(false)).toEqual({ text: 'ECO-031', href: null, external: false, label: 'ECO-031' });
    // An ECO Vigie reports opens Keystone's Change orders screen for everyone.
    const known = { ...data, claims: data.claims.map((c) => (c.number === 'WC-013' ? { ...c, ecoNumber: 'ECO-2026-015' } : c)) };
    const tagOf = (vigie: boolean) => savView(known, 'claims', null, makeT('en'), 'en', { vigie }).claims!.find((c) => c.number === 'WC-013')!.eco;
    expect(tagOf(false)).toMatchObject({ href: ecoHref('ECO-2026-015'), external: false });
    expect(tagOf(true)).toEqual(tagOf(false));
  });
});

describe('add-forms', () => {
  it.each(LANGS)('%s: "Add machine" — title, submit, labels, required marks and type options as the prototype', async (lang) => {
    const g = G[lang].forms.fleet;
    const def = localizeForm(machineFormDef(await machineTypeOptions()), makeT(lang), lang);
    expect([def.title, def.submit, def.kind]).toEqual([g.title, g.submit, 'create']);
    expect(def.fields.map((f) => [f.id, f.label, f.type, !!f.required])).toEqual(g.fields.map((f: any) => [f.id, f.label, f.type, f.req]));
    expect(def.fields[1].options).toEqual(g.fields[1].options.map((o: string) => ({ value: o, label: o })));
    expect(g.projectName).toBe(lang === 'fr' ? '#026 · Extension du terminal Harbor Line' : '#026 · Harbor Line Terminal Expansion');
  });

  it.each(LANGS)('%s: "New warranty claim" — machine options (numbers as values), severity / coverage codes, owners', async (lang) => {
    const g = G[lang].forms.sav;
    const opts = await claimFormOptions();
    const def = localizeForm(claimFormDef(opts.machines, opts.owners), makeT(lang), lang);
    expect([def.title, def.submit]).toEqual([g.title, g.submit]);
    // FR "Issue": the prototype's dictionary gave the stock "Sortie".
    expect(def.fields.map((f) => [f.id, f.label, f.type, !!f.required])).toEqual(
      g.fields.map((f: any) => [f.id, lang === 'fr' && f.id === 'issue' ? 'Problème' : f.label, f.type, f.req]),
    );
    const [machine, , sev, cover, owner] = def.fields;
    expect(machine.options).toEqual(g.fields[0].options.map((o: string) => ({ value: o.split(' · ')[0], label: o })));
    expect(sev.options).toEqual(['minor', 'major', 'critical'].map((value, i) => ({ value, label: g.fields[2].options[i] })));
    expect(cover.options).toEqual(['warranty', 'extended_warranty', 'chargeable'].map((value, i) => ({ value, label: g.fields[3].options[i] })));
    expect(owner.options).toEqual(g.fields[4].options);
  });
});
