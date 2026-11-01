// Machine catalogue — /catalogue/machines (owner, 25 Oct 2026: « Si Keystone est propriétaire du catalogue machine alors il faut
// une section dans les catégories qui sert uniquement à manager le catalogue machine » — decision AC-4; R-186 built the catalogue
// inside the Machine types screen, it now has its own sidebar section and screen). Every catalogue entry across the machine
// types, filtered by type and status; the selected entry's versions with the actions; read-only, the rows published to the CAPEX
// application (pub_catalogue_machines) and the projects' equipment lines that chose a version.
// URL state: `?type=` machine type (stored or display code, any case; unknown → all), `?status=published|draft|retired`
// (unknown → all), `?entry=` catalogue code (unknown or filtered out → the first listed).
// Roles: director, PM, engineering lead, quality (the roles of Machine types); the director and the engineering lead edit
// (`canEditCatalogue`, choice 5 — checked again by the Server Functions and the DAL); the other roles open the screen read-only
// outside their workspace (banner); the client is sent home (R-042).
import { PageHeader } from '@/components/app/shell/page-header';
import { canEditCatalogue } from '@/domain/machine-catalogue';
import { MachineCatalogueBody } from '@/features/catalogue/catalogue-view';
import { NewCatalogueEntryButton } from '@/features/catalogue/entry-detail';
import { catalogueStatusOf } from '@/features/catalogue/links';
import { catalogueScreenView, newCatalogueEntryForm } from '@/features/catalogue/model';
import { listCatalogue, listCataloguePublication, listCatalogueUses } from '@/server/dal/machine-catalogue';
import { listMachineTypes } from '@/server/dal/mtypes';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MachineCataloguePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, rows, types, publication, uses] = await Promise.all([
    getI18n(), getScreenAccess('catalogue'), listCatalogue(), listMachineTypes(), listCataloguePublication(), listCatalogueUses(),
  ]);
  const canEdit = access.canEdit && canEditCatalogue(access.viewer.role);
  // `?type=` as the stored code or the display code ("rnd" / "R&D"), any case.
  const typed = (first(sp.type) ?? '').trim().slice(0, 40).toLowerCase();
  const type = typed ? types.find((m) => m.code.toLowerCase() === typed || m.displayCode.toLowerCase() === typed)?.code ?? null : null;
  const entry = (first(sp.entry) ?? '').trim().slice(0, 30).toUpperCase() || null;
  const view = catalogueScreenView({
    rows, types: types.map((m) => ({ code: m.code, label: m.displayCode })), publication, uses,
    state: { type, status: catalogueStatusOf(first(sp.status)), entry }, canEdit, readsOnly: access.canEdit && !canEdit,
  }, t, lang);
  const form = newCatalogueEntryForm(t, types.filter((m) => m.active).map((m) => ({ code: m.code, label: m.displayCode })), type);
  return (
    <>
      <PageHeader screen="catalogue" primary={canEdit ? <NewCatalogueEntryButton form={form} /> : undefined} />
      <MachineCatalogueBody view={view} t={t} />
    </>
  );
}
