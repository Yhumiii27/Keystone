// Engineering discipline screens — /projects/[code]/engineering/{process|mechanical|electrical|automation}
// (docs/spec/09 §8, one shared template 2418–2451 + import wizard 2452–2471, logic 4783–4816). Workspace of one
// discipline referent: confirm the documents received, take own deliverables to the BPE release (the PM validates),
// generate the lists for the next service, resolve the inconsistencies found at each import.
// URL state: `?status=open|sent_back|resolved` (consistency-check chip; unknown → All), `?import=<discipline>&doc=
// <document>&tool=<n>` opens the import wizard. Primary action "Import a list" with the discipline's preset; edit
// controls for viewers who may edit the project; "Validate release (PM)" for the project's PM or the director.
// Projects without an engineering register show the empty state. Unknown discipline segment → 404.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/shell/page-header';
import { ButtonLink } from '@/components/ds/Button';
import {
  SCREEN_OF_DISCIPLINE, canValidateRelease, checkFilterOf, disciplineOfSegment, importTargetOf, primaryImportTarget,
} from '@/domain/engineering';
import { DisciplineBody } from '@/features/eng/discipline-view';
import { ImportWizard } from '@/features/eng/import-wizard';
import { disciplineHref, importHref } from '@/features/eng/links';
import { disciplineScreenView, importWizardModel } from '@/features/eng/model';
import { EngEmpty } from '@/features/eng/synthesis-view';
import { parisParts } from '@/server/db/codes';
import { getEngScreen } from '@/server/dal/eng-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const parisDay = (iso: string) => parisParts(new Date(iso)).iso;

export default async function EngineeringDisciplinePage({ params, searchParams }: { params: Promise<{ code: string; discipline: string }>; searchParams: Promise<SP> }) {
  const [{ code, discipline }, sp] = await Promise.all([params, searchParams]);
  const disc = disciplineOfSegment(discipline);
  if (!disc) notFound();
  const screen = SCREEN_OF_DISCIPLINE[disc];
  const ctx = await getProjectContext(code, screen);
  const projectCode = ctx.project.code;
  const [{ t, lang }, reg] = await Promise.all([getI18n(), getEngScreen(projectCode)]);
  const canEdit = ctx.canEdit(screen);
  const filter = checkFilterOf(first(sp.status));

  const preset = reg && canEdit ? primaryImportTarget(reg, screen) : null;
  const primary = preset ? (
    <ButtonLink variant="primary" icon={Plus} href={importHref(projectCode, disc, preset, filter)} scroll={false}>
      {t('Import a list')}
    </ButtonLink>
  ) : undefined;
  const target = reg && canEdit ? importTargetOf(reg, first(sp.import), first(sp.doc), first(sp.tool)) : null;
  const view = reg
    ? disciplineScreenView(
        reg,
        disc,
        { filter, rights: { canEdit, canValidate: canValidateRelease(ctx.viewer, ctx.isMine) }, todayIso: parisParts(new Date()).iso, parisDay },
        t,
        lang,
      )
    : null;

  return (
    <>
      <PageHeader screen={screen} projectCode={projectCode} primary={primary} />
      {view ? <DisciplineBody code={projectCode} view={view} t={t} /> : <EngEmpty t={t} />}
      {reg && target && (
        <ImportWizard
          key={`${target.disc}|${target.doc}|${target.tool}`}
          code={projectCode}
          from={disc}
          target={target}
          model={importWizardModel(reg, target, t)}
          closeHref={disciplineHref(projectCode, disc, { status: filter })}
        />
      )}
    </>
  );
}
