// Portfolio prioritisation & capacity and Cash flow & billing view models on a seeded in-memory database, compared
// with the prototype's own render values in EN and FR (pfinance.golden.json: `renderVals` of the prototype logic run
// in node, director and depthead, every zone). Deliberate deviations are asserted explicitly:
// - ranking: the 3 projects SCORES keyed by obsolete codes (EWA-051, RBR-048, CER-047) are ranked (00 §7.16), and
//   HLT-026's margin comes from the contract (13 %, A-5) instead of BILLING (11 %);
// - FR: "{money} proposés · approuvés · en planification" (left in English by the prototype) and singular forms
//   ("1 client project", "1 interne");
// - masked margins ("•••") are not coloured (the prototype's colour revealed margins under 15 %).
// Delivery 7: C-10b (R-132) the margins shown are margins at completion (contract − EAC, `MARGIN_D7`); NEW-D3-3 (R-079)
// HLT-026's base milestones are priced on the base amount (`HLT_D7`); C-10a / C-6 (R-133, R-076) the cash forecast.
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

// ── A-12 (chapter 4): KPIs computed from the data instead of the prototype's constants (src/domain/kpis.ts) ──────────
/**
 * "Portfolio margin" = Σ (contract − EAC) / Σ contract over the zone's active client projects (was 18 % everywhere).
 * Delivery 7 (R-073, C-2a): EAC = BAC / CPI with the CPI computed from the activities — afr (NDC-031, CPI 1.05 → 1.10) 15 → 19 %.
 */
const MARGIN_A12: Record<string, string> = { null: '8%', euna: '5%', afr: '19%', apac: '—' };
/** Delivery 7 (R-073): actual cost of the projects with activities (activities' actual cost + validated contingency draw-downs). */
const COST_D7: Record<Lang, Record<string, string>> = {
  en: { 'NDC-031': '€884k', 'RCF-019': '€1.08M', 'ERP-202': '€457k', 'MSR-012': '€553k' },
  fr: { 'NDC-031': '884 k€', 'RCF-019': '1,08 M€', 'ERP-202': '457 k€', 'MSR-012': '553 k€' },
};
/**
 * Capacity what-if: capacity and commitments from the resource pool's allocations, demand per €1M from the active
 * portfolio's value. Per candidate: [add, total, capacity] per department (ROLES order) and the gap (prototype 1 560 h…).
 */
/**
 * C-10b (R-132): one margin everywhere — the margin at completion, (contract − EAC) / contract, from the cost forecast.
 * The prototype's budgeted margins: WSA-044 13 %, NDC-031 11 %, HLT-026 13 % (contract, A-5), MSR-012 14 %, RCF-019 10 %.
 * The EAC = BAC / CPI follows R-073's computed progress and actual cost (lot cost-control; on the prototype's figures the margins
 * at completion were WSA 16 %, NDC 15 %, HLT 5 %, MSR 16 %, RCF 2 %).
 */
const MARGIN_D7: Record<string, string> = { 'WSA-044': '21%', 'NDC-031': '19%', 'HLT-026': '3%', 'MSR-012': '17%', 'RCF-019': '7%' };
/** Margins under 15 % are highlighted (the prototype's rule, unchanged). */
const marginColorD7 = (code: string) => (parseInt(MARGIN_D7[code], 10) < 15 ? LO : OK);
/**
 * NEW-D3-3 (R-079): HLT-026's invoices at base-amount prices (25 % of €5.40M = €1.35M for M3…) and M4 at €1.08M — the
 * prototype re-priced them on base + signed amendments (€3.04M invoiced, €1.66M paid, €1.38M outstanding, M4 €1.10M).
 */
const HLT_D7: Record<Lang, Record<string, string>> = {
  en: { invoiced: '€2.97M', paid: '€1.62M', outstanding: '€1.35M', next: 'M4 Cranes operational · €1.08M', invW: '54%', paidW: '29%' },
  fr: { invoiced: '2,97 M€', paid: '1,62 M€', outstanding: '1,35 M€', next: 'M4 Cranes operational · 1,08 M€', invW: '54%', paidW: '29%' },
};
/** NEW-D3-3: the "Invoiced to date" and "Outstanding receivables" tiles follow (zones with HLT-026). */
const CASH_TILES_D7: Record<string, string> = {
  '€5.26M': '€5.19M', '€1.94M': '€1.91M', '€4.37M': '€4.30M', '€1.68M': '€1.65M',
  '5,26 M€': '5,19 M€', '1,94 M€': '1,91 M€', '4,37 M€': '4,30 M€', '1,68 M€': '1,65 M€',
};
const CAPACITY_A12: Record<string, { gap: number; rows: [number, number, number][] }> = {
  'WSA-044': { gap: 151, rows: [[73, 391, 320], [122, 654, 640], [72, 386, 320], [164, 880, 960], [58, 310, 320]] },
  'EWA-051': { gap: 86, rows: [[47, 365, 320], [79, 611, 640], [47, 361, 320], [106, 822, 960], [37, 289, 320]] },
  'FTU-052': { gap: 12, rows: [[10, 328, 320], [17, 549, 640], [10, 324, 320], [23, 739, 960], [8, 260, 320]] },
  'RBR-048': { gap: 305, rows: [[109, 427, 320], [183, 715, 640], [108, 422, 320], [246, 962, 960], [87, 339, 320]] },
  'CER-047': { gap: 73, rows: [[41, 359, 320], [68, 600, 640], [40, 354, 320], [92, 808, 960], [32, 284, 320]] },
};
/**
 * Cash flow: the 6 months after the data date from the billing plans (in) and the cost forecasts (out), per zone —
 * "Net cash · next 6 months", "Lowest cumulative point" (value and sub-line) and the bars [in %, out %, net].
 * Delivery 7: C-10a (R-133) the remaining spend follows each project's planned (PV) curve instead of an even spread
 * (chapter 4: null +€2.84M, low −€521k; euna +€2.34M, −€617k; afr +€498k, +€97k); C-6 (R-076) receipts at the payment
 * rule's exact dates; NEW-D3-3 HLT-026 at base-amount prices plus Amendment 1's M6. R-073 (lot cost-control): the planned curve
 * is the Budget's PV computed from the cost-loaded BL1 and the ETC = EAC − actual uses the computed progress and actual cost
 * (contract-portfolio alone, on the prototype's PV and figures: null +€2.87M, −€1.08M; euna +€2.38M, −€1.03M; afr +€496k, −€51k;
 * cost-control alone, even spread: null +€2.71M, −€570k).
 */
const CASH_A12: Record<string, { net: Record<Lang, string>; low: Record<Lang, string>; lowSub: Record<Lang, string>; bars: [number, number, string][] }> = {
  null: {
    net: { en: '+€2.75M', fr: '+2,75 M€' }, low: { en: '−€1.41M', fr: '−1,41 M€' },
    lowSub: { en: 'October — before M3 payment lands (HLT-026)', fr: 'Octobre — avant l’encaissement de M3 (HLT-026)' },
    bars: [[28, 100, '−1412k'], [95, 55, '+801k'], [43, 21, '+428k'], [73, 6, '+1331k'], [68, 8, '+1196k'], [25, 4, '+402k']],
  },
  euna: {
    net: { en: '+€2.29M', fr: '+2,29 M€' }, low: { en: '−€1.30M', fr: '−1,30 M€' },
    lowSub: { en: 'October — before M3 payment lands (HLT-026)', fr: 'Octobre — avant l’encaissement de M3 (HLT-026)' },
    bars: [[18, 98, '−1304k'], [100, 53, '+773k'], [37, 15, '+353k'], [73, 3, '+1156k'], [82, 2, '+1317k'], [0, 0, '−1k']],
  },
  afr: {
    net: { en: '+€453k', fr: '+453 k€' }, low: { en: '−€107k', fr: '−107 k€' },
    lowSub: { en: 'October — before the October progress payment lands (NDC-031)', fr: 'Octobre — avant l’encaissement de la situation d’octobre (NDC-031)' },
    bars: [[17, 24, '−107k'], [16, 14, '+28k'], [16, 11, '+75k'], [16, 5, '+175k'], [0, 8, '−121k'], [32, 6, '+403k']],
  },
  apac: {
    net: { en: '€0k', fr: '0 k€' }, low: { en: '€0k', fr: '0 k€' }, lowSub: { en: 'October — lowest point of the window', fr: 'Octobre — point bas de la période' },
    bars: [[0, 0, '+0k'], [0, 0, '+0k'], [0, 0, '+0k'], [0, 0, '+0k'], [0, 0, '+0k'], [0, 0, '+0k']],
  },
};

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
        // A-12: "Portfolio margin" computed (directors and PMs only; masked otherwise).
        const margin = (k: any, i: number) => (i === 3 && role === 'director' ? MARGIN_A12[String(z)] : String(k.value));
        expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map((k: any, i: number) => [k.label, margin(k, i), fixSub(lang, k.sub), k.color]));
        expect([v.masked, v.zoneEmpty]).toEqual([g.masked, g.zoneEmpty]);
        // Ranking: every prototype row, same values; margins at completion (C-10b); plus the remapped projects.
        const byCode = new Map(v.rows.map((r) => [r.code, r]));
        for (const gr of g.rows) {
          const r = byCode.get(gr.code)!;
          const margin = role === 'director' && MARGIN_D7[gr.code] ? MARGIN_D7[gr.code] : gr.marginText;
          expect([r.name, r.status, tagClassOf(r.tone), r.score, `${r.score}%`, r.budget, r.marginText, r.axes.map((a) => [a.label, a.value, a.dots.map((on) => (on ? 'var(--color-accent-500)' : 'var(--color-neutral-800)'))])], gr.code)
            .toEqual([gr.name, gr.status, gr.tagClass, gr.score, gr.scoreW, gr.budget, margin, gr.axes.map((a: any) => [a.l, a.v, a.dots])]);
          expect(r.marginColor, gr.code).toBe(role === 'director' ? (MARGIN_D7[gr.code] ? marginColorD7(gr.code) : gr.marginColor) : OK);
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
      '1 WSA-044 81 21%', '2 NDC-031 77 19%', '3 HLT-026 72 3%', '4 EWA-051 70 Internal', '5 MSR-012 69 17%', '6 CER-047 69 Internal', '7 ERP-202 66 Internal',
      '8 FTU-052 64 Internal', '9 RBR-048 57 Internal', '10 RCF-019 54 7%',
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
      // A-12: the model is computed (allocations, portfolio value), so the verdict, gap, the contractor option and the
      // rows follow CAPACITY_A12; the project line, its other options and the department names stay the prototype's.
      const a = CAPACITY_A12[code];
      const t = tOf(lang);
      const verdict = a.gap >= 300 ? `Needs ${Math.ceil(a.gap / 140)} additional people or a later start` : `Absorbable with ${a.gap} h of overtime or one contractor`;
      const options = g.wi.options.map((o: string, i: number) => (i === 1 ? t(`Contract ${Math.ceil(a.gap / 280)} engineer(s) for the ramp-up phase`) : o));
      expect([v.name, v.status, tagClassOf(v.tone), v.budgetLine, v.verdict, v.verdictColor, v.gapLine, v.options]).toEqual([
        g.wi.name, g.wi.status, g.wi.tagClass, `${g.wi.budget} ${T('· start')} ${g.wi.start}`, t(verdict), LO, `${T('Capacity gap ·')} ${t(`${a.gap} h over 8 weeks`)}`, options,
      ]);
      expect(v.rows.map((r) => ({ name: r.name, add: r.addText, text: r.text, color: r.color }))).toEqual(
        g.rows.map((r: any, i: number) => {
          const [add, total, cap] = a.rows[i];
          return { name: r.name, add: `+${add} h`, text: `${total} / ${cap} h`, color: total > cap ? LO : 'var(--color-neutral-300)' };
        }),
      );
      for (const r of v.rows) expect(r.committedPct + r.candidatePct).toBeLessThanOrEqual(100);
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
        // A-12: the forecast is computed (billing plan in, cost forecast out) — net cash, low point and bars per CASH_A12.
        const c = CASH_A12[String(z)];
        const cashKpi = (k: any, i: number) =>
          i === 3 ? [k.label, c.net[lang], fixSub(lang, k.sub), k.color] : i === 4 ? [k.label, c.low[lang], c.lowSub[lang], k.color] : [k.label, CASH_TILES_D7[k.value] ?? k.value, fixSub(lang, k.sub), k.color];
        expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map(cashKpi));
        expect(v.rows.map((r) => ({
          code: r.code, name: r.name, model: r.model, contract: r.contract, invoiced: r.invoiced, paid: r.paid, outstanding: r.outstanding, outColor: r.outColor, cost: r.cost,
          marginText: r.marginText, marginColor: r.marginColor, next: r.next, invW: `${r.invoicedPct}%`, paidW: `${r.paidPct}%`, isInternal: r.internal,
        }))).toEqual(
          g.rows.map((r: any) => ({
            ...r,
            cost: COST_D7[lang][r.code] ?? r.cost,
            ...(r.code === 'HLT-026' ? HLT_D7[lang] : {}),
            ...(role === 'director' && MARGIN_D7[r.code] ? { marginText: MARGIN_D7[r.code] } : {}),
            marginColor: role === 'director' ? (MARGIN_D7[r.code] ? marginColorD7(r.code) : r.marginColor) : OK,
            // NEW-D5-3 'a' (R-156): in French RCF-019's next milestone, Handover, is « Transfert » (the prototype said « Livraison »).
            ...(lang === 'fr' && r.code === 'RCF-019' ? { next: r.next.replace(/^Livraison · /, 'Transfert · ') } : {}),
          })),
        );
        expect(v.bars.map((b) => ({ label: b.label, inH: `${b.inPct}%`, outH: `${b.outPct}%`, net: b.net, netColor: b.netColor }))).toEqual(
          g.bars.map((b: any, i: number) => ({ label: b.label, inH: `${c.bars[i][0]}%`, outH: `${c.bars[i][1]}%`, net: c.bars[i][2], netColor: LO })),
        );
        expect(v.zoneEmpty).toBe(g.zoneEmpty);
        if (role === 'depthead') expect(d.rows.every((r) => r.marginPct === null)).toBe(true);
      });
});
