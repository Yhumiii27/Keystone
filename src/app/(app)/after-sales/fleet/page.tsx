// Installed base — /after-sales/fleet (docs/spec/07 §2.8, template 948–955, logic 4979–4995). Portfolio-wide register of
// the machines in service, filtered by the zone bar (the shell's zone preference; a machine's zone is its site's city).
// The configuration column counts the engineering changes Vigie reports against each machine (Vigie owns the ECOs):
// the tags open the first one on the Change orders screen, the arrow opens it in Vigie (internal: not for the client).
// Primary action "Add machine" (AF `fleet`). Roles: director, pm, quality, procurement; others get the "Outside my
// workspace" banner (PageHeader) and no primary action (refused server-side too). The dialog's sub-line names the
// current project, as every add-form of the prototype (`projectName`).
import { PageHeader } from '@/components/app/shell/page-header';
import { AddMachineButton } from '@/features/aftersales/add-buttons';
import { FleetBody } from '@/features/aftersales/fleet-view';
import { localizeForm, machineFormDef } from '@/features/aftersales/forms';
import { fleetView } from '@/features/aftersales/model';
import { getFleetScreen, machineTypeOptions } from '@/server/dal/aftersales';
import { getProject, projectLabel } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject, getZone } from '@/server/session';

export default async function InstalledBasePage() {
  const [{ t, lang }, access, zone] = await Promise.all([getI18n(), getScreenAccess('fleet'), getZone()]);
  const data = await getFleetScreen(zone);

  let primary;
  if (access.canEdit) {
    const [types, project] = await Promise.all([machineTypeOptions(), getLastProject().then(getProject)]);
    primary = <AddMachineButton label={t('Add machine')} form={localizeForm(machineFormDef(types), t, lang)} context={project ? t(projectLabel(project)) : undefined} />;
  }

  return (
    <>
      <PageHeader screen="fleet" primary={primary} />
      <FleetBody view={fleetView(data, zone, t, lang, { vigie: access.viewer.role !== 'client' })} t={t} />
    </>
  );
}
