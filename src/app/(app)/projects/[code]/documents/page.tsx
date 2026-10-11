// Documents — Codex index — /projects/[code]/documents (docs/spec/10 §4, template 2310–2374, logic 5019–5062).
// URL state (docs/spec/00 §8.3, src/features/docs/links.ts): `?scope=all`, `?view=`, `?fam=`, `?status=`, `?q=`,
// `?doc=` (document record drawer, any record), `?deposit=new|<number>` (+ `dtype`, `po`, `part`: "Deposit in Codex"
// hand-off, from the primary button, the drawer's "New revision · Codex" or another screen's context).
// Every role has the screen (never outside the workspace). NEW-D3-1 (R-047): "Deposit in Codex" and "New revision · Codex" are
// the project's internal team's (and the director's), "Sync now" the director's. P-10a / P-10b (R-042, R-043): the client sees
// the documents shared with them on their organisation's projects only. Writes go through src/features/docs/actions.ts.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/app/shell/page-header';
import { ButtonLink } from '@/components/ds/Button';
import { parseFamily, parseScope, parseStatus, parseView } from '@/domain/documents';
import { DepositWizard } from '@/features/docs/deposit-wizard';
import { DocumentDrawer } from '@/features/docs/document-drawer';
import { openingCodexProjectText } from '@/features/docs/i18n';
import { depositHref } from '@/features/docs/links';
import { depositView, drawerView, keepQuery, vaultView, type DocsState } from '@/features/docs/model';
import { DocsVault } from '@/features/docs/vault';
import { DEPOSIT_TYPES } from '@/server/db/codes';
import { getCodexSyncState, getDocumentRecord, listDocumentTypes, listVaultDocuments } from '@/server/dal/documents';
import { canDepositInCodex, canSyncCodex } from '@/domain/rights';
import { clientProjectCodes, getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'docs');
  const project = ctx.project.code;
  const canEdit = canDepositInCodex(ctx.viewer.role, ctx.outside, ctx.access);
  const canSync = canSyncCodex(ctx.viewer.role, ctx.outside);
  const state: DocsState = {
    scope: parseScope(first(sp.scope)),
    view: parseView(first(sp.view)),
    family: parseFamily(first(sp.fam)),
    status: parseStatus(first(sp.status)),
    q: (first(sp.q) ?? '').slice(0, 120),
    doc: first(sp.doc) || null,
  };
  const deposit = canEdit ? first(sp.deposit) || null : null;

  const [{ t, lang }, allDocs, sync, found, types, ownCodes] = await Promise.all([
    getI18n(),
    listVaultDocuments(),
    getCodexSyncState(),
    state.doc ? getDocumentRecord(state.doc) : Promise.resolve(null),
    deposit ? listDocumentTypes() : Promise.resolve(null),
    ctx.viewer.role === 'client' ? clientProjectCodes(ctx.viewer) : Promise.resolve(null),
  ]);
  // The client: shared documents of their organisation's projects only (and no drawer on any other record).
  const docs = ownCodes ? allDocs.filter((d) => d.shared && ownCodes.has(d.project)) : allDocs;
  const record = found && (!ownCodes || docs.some((d) => d.number === found.number)) ? found : null;

  const view = vaultView({ project, docs, sync, state }, t, lang);
  const drawer = record ? drawerView({ project, record, state, viewer: ctx.viewer, canEdit }, t, lang) : null;
  const dep =
    deposit && types
      ? depositView(
          {
            project, docs, types, depositTypes: DEPOSIT_TYPES, state, deposit,
            context: { type: first(sp.dtype) || null, po: first(sp.po) || null, part: first(sp.part) || null },
          },
          t,
          lang,
        )
      : null;

  const primary = canEdit ? (
    <ButtonLink variant="primary" icon={Plus} href={depositHref(project, {}, keepQuery(state))} scroll={false}>
      {t('Deposit in Codex')}
    </ButtonLink>
  ) : undefined;

  return (
    <>
      <PageHeader screen="docs" projectCode={project} primary={primary} />
      <DocsVault project={project} view={view} canEdit={canSync} openToast={openingCodexProjectText(project, lang)} t={t} />
      {drawer && <DocumentDrawer key={drawer.number} project={project} view={drawer} t={t} />}
      {dep && <DepositWizard key={deposit} view={dep} />}
    </>
  );
}
