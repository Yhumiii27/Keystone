// Drawings — PDM vault — /reference/drawings (docs/spec/09 §5, template 1377–1419, logic 4371–4380).
// Read-only mirror of the SolidWorks PDM vault: drawings linked to catalogue parts with revision, state, last check-in
// and the Vigie ECO that drives them. URL state: `?state=released|wip|under_review|obsolete` (unknown → All), `?q=`
// (search), `?dwg=<number>` (drawer; case-insensitive, unknown → none). Primary "Sync vault" (AF `drawings`) records a PDM sync (simulated connector).
// Roles: director, pm, englead, quality; others get the "Outside my workspace" banner and no primary action (the
// Server Function refuses them too). R-153 (X-10): the dialog has no project sub-line; the project a "Current project"
// run is attached to (the last project visited) is named in that option instead.
import { PageHeader } from '@/components/app/shell/page-header';
import type { FormDef } from '@/components/app/form-def';
import { drawingFilterOf } from '@/domain/drawings';
import { DrawingDrawer } from '@/features/eco/drawings/drawing-drawer';
import { DrawingsRegister } from '@/features/eco/drawings/drawings-view';
import { drawingDrawerView, drawingsView, type DrawingsState } from '@/features/eco/drawings/model';
import { SyncVaultButton } from '@/features/eco/drawings/sync-vault-button';
import type { T } from '@/i18n/translate';
import { vaultSyncScope, vaultSyncSource } from '@/server/db/codes';
import { getDrawingsScreen } from '@/server/dal/eco-screen';
import { getProject } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * AF.drawings ("Sync vault", kind run, submit "Synchronise"): Source and Scope, codes as values. `project`: the current
 * project's label ("#026 · Harbor Line Terminal Expansion", typed text through projectLabelText), named in the "Current
 * project" option (R-153, X-10).
 */
const syncVaultForm = (t: T, project: string | null): FormDef => ({
  title: t('Sync vault'),
  submit: t('Synchronise'),
  kind: 'run',
  fields: [
    { id: 'source', label: t('Source'), type: 'select', options: vaultSyncSource.codes.map((c) => ({ value: c, label: t(vaultSyncSource.label(c)) })) },
    {
      id: 'scope',
      label: t('Scope'),
      type: 'select',
      options: vaultSyncScope.codes.map((c) => ({ value: c, label: c === 'current_project' && project ? `${t(vaultSyncScope.label(c))} · ${project}` : t(vaultSyncScope.label(c)) })),
    },
  ],
});

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, data, lastProject] = await Promise.all([getI18n(), getScreenAccess('drawings'), getDrawingsScreen(first(sp.dwg)?.trim().slice(0, 60) || null), getLastProject()]);
  // `?dwg=` as the vault writes the number (case-insensitive deep link); an unknown drawing opens nothing.
  const state: DrawingsState = { state: drawingFilterOf(first(sp.state)), q: (first(sp.q) ?? '').slice(0, 120), dwg: data.selected };
  const project = access.canEdit ? await getProject(lastProject) : null;
  const view = drawingsView({ drawings: data.drawings, sync: data.sync, state }, t, lang);
  const drawer = data.detail ? drawingDrawerView({ drawing: data.detail, state }, t, lang) : null;

  return (
    <>
      <PageHeader
        screen="drawings"
        primary={access.canEdit ? <SyncVaultButton label={t('Sync vault')} form={syncVaultForm(t, project ? projectLabelText(project, lang) : null)} /> : undefined}
      />
      <DrawingsRegister view={view} t={t} />
      {drawer && <DrawingDrawer view={drawer} t={t} />}
    </>
  );
}
