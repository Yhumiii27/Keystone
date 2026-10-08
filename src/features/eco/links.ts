// URLs of the Change orders and Drawings screens and of the screens they open (docs/spec/00 §8.3: view state in search
// params). Keystone routes come from the screen registry; every Vigie URL comes from src/server/integrations/vigie/links.ts.
import { screenHref } from '@/config/screens';
import type { DrawingState, EcoStatus } from '@/server/db/codes';

const withQuery = (base: string, params: Record<string, string | null | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
};

/** `/reference/eco?status=in_approval&eco=ECO-2026-015`. */
export const ecoScreenHref = (s: { status?: EcoStatus | null; eco?: string | null } = {}) => withQuery(screenHref('eco'), { status: s.status, eco: s.eco });

/** `/reference/drawings?state=released&q=rmg&dwg=DWG-AS-9000`. */
export const drawingsHref = (s: { state?: DrawingState | null; q?: string | null; dwg?: string | null } = {}) =>
  withQuery(screenHref('drawings'), { state: s.state, q: s.q?.trim() || null, dwg: s.dwg });

/** Part record drawer on the PLM catalogue (portfolio-wide: the part may not be used by the current project, 09 OQ19). */
export const partRecordHref = (ref: string) => withQuery(screenHref('plm'), { part: ref });

/** BOM of a project (effectivity target "Projects & BOMs"). */
export const projectBomHref = (code: string) => screenHref('bom', { code });

/** Installed base (machine targets) and After-sales interventions ("Plan intervention"). */
export const fleetHref = () => screenHref('fleet');
export const interventionsHref = () => withQuery(screenHref('sav'), { view: 'interventions' });
