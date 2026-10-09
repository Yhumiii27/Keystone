// Generates src/domain/site.golden.json: the prototype's own render values (`renderVals()`, EN and FR) of the Site
// (chantier) screen (docs/spec/10 §3, template 2268–2309, logic 4739–4760) — the three tabs (Readiness & go, Team &
// mobilisation, Daily execution), the header (title, crumb, primary, who gets it), the sidebar "NO GO" badge, the
// empty state of the other projects — for the seed and for the transitions the screen offers: "Client confirms" /
// "Signed on site" on a prerequisite, "Confirm" on equipment, "Remind in Cursus", and every prerequisite / equipment
// line confirmed (the Go conditions follow), plus the "Daily report" form (AF.site).
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-site.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// The sandbox keeps its own intrinsics (see proto-golden-d3.ts): `deepTr` compares prototypes with the sandbox's Object.
const ctx: any = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
  DCLogic: class {
    props: any;
    state: any;
    constructor(props: any) {
      this.props = props || {};
    }
    setState(p: any) {
      const u = typeof p === 'function' ? p(this.state) : p;
      this.state = { ...this.state, ...u };
    }
  },
};
vm.createContext(ctx);
vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;', ctx);

const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'mapRef' || typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const LANGS = ['en', 'fr'] as const;

function comp(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'site', ...state };
  return c;
}

/** Badge of the nav item `id`, wherever the nav tree puts it. */
function findBadge(v: any, id: string): string | null {
  let out: string | null = null;
  const walk = (x: any, d = 0) => {
    if (out !== null || d > 8 || !x || typeof x !== 'object') return;
    if (x.id === id && 'badge' in x) {
      out = x.badge;
      return;
    }
    for (const k of Object.keys(x)) walk(x[k], d + 1);
  };
  walk(v);
  return out;
}

const KPI = ['label', 'value', 'sub', 'color'];

/** Screen snapshot of a component state: header, badge, the three tabs. */
function snapshot(c: any) {
  const v = c.renderVals();
  const x = plain(v);
  return {
    crumb: v.crumb,
    title: v.title,
    primary: v.primaryAction,
    hasPrimary: v.hasPrimary,
    badge: findBadge(v, 'site'),
    isSiteProj: v.isSiteProj,
    siteNotProj: v.siteNotProj,
    seg: x.siteSeg.map((o: any) => o.label),
    kpis: x.siteKpis.map((k: any) => pick(k, KPI)),
    goItems: x.goItems.map((g: any) => pick(g, ['label', 'ok', 'sub', 'icon', 'color'])),
    goLabel: x.goLabel,
    meta: x.siteMeta.map((m: any) => [m.k, m.v]),
    prereqs: x.prereqs.map((p: any) => pick(p, ['title', 'act', 'due', 'status', 'tagClass', 'note', 'late', 'dueColor', 'canConfirm', 'canSign'])),
    equip: x.equip.map((e: any) => pick(e, ['name', 'src', 'srcClass', 'status', 'tagClass', 'note', 'canConfirm'])),
    docs: x.docs.map((d: any) => pick(d, ['who', 'visa', 'visaClass', 'vacc', 'vaccClass', 'hab', 'habClass', 'habNote', 'habColor', 'status', 'tagClass', 'rec', 'canReq', 'reminded'])),
    teamKpis: x.teamKpis.map((k: any) => pick(k, KPI)),
    rotation: x.rotation.map((r: any) => pick(r, ['who', 'role', 'from', 'to', 'lodging', 'travel', 'rot', 'collideIcon', 'collideColor'])),
    collisions: x.collisions.map((c0: any) => pick(c0, ['who', 'what', 'kind', 'tagClass', 'fix'])),
    missionCosts: x.missionCosts.map((m: any) => pick(m, ['name', 'budget', 'actual', 'pct', 'left'])),
    execKpis: x.execKpis.map((k: any) => pick(k, KPI)),
    reports: x.reports.map((r: any) => pick(r, ['date', 'act', 'pct', 'txt', 'link', 'by'])),
    reportLinks: v.reports.map((r: any) => !!r.openLink),
    punch: x.punch.map((r: any) => pick(r, ['id', 'title', 'ncr', 'status', 'tagClass', 'owner', 'due'])),
    hse: x.hse.map((r: any) => pick(r, ['title', 'status', 'tagClass', 'date'])),
  };
}

const out: any = { seed: {}, header: {}, scenarios: {}, toasts: {} };

// ── Seed, both languages, every project (only Harbor Line has a site sheet) ──
for (const lang of LANGS) {
  out.seed[lang] = snapshot(comp({ lang }));
  out.seed[lang].others = Object.fromEntries(PROJECTS.slice(1).map((p) => {
    const s = snapshot(comp({ lang, project: p }));
    return [p, { isSiteProj: s.isSiteProj, siteNotProj: s.siteNotProj, badge: s.badge, hasPrimary: s.hasPrimary }];
  }));
}

// ── Header per role and project (primary hidden outside the workspace / on a read-only project) ──
for (const code of ['HLT-026', 'NDC-031']) {
  out.header[code] = {};
  for (const role of ROLES) {
    const v = comp({ role, project: code }).renderVals();
    out.header[code][role] = { hasPrimary: v.hasPrimary, primary: v.primaryAction, readOnly: !!v.projReadOnly, outside: !!v.outside };
  }
}

// ── Transitions (state actions of the rows), then snapshot in EN and FR ──
function scenario(act: (c: any) => void) {
  const res: any = {};
  for (const lang of LANGS) {
    const c = comp();
    act(c);
    c.setState({ lang });
    res[lang] = snapshot(c);
  }
  return res;
}
const rows = (c: any) => c.renderValsEN();
out.scenarios.confirmPrereq3 = scenario((c) => rows(c).prereqs[3].confirm());
out.scenarios.signPrereq1 = scenario((c) => rows(c).prereqs[1].sign());
out.scenarios.confirmEquip2 = scenario((c) => rows(c).equip[2].confirm());
out.scenarios.remindDoc1 = scenario((c) => rows(c).docs[1].request());
out.scenarios.allConfirmed = scenario((c) => {
  rows(c).prereqs.forEach((p: any) => p.canConfirm && p.confirm());
  rows(c).equip.forEach((e: any) => e.canConfirm && e.confirm());
});

// ── Toasts of the Cursus actions and the collision targets ──
{
  // showToast (5116) is local to renderValsEN and writes state.toast (FR: per " · " segment).
  for (const lang of LANGS) {
    const toastOf = (act: (v: any) => void) => {
      const c = comp({ lang });
      act(c.renderValsEN());
      return c.state.toast;
    };
    out.toasts[lang] = {
      remind: toastOf((v) => v.docs[1].request()),
      sync: toastOf((v) => v.syncCursus()),
      open: toastOf((v) => v.openCursus()),
    };
  }
  const v = comp().renderValsEN();
  out.collisionTargets = v.collisions.map((k: any) => {
    const d = comp();
    d.renderValsEN().collisions.find((x: any) => x.who === k.who).open();
    return { who: k.who, kind: k.kind, screen: d.state.screen, siteTab: d.state.siteTab };
  });
  const r = comp();
  r.renderValsEN().reports[1].openLink();
  out.reportLink = { screen: r.state.screen, qTab: r.state.qTab, ncr: r.state.ncr };
}

// ── Daily report form (AF.site) and its result ──
out.form = plain(vm.runInContext('AF.site', ctx));
out.formResult = plain(vm.runInContext('typeof AF_RESULT !== "undefined" ? AF_RESULT.site : null', ctx));

fs.writeFileSync(path.join(root, 'src/domain/site.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/domain/site.golden.json');
