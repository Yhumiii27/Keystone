// Installed base — /after-sales/fleet (docs/spec/07 §2.8, template 948–955, logic 4979–4995). Portfolio-wide register of
// the machines in service, filtered by the zone bar (the shell's zone preference; a machine's zone is its site's city).
// The configuration column counts the engineering changes Vigie reports against each machine (Vigie owns the ECOs):
// the tags open the first one on the Change orders screen, the arrow opens it in Vigie (internal: not for the client).
// Primary action "Add machine" (AF `fleet`). Roles: director, pm, quality, procurement; others get the "Outside my
// workspace" banner (PageHeader) and no primary action (refused server-side too). R-153 (X-10): a machine of the
// installed base is not the current project's — the dialog has no project sub-line (the prototype's `projectName`).
// R-144 (E-8): the "Delivered projects" card — delivered projects whose bill of materials carries revisions — registers
// their machines with the as-built configuration ("Register machines"; a project manager for the projects they lead only).
import { PageHeader } from '@/components/app/shell/page-header';
import { AddMachineButton } from '@/features/aftersales/add-buttons';
import { DeliveredCard, deliveredView } from '@/features/aftersales/delivered';
import { FleetBody } from '@/features/aftersales/fleet-view';
import { localizeForm, machineFormDef } from '@/features/aftersales/forms';
import { fleetView } from '@/features/aftersales/model';
import { getFleetScreen, machineTypeOptions } from '@/server/dal/aftersales';
import { listDeliveryCandidates } from '@/server/dal/fleet';
import { listProjects } from '@/server/dal/projects';
import { getScreenAccess, projectAccessResolver } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';

export default async function InstalledBasePage() {
  const [{ t, lang }, access, zone] = await Promise.all([getI18n(), getScreenAccess('fleet'), getZone()]);
  const [data, candidates] = await Promise.all([getFleetScreen(zone), access.viewer.role === 'client' ? Promise.resolve([]) : listDeliveryCandidates()]);

  let primary;
  if (access.canEdit) {
    primary = <AddMachineButton label={t('Add machine')} form={localizeForm(machineFormDef(await machineTypeOptions()), t, lang)} />;
  }
  // A project manager registers the machines of the projects they lead (PM of record, co-PM or deputy, R-041).
  const leads = access.viewer.role === 'pm'
    ? await Promise.all([projectAccessResolver(access.viewer), listProjects()]).then(([of, all]) => new Set(all.filter((p) => of(p).lead).map((p) => p.code)))
    : null;
  const canRegister = (code: string) => access.canEdit && (!leads || leads.has(code));

  return (
    <>
      <PageHeader screen="fleet" primary={primary} />
      <FleetBody view={fleetView(data, zone, t, lang, { vigie: access.viewer.role !== 'client' })} t={t} />
      <DeliveredCard rows={deliveredView(candidates, { canRegister }, t, lang)} t={t} />
    </>
  );
}
