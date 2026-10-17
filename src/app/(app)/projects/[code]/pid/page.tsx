// P&ID — tags, overlay & process validation — /projects/[code]/pid (docs/spec/09 §6, template 2472–2534, logic 4762–4782).
// Keystone owns the tag list of the project's P&ID and its mapping to the project BOM: every tag in our scope (Keystone
// supply + overlay instruments on client equipment) must map to a validated BOM reference before release for
// construction. URL state (src/features/pid/links.ts): `?status=`, `?scope=`, `?q=`, `?tag=` (drawer, case-insensitive,
// unknown → none), `?part=` (the shared part record drawer, over the tag drawer's place).
// Primary action "Import P&ID tags" (AF `pid`, a staging import) for viewers who may edit the project's P&ID (director,
// engineering lead, quality; not on a read-only project); the tag drawer's mapping follows the same rule, server-side
// too (src/features/pid/actions.ts). Projects without a P&ID show the prototype's empty state. R-108: the tag drawer searches
// the whole catalogue (`?cq=`, `?ctype=`); R-109: a banner when Codex's P&ID revision is ahead of the tags'.
import { EmptyState } from '@/components/app/EmptyState';
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { yearOfIso } from '@/domain/clock';
import { bomPartHref } from '@/features/bom/links';
import { docHref } from '@/features/docs/links';
import { PartDrawer } from '@/features/plm/part-drawer';
import { parsePidState, pidHref } from '@/features/pid/links';
import { pidScreenView, pidTagDrawerView } from '@/features/pid/model';
import { ImportTagsButton } from '@/features/pid/pid-buttons';
import { PidBody } from '@/features/pid/pid-view';
import { PidTagDrawer } from '@/features/pid/tag-drawer';
import { businessToday } from '@/server/clock';
import { getPidValidation, pidCandidates } from '@/server/dal/pid';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;

export default async function PidPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'pid');
  const projectCode = ctx.project.code;
  const canEdit = ctx.canEdit('pid');
  const [{ t, lang }, data, today] = await Promise.all([getI18n(), getPidValidation(projectCode), businessToday()]);

  const parsed = parsePidState(sp);
  // `?tag=` as written anywhere (case-insensitive); an unknown tag opens nothing and is dropped from the links.
  const tag = parsed.tag && data ? (data.tags.find((x) => x.tag.toUpperCase() === parsed.tag!.toUpperCase()) ?? null) : null;
  const state = { ...parsed, tag: tag?.tag ?? null };
  // R-108 (E-6 = a): the whole catalogue, searched (`?cq=`, `?ctype=`), the project BOM's articles first.
  const candidates = tag && !state.part && canEdit && tag.scope !== 'client'
    ? await pidCandidates(projectCode, tag.tag, { q: state.cq, type: state.ctype, lang })
    : { rows: [], more: false };

  const view = data
    ? pidScreenView({ code: projectCode, data, state, docHref: data.sheet.codexRevision ? docHref(data.sheet.documentNumber, projectCode) : null, year: yearOfIso(today) }, t, lang)
    : null;
  // R-109: when Codex is ahead, both "Import P&ID tags" buttons suggest Codex's reference revision.
  const suggested = view?.drawing.gap?.ahead ? view.drawing.gap.suggestedRevision : null;
  const importButton = (variant: 'primary' | 'secondary') => (
    <ImportTagsButton code={projectCode} context={projectLabelText(ctx.project, lang)} currentRevision={data?.sheet.revision ?? null} suggestedRevision={suggested} variant={variant} />
  );
  const primary = canEdit ? importButton('primary') : undefined;
  const drawer =
    data && tag && !state.part
      ? pidTagDrawerView({ code: projectCode, data, tag, candidates: candidates.rows, more: candidates.more, state, bomHrefOf: (ref) => bomPartHref(projectCode, ref) }, t, lang)
      : null;

  return (
    <>
      <PageHeader screen="pid" projectCode={projectCode} primary={primary} />
      {view ? (
        <PidBody view={view} t={t} gapAction={canEdit ? importButton('secondary') : undefined} />
      ) : (
        <Stack>
          <EmptyState variant="boxed">{t('No P&ID registered for this project yet — import the tag list from the drawing to start the validation.')}</EmptyState>
        </Stack>
      )}
      {drawer && <PidTagDrawer key={drawer.tag} code={projectCode} view={drawer} canEdit={canEdit} canEditBom={ctx.canEdit('bom')} t={t} />}
      {state.part && <PartDrawer key={state.part} partRef={state.part} projectCode={projectCode} closeHref={pidHref(projectCode, { ...state, part: null })} />}
    </>
  );
}
