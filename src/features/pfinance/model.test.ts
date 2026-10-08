// Portfolio prioritisation & capacity and Cash flow & billing view models on a seeded in-memory database, compared
// with the prototype's own render values in EN and FR (pfinance.golden.json: `renderVals` of the prototype logic run
// in node, director and depthead, every zone). Deliberate deviations are asserted explicitly:
// - ranking: the 3 projects SCORES keyed by obsolete codes (EWA-051, RBR-048, CER-047) are ranked (00 §7.16), and
//   HLT-026's margin comes from the contract (13 %, A-5) instead of BILLING (11 %);
// - FR: "{money} proposés · approuvés · en planification" (left in English by the prototype) and singular forms
//   ("1 client project", "1 interne");
// - masked margins ("•••") are not coloured (the prototype's colour revealed margins under 15 %).
import { beforeAll, describe, expect, it } from 'vitest';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCapacityScreen, getCashScreen, getPrioritisationScreen, listProposalOptions, type PrioritisationScreen } from '@/server/dal/pfinance';
import type { ZoneKey } from '@/server/session';
import golden from './pfinance.golden.json';
import { pfT } from './i18n';
import { capacityView, cashView, liveWeights, parsePfTab, prioritisationHref, prioritisationView, tagClassOf, weightOnLeave, weightText, type CashData } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const ZONES = [null, 'euna', 'afr', 'apac'] as const;
const LANGS: Lang[] = ['en', 'fr'];
const tOf = (lang: Lang) => pfT(makeT(lang), lang);
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

/** Projects whose SCORES key is obsolete in the prototype (remapped at seed) and their expected scores. */
const REMAPPED: Record<string, number> = { 'EWA-051': 70, 'CER-047': 69, 'RBR-048': 57 };
const fixSub = (lang: Lang, s: string) =>
  lang === 'fr'
    ? s
        .replace(/ proposed · approved · planning$/, ' proposés · approuvés · en planification')
        .replace(/^1 projets clients/, '1 projet client')
        .replace(/ · ([01]) internes$/, ' · $1 interne')
        .replace(/^0 projets clients/, '0 projet client')
    : s.replace(/^1 client projects/, '1 client project');

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('prioritisation (03 §6)', () => {
  const screens = new Map<string, PrioritisationScreen>();
  const load = async (role: string, z: ZoneKey | null) => {
    const k = `${role}:${z}`;
    if (!screens.has(k)) screens.set(k, await getPrioritisationScreen(role, z));
    return screens.get(k)!;
  };

  for (const lang of LANGS)
    for (const role of ['director', 'depthead'])
      it.each(ZONES)(`${lang} · ${role} · zone %s: KPI tiles, ranking rows, weights card`, async (z) => {
        const g = G.portfolio[lang][role][String(z)];
        const d = await load(role, z);
        const v = prioritisationView(d, d.weights, tOf(lang), lang);
        // KPI tiles (the ranking gains the remapped projects but the top-ranked project is unchanged).
        expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map((k: any) => [k.label, String(k.value), fixSub(lang, k.sub), k.color]));
        expect([v.masked, v.zoneEmpty]).toEqual([g.masked, g.zoneEmpty]);
        // Ranking: every prototype row, same values; HLT-026 margin from the contract; plus the remapped projects.
        const byCode = new Map(v.rows.map((r) => [r.code, r]));
        for (const gr of g.rows) {
          const r = byCode.get(gr.code)!;
          const margin = gr.code === 'HLT-026' && role === 'director' ? '13%' : gr.marginText;
          expect([r.name, r.status, tagClassOf(r.tone), r.score, `${r.score}%`, r.budget, r.marginText, r.axes.map((a) => [a.label, a.value, a.dots.map((on) => (on ? 'var(--color-accent-500)' : 'var(--color-neutral-800)'))])], gr.code)
            .toEqual([gr.name, gr.status, gr.tagClass, gr.score, gr.scoreW, gr.budget, margin, gr.axes.map((a: any) => [a.l, a.v, a.dots])]);
          expect(r.marginColor, gr.code).toBe(role === 'director' ? gr.marginColor : OK);
        }
        const extra = v.rows.filter((r) => !g.rows.some((gr: any) => gr.code === r.code));
        expect(Object.fromEntries(extra.map((r) => [r.code, r.score]))).toEqual(Object.fromEntries(Object.entries(REMAPPED).filter(([c]) => d.projects.some((p) => p.code === c))));
        expect(extra.every((r) => r.marginText === (role === 'director' ? tOf(lang)('Internal') : '•••'))).toBe(true);
        expect(v.rows.map((r) => r.rank)).toEqual(v.rows.map((_, i) => i + 1));
        expect(v.rows.map((r) => r.score)).toEqual([...v.rows.map((r) => r.score)].sort((a, b) => b - a));
        // Weights card.
        expect(d.axes.map((a, i) => ({ k: a.code, l: v.weightRows[i].label, v: weightText(d.weights[i]), pct: v.weightRows[i].pct }))).toEqual(g.weights);
      });

  it('full ranking with the remapped projects (ties keep the register order: MSR-012 before CER-047)', async () => {
    const d = await load('director', null);
    const v = prioritisationView(d, d.weights, tOf('en'), 'en');
    expect(v.rows.map((r) => `${r.rank} ${r.code} ${r.score} ${r.marginText}`)).toEqual([
      '1 WSA-044 81 13%', '2 NDC-031 77 11%', '3 HLT-026 72 13%', '4 EWA-051 70 Internal', '5 MSR-012 69 14%', '6 CER-047 69 Internal', '7 ERP-202 66 Internal',
      '8 FTU-052 64 Internal', '9 RBR-048 57 Internal', '10 RCF-019 54 10%',
    ]);
    expect(d.candidates.map((c) => c.code)).toEqual(G.portfolio.en.director.null.wiSeg);
  });

  it.each(LANGS)('%s: edited weights recompute ranking, shares and the sum tile; selected row', async (lang) => {
    const d = await load('director', null);
    const proto = d.projects.filter((p) => !(p.code in REMAPPED));
    for (const g of G.weights[lang]) {
      const w = d.axes.map((a) => g.weights[a.code] as number);
      const v = prioritisationView({ ...d, projects: proto }, liveWeights(w.map(weightText)), tOf(lang), lang, 'NDC-031');
      // HLT-026's margin differs (contract), not its score.
      expect(v.rows.map((r) => ({ rank: r.rank, code: r.code, score: r.score, scoreW: `${r.score}%`, bg: r.selected ? 'var(--color-accent-900)' : 'transparent' }))).toEqual(g.rows);
      expect(v.weightRows.map((x, i) => ({ k: x.code, v: weightText(w[i]), pct: x.pct }))).toEqual(g.weightRows);
      const all0 = w.every((x) => x === 0);
      expect([v.kpis[4].value, v.kpis[4].color]).toEqual(all0 ? ['0%', LO] : [g.kpis[4].value, g.kpis[4].color]);
      expect(v.kpis[2].value).toBe(g.kpis[2].value);
    }
  });

  it('a weight field left empty is saved as 0 (prototype `setW`: NaN → 0); live parsing reads it as 0 too', () => {
    expect([weightOnLeave(''), weightOnLeave('  '), weightOnLeave('0.3'), weightOnLeave('1.5')]).toEqual(['0', '0', '0.3', '1.5']);
    expect(liveWeights(['', '0.3'])).toEqual([0, 0.3]);
  });

  it('URL state: tab (legacy "cash" → Prioritisation), candidate, selected row', () => {
    expect([parsePfTab(undefined), parsePfTab('cash'), parsePfTab('capacity'), parsePfTab('x')]).toEqual(['score', 'score', 'capacity', 'score']);
    expect(G.portfolio.legacyCashTab.isScore).toBe(true);
    expect(prioritisationHref({})).toBe('/portfolio/prioritisation');
    expect(prioritisationHref({ tab: 'capacity', project: 'EWA-051', sel: 'WSA-044' })).toBe('/portfolio/prioritisation?tab=capacity&project=EWA-051&sel=WSA-044');
  });

  it('"Score a proposal" choices: every pipeline project (all zones), labels as the prototype in EN and FR', async () => {
    const opts = await listProposalOptions();
    for (const lang of LANGS) expect(opts.map((o) => tOf(lang)(o.label))).toEqual(G.af.pipe[lang]);
    expect(opts.map((o) => o.value)).toEqual(['WSA-044', 'EWA-051', 'FTU-052', 'RBR-048', 'CER-047']);
  });
});

describe('capacity what-if (03 §6.5)', () => {
  for (const lang of LANGS)
    it.each(['WSA-044', 'EWA-051', 'FTU-052', 'RBR-048', 'CER-047'])(`${lang}: %s`, async (code) => {
      const g = G.portfolio[lang].director.null.capacity[code];
      const v = capacityView((await getCapacityScreen(code))!, tOf(lang), lang);
      const T = (s: string) => G.labels[s] && lang === 'fr' ? G.labels[s] : s;
      expect([v.name, v.status, tagClassOf(v.tone), v.budgetLine, v.verdict, v.verdictColor, v.gapLine, v.options]).toEqual([
        g.wi.name, g.wi.status, g.wi.tagClass, `${g.wi.budget} ${T('· start')} ${g.wi.start}`, g.wi.verdict, g.wi.verdictColor, `${T('Capacity gap ·')} ${g.wi.gapText}`, g.wi.options,
      ]);
      expect(v.rows.map((r) => ({ name: r.name, add: r.addText, text: r.text, color: r.color, curW: `${r.committedPct}%`, addW: `${r.candidatePct}%`, capL: `${r.capacityPct}%` }))).toEqual(
        g.rows.map((r: any) => ({ name: r.name, add: `+${r.add} h`, text: r.text, color: r.color, curW: r.curW, addW: r.addW, capL: r.capL })),
      );
    });

  it('zone candidates (wiSeg) follow the zone', async () => {
    for (const z of ZONES) expect((await getPrioritisationScreen('director', z)).candidates.map((c) => c.code)).toEqual(G.portfolio.en.director[String(z)].wiSeg);
    expect(await getCapacityScreen('XXX-000')).toBeNull();
  });
});

describe('cash flow & billing (03 §7)', () => {
  for (const lang of LANGS)
    for (const role of ['director', 'depthead'])
      it.each(ZONES)(`${lang} · ${role} · zone %s: KPI tiles, billing rows, bars`, async (z) => {
        const g = G.cash[lang][role][String(z)];
        const d: CashData = await getCashScreen(role, z);
        const v = cashView(d, tOf(lang), lang);
        expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map((k: any) => [k.label, k.value, fixSub(lang, k.sub), k.color]));
        expect(v.rows.map((r) => ({
          code: r.code, name: r.name, model: r.model, contract: r.contract, invoiced: r.invoiced, paid: r.paid, outstanding: r.outstanding, outColor: r.outColor, cost: r.cost,
          marginText: r.marginText, marginColor: r.marginColor, next: r.next, invW: `${r.invoicedPct}%`, paidW: `${r.paidPct}%`, isInternal: r.internal,
        }))).toEqual(g.rows.map((r: any) => ({ ...r, marginColor: role === 'director' ? r.marginColor : OK })));
        expect(v.bars.map((b) => ({ label: b.label, inH: `${b.inPct}%`, outH: `${b.outPct}%`, net: b.net, netColor: b.netColor }))).toEqual(
          g.bars.map((b: any) => ({ label: b.label, inH: b.inH, outH: b.outH, net: b.net, netColor: b.netColor })),
        );
        expect(v.zoneEmpty).toBe(g.zoneEmpty);
        if (role === 'depthead') expect(d.rows.every((r) => r.marginPct === null)).toBe(true);
      });
});
