'use client';
// Projects map (docs/spec/02 SCR-WORLDMAP-FRAME, 03 §3.3): the prototype's d3 world map page
// (`design/Keystone PM map.html`) rebuilt as an in-app component instead of an iframe (00 L-7, 02 Q-17).
// d3-geo NaturalEarth1 projection fitted to the frame, 10° graticule and countries from the self-hosted
// world-atlas 2.0.2 (110m, loaded as a separate chunk), d3-zoom pan/zoom (scale 1–48, no double-click zoom),
// greedy clustering by zoom level with counts, counter-scaled markers styled by category and health, labels when
// zoomed in, hover/pinned tooltip listing the projects with their tags and links, World / Europe-or-zone /
// Projects view buttons, legend and attribution. Geometry, clustering and framing rules: src/domain/worldmap.ts.
// Host contract (replaces the postMessage protocol): `highlight` prop (list hover), `ref.focus(code)` (site
// header), `ref.view(v)`; tooltip rows are links (the host computes `href`: Plan, or the Projects register).
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { select, type TransitionLike } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import Link from 'next/link';
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { Tag, type TagTone } from '@/components/ds/Tag';
import { cx } from '@/components/ds/cx';
import {
  DEFAULT_SIZE, IDENTITY, MAP_VIEWS, SCALE_EXTENT, SPHERE_INSET, VIEW_MS, clusterClick, clusterKey, clusterPoints, focusTransform, homeView,
  markerLabelText, placeTooltip, showMarkerLabels, tooltipTitle, viewTransform, type GeoBounds, type MapTransform, type MapView,
  type MarkerStyle,
} from '@/domain/worldmap';
import { useI18n } from '@/i18n/client';
import s from './projects-map.module.css';

/** A translated tag. */
export interface MapTagView {
  label: string;
  tone: TagTone;
}

export interface ProjectsMapPoint {
  code: string;
  /** Translated "#026 · name". */
  name: string;
  /** "code · PM · client". */
  sub: string;
  city: string;
  /** Translated country. */
  country: string;
  lat: number;
  lng: number;
  style: MarkerStyle;
  status: MapTagView;
  health: MapTagView | null;
  href: string;
}

/** Translated labels (`mapUi`) plus accessibility names. */
export interface ProjectsMapLabels {
  world: string;
  europe: string;
  fit: string;
  ontrack: string;
  risk: string;
  pipeline: string;
  closed: string;
  open: string;
  loading: string;
  failed: string;
  close: string;
  /** svg aria-label ("Projects map"). */
  map: string;
  legend: string;
  views: string;
}

export interface ProjectsMapHandle {
  /** Zoom on a project and its co-located projects (site header click); clears the active view button. */
  focus(code: string): void;
  view(v: MapView): void;
}

export interface ProjectsMapProps {
  points: ProjectsMapPoint[];
  labels: ProjectsMapLabels;
  /** Selected zone: its frame replaces the Europe view and becomes the home view. */
  zone: { label: string; bounds: GeoBounds } | null;
  /** Project highlighted from the host list (extra ring on its marker). */
  highlight?: string | null;
  ref?: Ref<ProjectsMapHandle>;
  className?: string;
}

type Placed = ProjectsMapPoint & { x: number; y: number };
type Land = FeatureCollection<Geometry>;
type GeoState = 'loading' | 'ready' | 'failed';
/** Hovered or pinned marker: its member codes (contents follow the current data, e.g. after a language switch). */
type Tip = { codes: string[]; pinned: boolean };

const SPHERE: GeoPermissibleObjects = { type: 'Sphere' };
const GRATICULE = geoGraticule10();
const tfString = (t: MapTransform) => `translate(${t.x},${t.y}) scale(${t.k})`;
const sameT = (a: MapTransform, b: MapTransform) => a.k === b.k && a.x === b.x && a.y === b.y;
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
type WithTransition = { transition(): { duration(ms: number): TransitionLike<SVGSVGElement, unknown> } };

/** Sphere outline, graticule and countries — memoised so zoom ticks do not re-render ~180 paths. */
const LandLayer = memo(function LandLayer({ path, land }: { path: (o: GeoPermissibleObjects) => string | null; land: Land | null }) {
  return (
    <g>
      <path className={s.sphere} d={path(SPHERE) ?? undefined} />
      <path className={s.graticule} d={path(GRATICULE) ?? undefined} />
      {land?.features.map((f: Feature<Geometry>, i) => <path key={`${f.id ?? ''}-${i}`} className={s.country} d={path(f) ?? undefined} />)}
    </g>
  );
});

export function ProjectsMap({ points, labels, zone, highlight = null, ref, className }: ProjectsMapProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [land, setLand] = useState<Land | null>(null);
  const [geo, setGeo] = useState<GeoState>('loading');
  const [tr, setTr] = useState<MapTransform>(IDENTITY);
  const [view, setView] = useState<MapView | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const { W, H } = size;

  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[SPHERE_INSET, SPHERE_INSET], [W - SPHERE_INSET, H - SPHERE_INSET]], SPHERE), [W, H]);
  const path = useMemo(() => {
    const p = geoPath(projection);
    return (o: GeoPermissibleObjects) => p(o);
  }, [projection]);
  const placed = useMemo<Placed[]>(
    () =>
      points
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => {
          const [x, y] = projection([p.lng, p.lat]) ?? [NaN, NaN];
          return { ...p, x, y };
        }),
    [points, projection],
  );
  const byCode = useMemo(() => new Map(placed.map((p) => [p.code, p])), [placed]);
  const clusters = useMemo(() => clusterPoints(placed, tr.k), [placed, tr.k]);
  const labelsOn = showMarkerLabels(tr.k, clusters.length);
  const project = useCallback((lngLat: [number, number]) => projection(lngLat), [projection]);
  const frame = useMemo(() => ({ W, H, project, zoneBounds: zone?.bounds ?? null, points: placed }), [W, H, project, zone, placed]);

  // ── zoom behaviour ──
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const svg = select(el);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .on('zoom', (ev: { transform: MapTransform }) => {
        const { k, x, y } = ev.transform;
        setTr((prev) => (sameT(prev, { k, x, y }) ? prev : { k, x, y }));
      });
    svg.call(z).on('dblclick.zoom', null);
    zoomRef.current = z;
    return () => {
      svg.on('.zoom', null);
      zoomRef.current = null;
    };
  }, []);

  /** Sets the zoom transform, animated over 650 ms unless the viewer prefers reduced motion. */
  const apply = useCallback((t: MapTransform, animate: boolean) => {
    const el = svgRef.current;
    const z = zoomRef.current;
    if (!el || !z) return;
    const target = zoomIdentity.translate(t.x, t.y).scale(t.k);
    const svg = select(el);
    if (animate && !prefersReducedMotion()) z.transform((svg as unknown as WithTransition).transition().duration(VIEW_MS), target);
    else z.transform(svg, target);
  }, []);

  const applyView = useCallback(
    (v: MapView, animate: boolean) => {
      setView(v);
      apply(viewTransform(v, frame), animate);
    },
    [apply, frame],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus(code: string) {
        const t = focusTransform(code, placed, W, H);
        if (!t) return;
        apply(t, true);
        setView(null);
      },
      view(v: MapView) {
        applyView(v, true);
      },
    }),
    [apply, applyView, placed, W, H],
  );

  // ── frame size (ResizeObserver) ──
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      // A hidden frame has no layout: keep the current size rather than the 800×500 fallback.
      if (!el.clientWidth && !el.clientHeight) return;
      const next = { W: el.clientWidth || DEFAULT_SIZE.W, H: el.clientHeight || DEFAULT_SIZE.H };
      setSize((prev) => (prev.W === next.W && prev.H === next.H ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the active view framed when the frame is resized (prototype `size()` → `applyView(view, false)`).
  const sizeKey = `${W}x${H}`;
  const lastSize = useRef(sizeKey);
  useEffect(() => {
    if (lastSize.current === sizeKey) return;
    lastSize.current = sizeKey;
    if (view) apply(viewTransform(view, frame), false);
  }, [sizeKey, frame, apply, view]);

  // ── geometry (self-hosted world-atlas, separate chunk) ──
  useEffect(() => {
    let live = true;
    import('world-atlas/countries-110m.json')
      .then((m) => {
        const topo = ((m as { default?: unknown }).default ?? m) as Topology<{ countries: GeometryCollection }>;
        const fc = feature(topo, topo.objects.countries) as Land;
        if (live) {
          setLand(fc);
          setGeo('ready');
        }
      })
      .catch(() => {
        if (live) setGeo('failed');
      });
    return () => {
      live = false;
    };
  }, []);

  // Home view once the geometry is in (or failed), then again — animated — whenever the points or the zone change
  // (zone switch; prototype `hashchange`). A language switch keeps the current view.
  const dataKey = useMemo(
    () => JSON.stringify([points.map((p) => [p.code, p.lat, p.lng, p.style]), zone?.bounds ?? null]),
    [points, zone],
  );
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (geo === 'loading' || shownKey.current === dataKey) return;
    const first = shownKey.current === null;
    shownKey.current = dataKey;
    setTip(null);
    applyView(homeView(!!zone, points), !first);
  }, [geo, dataKey, applyView, zone, points]);

  // ── tooltip ──
  const tipItems = useMemo(() => (tip ? tip.codes.map((c) => byCode.get(c)).filter((p): p is Placed => !!p) : []), [tip, byCode]);
  const tipVisible = tipItems.length > 0;
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tipVisible) return;
    const cx0 = tipItems.reduce((a, p) => a + p.x, 0) / tipItems.length;
    const cy0 = tipItems.reduce((a, p) => a + p.y, 0) / tipItems.length;
    const { x, y } = placeTooltip(tr.k * cx0 + tr.x, tr.k * cy0 + tr.y, el.offsetWidth, el.offsetHeight, W, H);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  /** Hides the tooltip; when focus was inside it (a pinned tooltip's links), focus moves to the map, not the page. */
  const closeTip = useCallback(() => {
    if (tipRef.current?.contains(document.activeElement)) svgRef.current?.focus({ preventScroll: true });
    setTip(null);
  }, []);
  // Esc dismisses the tooltip, hovered or pinned (content shown on hover must be dismissible, WCAG 1.4.13).
  useEffect(() => {
    if (!tipVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tipVisible, closeTip]);

  const header = useMemo(() => (tipVisible ? tooltipTitle(tipItems, t) : ''), [tipVisible, tipItems, t]);

  return (
    <div ref={wrapRef} className={cx(s.wrap, className)}>
      <svg
        ref={svgRef}
        className={s.svg}
        viewBox={`0 0 ${W} ${H}`}
        tabIndex={-1}
        role="img"
        aria-label={labels.map}
        onClick={() => setTip(null)}
      >
        <g transform={tfString(tr)}>
          <LandLayer path={path} land={land} />
          <g>
            {clusters.map((c) => {
              const key = clusterKey(c);
              const n = c.items.length;
              const hl = !!highlight && c.items.some((i) => i.code === highlight);
              const one = c.items[0];
              return (
                <g
                  key={key}
                  className={s.mk}
                  transform={`translate(${c.x},${c.y}) scale(${1 / tr.k})`}
                  onMouseEnter={() => setTip((cur) => (cur?.pinned ? cur : { codes: c.items.map((i) => i.code), pinned: false }))}
                  onMouseLeave={() => setTip((cur) => (cur?.pinned ? cur : null))}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = clusterClick(c, W, H);
                    if (r.kind === 'zoom') {
                      setTip(null);
                      apply(r.transform, true);
                    } else setTip({ codes: c.items.map((i) => i.code), pinned: true });
                  }}
                >
                  {n > 1 ? (
                    <>
                      <circle className={cx(s.dot, s.cluster)} r={11} />
                      <text className={s.count}>{n}</text>
                      {hl && <circle className={s.hl} r={15} />}
                      {labelsOn && (
                        <text className={s.label} x={15} y={4}>
                          {markerLabelText(c.items, t)}
                        </text>
                      )}
                    </>
                  ) : (
                    <>
                      <circle className={cx(s.dot, s[one.style])} r={one.style === 'closed' ? 4.5 : 6} />
                      {one.style === 'risk' && <circle className={s.riskRing} r={10} />}
                      {hl && <circle className={s.hl} r={14} />}
                      {labelsOn && (
                        <text className={s.label} x={12} y={4}>
                          {one.city}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className={s.ctl} role="group" aria-label={labels.views}>
        {MAP_VIEWS.map((v) => (
          <button key={v} type="button" className={cx(s.ctlBtn, view === v && s.on)} aria-pressed={view === v} onClick={() => applyView(v, true)}>
            {v === 'world' ? labels.world : v === 'europe' ? (zone?.label ?? labels.europe) : labels.fit}
          </button>
        ))}
      </div>

      <div className={s.legend} role="list" aria-label={labels.legend}>
        {(
          [
            [labels.ontrack, s.swOntrack],
            [labels.risk, s.swRisk],
            [labels.pipeline, s.swPipeline],
            [labels.closed, s.swClosed],
          ] as const
        ).map(([l, cls]) => (
          <span key={cls} role="listitem">
            <i className={cx(s.sw, cls)} aria-hidden />
            {l}
          </span>
        ))}
      </div>

      <div className={s.attr}>Natural Earth · world-atlas 2.0.2</div>

      {tipVisible && (
        <div ref={tipRef} className={cx('card', 'elev-md', s.tip)} role={tip?.pinned ? 'dialog' : 'tooltip'} aria-label={header}>
          <div className={s.hdr}>
            <span>{header}</span>
            {tip?.pinned && (
              <button type="button" className={s.close} aria-label={labels.close} onClick={closeTip}>
                ×
              </button>
            )}
          </div>
          {tipItems.map((p) => (
            <Link key={p.code} href={p.href} className={s.row}>
              <span>
                <span className={s.name}>{p.name}</span>
                <span className={s.sub}>{p.sub}</span>
              </span>
              <span className={s.tags}>
                <Tag tone={p.status.tone} size="micro">
                  {p.status.label}
                </Tag>
                {p.health && (
                  <Tag tone={p.health.tone} size="micro">
                    {p.health.label}
                  </Tag>
                )}
              </span>
            </Link>
          ))}
          <div className={s.open}>{labels.open} →</div>
        </div>
      )}

      {geo !== 'ready' && (
        <div className={s.msg} role="status">
          {geo === 'loading' ? labels.loading : labels.failed}
        </div>
      )}
    </div>
  );
}
