// Stock & storages — /purchasing/stock (docs/spec/08 §4, template 1658–1714, logic 4469–4492). Global screen (all stock
// lines); reservations, issues and returns use the current project (the last project used, the prototype's `PD.p3`).
// URL state (src/features/stock/links.ts): `?loc=` location chip, `?q=` search, `?stock=` stock-line drawer,
// `?part=` shared part record drawer. Roles: director, pm, quality, procurement; other roles see the screen outside
// their workspace (banner, read-only: no movement form, no "Push to X3", no primary). The project read-only mode
// does not apply (08 §0.2). Writes go through src/features/stock/actions.ts. Delivery 7: an issue names an activity of
// the current project's plan (SC-5a, R-098); reservations are protected ("Release reservation", director override, R-099).
import { PageHeader } from '@/components/app/shell/page-header';
import { DEFAULT_PROJECT } from '@/config/screens';
import { parseLocationFilter } from '@/domain/stock';
import { PartDrawer } from '@/features/plm/part-drawer';
import { ImportX3Button } from '@/features/stock/import-button';
import { stockHref, type StockUrlState } from '@/features/stock/links';
import { stockDrawerView, stockScreenView } from '@/features/stock/model';
import { StockDrawer } from '@/features/stock/stock-drawer';
import { StockBody } from '@/features/stock/stock-view';
import { installedBasePins } from '@/server/dal/eco';
import { getProject } from '@/server/dal/projects';
import { getStockPosition, getX3StockSync, listIssueActivityOptions, listStock, listStockMovements } from '@/server/dal/stock';
import { listStorageLocations } from '@/server/dal/suppliers';
import { getScreenAccess, isMineProject } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, rows, locations, sync, moves, pins, last] = await Promise.all([
    getI18n(), getScreenAccess('stock'), listStock(), listStorageLocations(), getX3StockSync(), listStockMovements({ limit: 8 }), installedBasePins(), getLastProject(),
  ]);
  const state: StockUrlState = {
    loc: parseLocationFilter(first(sp.loc), locations.map((l) => l.name)),
    q: (first(sp.q) ?? '').slice(0, 120),
    stock: first(sp.stock) || null,
    part: (first(sp.part) ?? '').slice(0, 60) || null,
  };
  const [detail, project] = await Promise.all([
    state.stock && rows.some((r) => r.id === state.stock) ? getStockPosition(state.stock) : Promise.resolve(null),
    getProject(last).then((p) => p ?? getProject(DEFAULT_PROJECT)),
  ]);

  const view = stockScreenView({ rows, locations, sync, moves, pins, state }, t, lang);
  // Delivery 7: an issue names an activity of the current project's plan (SC-5a); the reserving project's PM or the
  // director releases a reservation, the director alone may take another project's reserved units (R-099).
  const [acts, owner] = detail && project
    ? await Promise.all([listIssueActivityOptions(project.code), detail.reservedForProject ? getProject(detail.reservedForProject) : Promise.resolve(null)])
    : [[], null];
  const viewer = access.viewer;
  const drawer = detail
    ? stockDrawerView({
      detail, locations, pins, state, projectCode: project?.code ?? null, activities: acts,
      canRelease: access.canEdit && !!owner && (viewer.role === 'director' || (viewer.role === 'pm' && isMineProject(viewer, owner))),
      canOverride: access.canEdit && viewer.role === 'director',
    }, t, lang)
    : null;
  const closeHref = state.stock ? stockHref({ ...state, stock: null }) : null;

  return (
    <>
      <PageHeader screen="stock" primary={access.canEdit ? <ImportX3Button label={t('Import from X3')} closeHref={closeHref} /> : undefined} />
      <StockBody view={view} t={t} />
      <StockDrawer view={drawer} projectCode={project?.code ?? null} canEdit={access.canEdit} />
      {state.part && <PartDrawer partRef={state.part} closeHref={stockHref({ ...state, part: null })} />}
    </>
  );
}
