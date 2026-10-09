// Engineering synthesis — /projects/[code]/engineering (docs/spec/09 §7, template 2384–2416, logic 4783–4816).
// Cross-discipline register of the project during design: who consumes which revision of whose documents, the
// inconsistencies that block the gate "Plans & BOM frozen", the deliverables released and the lists generated.
// URL state: `?import=<discipline>&doc=<document>&tool=<n>` opens the import wizard. Primary action "Import a list"
// (the wizard as the prototype first sets it: Electrical, the instrument list, SeeElectrical) for viewers who may edit
// the project; projects without an engineering register show the empty state and no primary action.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/app/shell/page-header';
import { ButtonLink } from '@/components/ds/Button';
import { importTargetOf, primaryImportTarget } from '@/domain/engineering';
import { ImportWizard } from '@/features/eng/import-wizard';
import { importHref, synthesisHref } from '@/features/eng/links';
import { importWizardModel, synthesisScreenView } from '@/features/eng/model';
import { EngEmpty, SynthesisBody } from '@/features/eng/synthesis-view';
import { getEngScreen } from '@/server/dal/eng-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EngineeringSynthesisPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'eng');
  const projectCode = ctx.project.code;
  const [{ t, lang }, reg] = await Promise.all([getI18n(), getEngScreen(projectCode)]);
  const canEdit = ctx.canEdit('eng');

  const preset = reg && canEdit ? primaryImportTarget(reg, 'eng') : null;
  const primary = preset ? (
    <ButtonLink variant="primary" icon={Plus} href={importHref(projectCode, null, preset)} scroll={false}>
      {t('Import a list')}
    </ButtonLink>
  ) : undefined;
  const target = reg && canEdit ? importTargetOf(reg, first(sp.import), first(sp.doc), first(sp.tool)) : null;

  return (
    <>
      <PageHeader screen="eng" projectCode={projectCode} primary={primary} />
      {reg ? <SynthesisBody view={synthesisScreenView(reg, t, lang)} t={t} /> : <EngEmpty t={t} />}
      {reg && target && (
        <ImportWizard
          key={`${target.disc}|${target.doc}|${target.tool}`}
          code={projectCode}
          from="eng"
          target={target}
          model={importWizardModel(reg, target, t)}
          closeHref={synthesisHref(projectCode)}
        />
      )}
    </>
  );
}
