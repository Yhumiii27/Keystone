// Generates src/domain/worldmap.golden.json and src/features/worldmap/worldmap.golden.json: the prototype's own
// output for the Projects map (docs/spec/03 §3, 02 SCR-WORLDMAP-FRAME).
// 1. The app logic (design file lines 3096–5239) runs in a node:vm sandbox (as scripts/proto-golden-d3.ts) for the
//    worldmap screen, every zone, EN and FR (`renderVals`): KPI tiles, crumb, site groups and the map's URL-hash
//    payload (ui labels, points, zone frame).
// 2. The map page's own functions (`design/Keystone PM map.html`: projected, clusters, styleOf, spread, fitBox,
//    onClick, applyView, boxOf, homeView, defaultView, tagClass, placeTip, focusCode) are extracted verbatim and
//    evaluated against the real d3-geo projection, for several frame sizes and zoom levels.
// 3. The map page's tooltip (`showTip`) runs on a minimal fake DOM, EN and FR, for every cluster at four zoom levels
//    (`tips` in the screen golden); the marker label is the `renderMarkers` expression.
//   npx tsx scripts/proto-golden-worldmap.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { geoNaturalEarth1 } from 'd3-geo';
import { zoomIdentity } from 'd3-zoom';

const root = path.resolve(__dirname, '..');

// ── 1. App logic: worldmap screen values ──
const app = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// Only host objects the logic needs: the sandbox keeps its own intrinsics so `deepTr` recognises plain objects (FR).
const appCtx: any = {
  console,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
};
vm.createContext(appCtx);
vm.runInContext(
  `class DCLogic { constructor(props) { this.props = props || {}; } setState(p) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; } }\n` +
    app.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;',
  appCtx,
);
const ZONES = [null, 'euna', 'afr', 'apac'] as const;
const screen: any = {};
for (const lang of ['en', 'fr'])
  for (const z of ZONES) {
    const c = new appCtx.__C({});
    c.state = { ...c.state, role: 'director', lang, project: 'HLT-026', screen: 'worldmap', pfZone: z };
    const v = c.renderVals();
    const hash = JSON.parse(decodeURIComponent(v.mapSrc.split('#')[1]));
    screen[`${lang}|${z}`] = {
      crumb: v.crumb,
      title: v.title,
      kpis: v.mapKpis.map((k: any) => ({ label: k.label, value: k.value, sub: k.sub, color: k.color })),
      siteCount: v.mapSiteCount,
      zoneEmpty: v.zoneEmptyMap,
      groups: v.mapGroups.map((g: any) => ({
        city: g.city, country: g.country, count: g.count,
        items: g.items.map((i: any) => ({ code: i.code, name: i.name, sub: `${i.code} · ${i.pm} · ${i.client}`, status: i.status, statusClass: i.statusClass, health: i.health, healthClass: i.healthClass })),
      })),
      ui: hash.ui,
      zone: hash.zone,
      points: hash.points,
    };
  }

// ── 2. Map page functions ──
const mapSrc = fs.readFileSync(path.join(root, 'design/Keystone PM map.html'), 'utf8');
const NAMES = ['projected', 'clusters', 'styleOf', 'spread', 'fitBox', 'onClick', 'applyView', 'boxOf', 'homeView', 'defaultView', 'tagClass', 'placeTip', 'focusCode'];
const fnSrc = NAMES.map((n) => {
  const m = mapSrc.split('\n').find((l) => l.startsWith(`function ${n}(`));
  if (!m) throw new Error('missing ' + n);
  return m;
}).join('\n');
const env = `
let W=800,H=500,k=1,view=null,pinned=null,data={points:[]},captured=null,current=d3.zoomIdentity,tipShown=null;
const zoom={transform:'zoom.transform'};
const svg={
  call(fn,t){captured=t;},
  transition(){ return { duration(){ return { call(fn,t){captured=t;} }; } }; },
  node(){return null;},
};
const ctl={children:[]};
const tip={offsetWidth:0,offsetHeight:0,style:{}};
function showTip(d,p){tipShown={pinned:p,codes:d.items.map(i=>i.code)};}
function hideTip(){tipShown=null;}
`;
// d3-array's min / max / mean (ignore null and NaN; mean = sum / count in order), as the map page loads d3@7.
const min = (values: any[], f: (v: any) => any = (v) => v) => {
  let m: any;
  for (const x of values) { const v = f(x); if (v != null && (m > v || (m === undefined && v >= v))) m = v; }
  return m;
};
const max = (values: any[], f: (v: any) => any = (v) => v) => {
  let m: any;
  for (const x of values) { const v = f(x); if (v != null && (m < v || (m === undefined && v >= v))) m = v; }
  return m;
};
const mean = (values: any[], f: (v: any) => any = (v) => v) => {
  let count = 0;
  let sum = 0;
  for (const x of values) { const v = f(x); if (v != null && +v >= +v) { count++; sum += +v; } }
  return count ? sum / count : undefined;
};
const mapCtx: any = {
  console,
  proj: geoNaturalEarth1(),
  d3: { mean, min, max, zoomIdentity, zoomTransform: () => mapCtx.__current },
  __current: zoomIdentity,
};
vm.createContext(mapCtx);
vm.runInContext(
  env + fnSrc + `
globalThis.api = {
  set(o) { if ('W' in o) W = o.W; if ('H' in o) H = o.H; if ('k' in o) k = o.k; if ('data' in o) data = o.data; },
  fit() { proj.fitExtent([[6,6],[W-6,H-6]],{type:'Sphere'}); },
  projected, clusters, styleOf, tagClass, homeView, defaultView, spread,
  view(v) { captured = null; applyView(v, false); return captured; },
  focus(code) { captured = null; focusCode(code); return captured; },
  click(d) { captured = null; tipShown = null; pinned = null; onClick(d); return { transform: captured, tip: tipShown }; },
  place(d, t, tw, th) { globalThis.__current = t; tip.offsetWidth = tw; tip.offsetHeight = th; placeTip(d); return { left: tip.style.left, top: tip.style.top }; },
};`,
  mapCtx,
);
const api = mapCtx.api;
const tf = (t: any) => (t ? { k: t.k, x: t.x, y: t.y } : null);

const SIZES: [number, number][] = [[800, 500], [1100, 640], [360, 460]];
const KS = [1, 1.5, 2.4, 3, 6, 12, 48];
const geometry: any = {};
const zones: any = {};
for (const z of ZONES) {
  const sv = screen[`en|${z}`];
  const data = { points: sv.points, zone: sv.zone };
  zones[String(z)] = { zone: sv.zone, points: sv.points.map((p: any) => ({ code: p.code, city: p.city, country: p.country, lat: p.lat, lng: p.lng, cat: p.cat, health: p.health })) };
  for (const [W, H] of SIZES) {
    api.set({ W, H, data });
    api.fit();
    const pts = api.projected();
    const g: any = {
      projected: pts.map((p: any) => ({ code: p.code, x: p.x, y: p.y })),
      homeView: api.homeView(),
      views: { world: tf(api.view('world')), europe: tf(api.view('europe')), fit: tf(api.view('fit')) },
      clusters: {} as any,
      clicks: {} as any,
      focus: Object.fromEntries(pts.map((p: any) => [p.code, tf(api.focus(p.code))])),
    };
    for (const k of KS) {
      api.set({ k });
      const cl = api.clusters();
      g.clusters[k] = cl.map((c: any) => ({ codes: c.items.map((i: any) => i.code), x: c.x, y: c.y }));
      g.clicks[k] = cl.map((c: any) => {
        const r = api.click(c);
        return r.transform ? { zoom: tf(r.transform) } : { pin: r.tip.codes };
      });
    }
    api.set({ k: 1 });
    geometry[`${z}|${W}x${H}`] = g;
  }
}

// Styles and tooltip tag classes per point (EN, where the prototype's string comparisons work).
const styles = Object.fromEntries(screen['en|null'].points.map((p: any) => [p.code, { style: api.styleOf(p), tagClass: api.tagClass(p) }]));

// Tooltip placement: marker at projected (x, y) under transform t, tooltip tw × th, frame 800 × 500.
api.set({ W: 800, H: 500 });
const placements = [
  [{ x: 100, y: 100 }, { k: 1, x: 0, y: 0 }, 260, 120],
  [{ x: 700, y: 100 }, { k: 1, x: 0, y: 0 }, 260, 120],
  [{ x: 400, y: 480 }, { k: 1, x: 0, y: 0 }, 260, 140],
  [{ x: 10, y: 4 }, { k: 1, x: 0, y: 0 }, 300, 90],
  [{ x: 300, y: 200 }, { k: 4, x: -900, y: -500 }, 240, 200],
  [{ x: 210, y: 130 }, { k: 2.5, x: -100, y: 30 }, 320, 480],
].map(([d, t, tw, th]: any) => ({ d, t, tw, th, out: api.place(d, zoomIdentity.translate(t.x, t.y).scale(t.k), tw, th) }));

// ── 3. Tooltip and marker label texts (map page `showTip`, `renderMarkers`) ──
// The map page's own `showTip` (with `tagClass`, `placeTip`) runs against a minimal fake DOM on the hash payload the
// host sent (EN and FR), for every cluster at several zoom levels in an 800 × 500 frame: header, rows (name, sub,
// tag class | text), footer and the marker label ("{city}" / "{n} sites", transcribed from `renderMarkers`, which
// needs a d3 selection).
const mapLines = mapSrc.split('\n');
const iShow = mapLines.findIndex((l) => l.startsWith('function showTip('));
const iPlace = mapLines.findIndex((l) => l.startsWith('function placeTip('));
if (iShow < 0 || iPlace < iShow) throw new Error('missing showTip');
const showTipSrc = mapLines.slice(iShow, iPlace).join('\n');
const lineOf = (n: string) => mapLines.find((l) => l.startsWith(`function ${n}(`))!;
class FakeEl {
  children: any[] = [];
  className = '';
  textContent = '';
  style: Record<string, string> = {};
  appendChild(c: any) { this.children.push(c); return c; }
  addEventListener() {}
  set innerHTML(_v: string) { this.children = []; }
  get offsetWidth() { return 260; }
  get offsetHeight() { return 120; }
}
const TIP_KS = [1, 2.4, 6, 48];
const tips: any = {};
for (const lang of ['en', 'fr'])
  for (const z of ZONES) {
    const sv = screen[`${lang}|${z}`];
    const tipCtx: any = {
      console,
      document: { createElement: () => new FakeEl(), createTextNode: (s: string) => ({ textContent: s }) },
      proj: geoNaturalEarth1(),
      d3: { mean, min, max, zoomIdentity, zoomTransform: () => zoomIdentity },
    };
    vm.createContext(tipCtx);
    vm.runInContext(
      `let W=800,H=500,k=1;const data=${JSON.stringify({ points: sv.points })};const ui=${JSON.stringify(sv.ui)};` +
        `const tip=document.createElement('div');const svg={node(){return null;}};\n` +
        [lineOf('projected'), lineOf('clusters'), lineOf('tagClass'), showTipSrc, lineOf('placeTip')].join('\n') +
        `\nproj.fitExtent([[6,6],[W-6,H-6]],{type:'Sphere'});
globalThis.run=(kk)=>{k=kk;return clusters().map(d=>{showTip(d,false);const c=tip.children;
  const cities=[...new Set(d.items.map(i=>i.city))];
  return {codes:d.items.map(i=>i.code),header:c[0].children[0].textContent,
    rows:c.slice(1,-1).map(r=>({name:r.children[0].children[0].textContent,sub:r.children[0].children[1].textContent,tags:r.children[1].children.map(t=>t.className+'|'+t.textContent)})),
    open:c[c.length-1].textContent,label:d.items.length>1?(cities.length===1?cities[0]:cities.length+' sites'):d.items[0].city};});};`,
      tipCtx,
    );
    for (const k of TIP_KS) tips[`${lang}|${z}|${k}`] = tipCtx.run(k);
  }
screen.tips = tips;

const domainTarget = path.join(root, 'src/domain/worldmap.golden.json');
fs.writeFileSync(domainTarget, JSON.stringify({ sizes: SIZES, ks: KS, zones, geometry, styles, placements }, null, 1) + '\n');
const screenTarget = path.join(root, 'src/features/worldmap/worldmap.golden.json');
fs.mkdirSync(path.dirname(screenTarget), { recursive: true });
fs.writeFileSync(screenTarget, JSON.stringify(screen, null, 1) + '\n');
for (const t of [domainTarget, screenTarget]) console.log('wrote', path.relative(root, t), Math.round(fs.statSync(t).size / 1024) + ' KB');
