// PLM — parts catalogue — /reference/parts (docs/spec/09 §3, template 2535–2580, logic 4267–4292) with the shared part
// record drawer (§2, `?part=`). Portfolio-wide screen: no project picker, the project read-only mode does not apply.
// URL state (src/features/plm/links.ts): `?q=`, `?type=`, `?status=`, `?pu=`, `?mb=`, `?restr=1`, `?sort=` + `?dir=`,
// `?part=` (case-insensitive; an unknown reference opens nothing and is dropped from the screen's links). Roles:
// director, pm, englead, quality, procurement; other roles get the "Outside my workspace" banner, no "New part" and no
// "Register equivalent" (refused server-side too). Writes go through src/features/plm/actions.ts. The New part dialog's
// sub-line names the current project, as every add-form of the prototype (`projectName`, 09 §0.3).
import { PageHeader } from '@/components/app/shell/page-header';
import { parsePlmState } from '@/domain/parts';
import { PlmCatalogue } from '@/features/plm/catalogue';
import { localizePlmForm, newPartFormDef } from '@/features/plm/forms';
import { plmHref } from '@/features/plm/links';
import { catalogueView } from '@/features/plm/model';
import { PartDrawer } from '@/features/plm/part-drawer';
import { NewPartButton } from '@/features/plm/plm-buttons';
import { getPlmCatalogue } from '@/server/dal/plm';
import { getProject, projectLabel } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { canSeeSupplierPrices } from '@/domain/rights';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PartsCataloguePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const state = parsePlmState({
    q: first(sp.q), type: first(sp.type), status: first(sp.status), pu: first(sp.pu), mb: first(sp.mb), restr: first(sp.restr), sort: first(sp.sort), dir: first(sp.dir),
  });
  const asked = (first(sp.part) ?? '').trim().slice(0, 60);
  const [{ t, lang }, access, catalogue, lastProject] = await Promise.all([getI18n(), getScreenAccess('plm'), getPlmCatalogue(), getLastProject()]);
  // The catalogue's own spelling of the reference (`?part=el-vfd-200` opens EL-VFD-200).
  const part = asked ? (catalogue.parts.find((p) => p.ref === asked) ?? catalogue.parts.find((p) => p.ref.toUpperCase() === asked.toUpperCase()))?.ref ?? null : null;
  // R-046 (NEW-D2-1): catalogue prices only for the director, the PMs and procurement (a price sort is ignored otherwise).
  const prices = canSeeSupplierPrices(access.viewer.role);
  const view = catalogueView({ parts: catalogue.parts, openEco: catalogue.openEco, state: prices || state.sort.key !== 'price' ? state : { ...state, sort: { key: 'ref', dir: 1 } }, part, prices }, t, lang);

  const project = access.canEdit ? await getProject(lastProject) : null;
  const primary = access.canEdit ? (
    <NewPartButton label={t('New part')} form={localizePlmForm(newPartFormDef(), t, lang)} context={project ? t(projectLabel(project)) : undefined} />
  ) : undefined;

  return (
    <>
      <PageHeader screen="plm" primary={primary} />
      <PlmCatalogue view={view} />
      {part && <PartDrawer partRef={part} closeHref={plmHref(state)} />}
    </>
  );
}
