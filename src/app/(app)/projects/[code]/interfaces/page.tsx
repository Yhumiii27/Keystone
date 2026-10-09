// Interface register — /projects/[code]/interfaces (docs/spec/07 §2.5, template 893–899, logic 4952–4957).
// Data owed by the client or third parties against the date Keystone needs it: an open interface past its need date
// is Late (sidebar badge = Late count). Primary action "New interface" (AF `interfaces`); row actions "Mark received"
// and "Freeze". Both are hidden when the screen is outside the viewer's workspace or the project is read-only for them,
// and refused server-side. Projects without interfaces show the empty register.
import { PageHeader } from '@/components/app/shell/page-header';
import { NewInterfaceButton } from '@/features/team/add-buttons';
import { interfaceFormDef, localizeForm } from '@/features/team/forms';
import { formT } from '@/features/team/i18n';
import { InterfacesBody } from '@/features/team/interfaces-view';
import { interfacesView } from '@/features/team/model';
import { projectDataDateOf } from '@/server/dal/kpis';
import { projectLabel } from '@/server/dal/projects';
import { getInterfacesScreen } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function InterfacesPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'interfaces');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, dataDate] = await Promise.all([getI18n(), getInterfacesScreen(projectCode), projectDataDateOf(projectCode)]);
  const canEdit = ctx.canEdit('interfaces');

  const primary =
    canEdit && data ? (
      <NewInterfaceButton code={projectCode} context={t(projectLabel(ctx.project))} form={localizeForm(interfaceFormDef(data.team), formT(t, lang))} />
    ) : undefined;

  return (
    <>
      <PageHeader screen="interfaces" projectCode={projectCode} primary={primary} />
      {data && <InterfacesBody code={projectCode} view={interfacesView(data.interfaces, data.blockers, t, lang, dataDate)} canEdit={canEdit} t={t} />}
    </>
  );
}
