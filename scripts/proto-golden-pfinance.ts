// Generates src/features/pfinance/pfinance.golden.json: the prototype's own render values (`renderVals`, i.e.
// renderValsEN + the FR deep translation) of the Portfolio prioritisation & capacity screen (`portfolio`) and the
// Cash flow & billing screen (`cash`), in EN and FR, for a viewer with margin rights (director) and one without
// (depthead, outside the workspace), for every zone. Also the static template labels of both screens (template
// 2079–2179) and the AF `portfolio` form, with their FR rendering.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with the sandbox's own intrinsics (the
// FR deep translation checks `Object.getPrototypeOf(v) === Object.prototype`, so host built-ins must not be injected).
//   npx tsx scripts/proto-golden-pfinance.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const design = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
const ctx: any = {
  console,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
};
vm.createContext(ctx);
vm.runInContext(
  `class DCLogic { constructor(props) { this.props = props || {}; } setState(p) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; } }\n` +
    design.slice(3095, 5239).join('\n') +
    '\n;globalThis.__C = Component; globalThis.__tr = s => fixEnt(trFR(s)); globalThis.__AF = AF; globalThis.__AFR = typeof AF_RESULT !== "undefined" ? AF_RESULT : {};',
  ctx,
);

const render = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c.renderVals();
};
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

const ZONES = [null, 'euna', 'afr', 'apac'] as const;
const ROLES = ['director', 'depthead'] as const;
const LANGS = ['en', 'fr'] as const;

const out: any = { portfolio: {}, cash: {}, weights: {}, labels: {}, af: {} };

// ── Static template labels (template 2079–2179, «…» = EN source) ──
const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2078, 2179).join('\n');
const labels = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
for (const en of [...labels, 'Display', 'No project in this zone for this view']) out.labels[en] = ctx.__tr(en);

// ── AF portfolio ("Score a proposal") ──
const af = plain(ctx.__AF.portfolio);
out.af = {
  def: af,
  result: ctx.__AFR.portfolio ?? null,
  fr: {
    title: ctx.__tr(af.title),
    submit: ctx.__tr(af.submit),
    labels: af.fields.map((f: any) => ctx.__tr(f[1])),
    result: ctx.__AFR.portfolio ? ctx.__tr(ctx.__AFR.portfolio) : null,
  },
  /** PIPE options (all projects in pipeline stages, pname) in EN and FR. */
  pipe: Object.fromEntries(LANGS.map((lang) => {
    const c = new ctx.__C({});
    c.state = { ...c.state, role: 'director', lang, project: 'HLT-026', screen: 'portfolio' };
    c.state.af = { open: true, key: 'portfolio', values: {} };
    const v = c.renderVals();
    const f = v.afForm && v.afForm.fields ? plain(v.afForm.fields).find((x: any) => x.id === 'project') : null;
    return [lang, f ? f.options.map((o: any) => o.v) : null];
  })),
};

// ── Prioritisation & capacity ──
const rowKeys = ['rank', 'code', 'name', 'status', 'tagClass', 'score', 'scoreW', 'budget', 'marginText', 'marginColor', 'isPipeline', 'bg'];
for (const lang of LANGS) {
  out.portfolio[lang] = {};
  for (const role of ROLES) {
    out.portfolio[lang][role] = {};
    for (const z of ZONES) {
      const v = render({ screen: 'portfolio', lang, role, pfZone: z });
      const cap: any = {};
      const seg = plain(render({ screen: 'portfolio', lang, role, pfZone: z, pfTab: 'capacity' }).wiSeg).map((o: any) => o.label);
      for (const code of seg) {
        const c = render({ screen: 'portfolio', lang, role, pfZone: z, pfTab: 'capacity', pfWhatif: code });
        cap[code] = { wi: plain(c.wi), rows: plain(c.capRows), hasWi: c.hasWi, isCap: c.pfIsCap };
      }
      out.portfolio[lang][role][String(z)] = {
        seg: plain(v.pfSeg).map((o: any) => [o.label, o.color]),
        view: v.FL.view,
        zoneEmpty: v.zoneEmptyPf,
        zoneEmptyText: v.zoneEmptyText,
        masked: v.marginMasked,
        isScore: v.pfIsScore,
        kpis: plain(v.pfKpis),
        rows: plain(v.scoreRows).map((r: any) => ({ ...pick(r, rowKeys), axes: r.axes.map((a: any) => ({ l: a.l, v: a.v, dots: a.dots.map((d: any) => d.bg) })) })),
        weights: plain(v.weightRows).map((w: any) => pick(w, ['k', 'l', 'v', 'pct'])),
        wiSeg: seg,
        capacity: cap,
      };
    }
  }
}
// Selected row (pfSel) and edited weights (pfWeights): live recomputation.
const variants = [
  { fit: 1, margin: 0, risk: 0, res: 0, client: 0 },
  { fit: 0.5, margin: 0.25, risk: 0.2, res: 0.15, client: 0.15 },
  { fit: 0, margin: 0, risk: 0, res: 0, client: 0 },
  { fit: 0.1, margin: 0.1, risk: 0.1, res: 0.1, client: 0.1 },
];
for (const lang of LANGS) {
  out.weights[lang] = variants.map((w) => {
    const v = render({ screen: 'portfolio', lang, pfWeights: w, pfSel: 'NDC-031' });
    return {
      weights: w,
      kpis: plain(v.pfKpis),
      rows: plain(v.scoreRows).map((r: any) => pick(r, ['rank', 'code', 'score', 'scoreW', 'bg'])),
      weightRows: plain(v.weightRows).map((x: any) => pick(x, ['k', 'v', 'pct'])),
    };
  });
}
// Legacy tab value 'cash' renders the Prioritisation tab.
out.portfolio.legacyCashTab = { isScore: render({ screen: 'portfolio', pfTab: 'cash' }).pfIsScore, seg: plain(render({ screen: 'portfolio', pfTab: 'cash' }).pfSeg).map((o: any) => o.color) };

// ── Cash flow & billing ──
const cashKeys = ['code', 'name', 'model', 'contract', 'invoiced', 'paid', 'outstanding', 'outColor', 'cost', 'marginText', 'marginColor', 'next', 'invW', 'paidW', 'isInternal'];
for (const lang of LANGS) {
  out.cash[lang] = {};
  for (const role of ROLES) {
    out.cash[lang][role] = {};
    for (const z of ZONES) {
      const v = render({ screen: 'cash', lang, role, pfZone: z });
      out.cash[lang][role][String(z)] = {
        zoneEmpty: v.zoneEmptyCash,
        kpis: plain(v.cashKpis),
        rows: plain(v.cashRows).map((r: any) => pick(r, cashKeys)),
        bars: plain(v.cashBars),
      };
    }
  }
}
// The project Billing screen's issued invoices (ctrOv) flow into the cash rows: M4 invoiced.
out.cash.m4Invoiced = plain(render({ screen: 'cash', ctrOv: { M4: 'Invoiced' } }).cashRows)[0];

const target = path.join(root, 'src/features/pfinance/pfinance.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
