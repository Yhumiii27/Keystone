// Export providers — Warranty & after-sales (zone screens): Installed base and Warranty claims & interventions.
// Rows follow the zone bar; a client exports only the machines of its organisation and their claims. The claims export
// puts the screen's view first (`?view=claims|interventions|costs`); a claim's design ECO stays in Vigie (its number).
import { savViewOf } from '@/domain/aftersales';
import { getFleetScreen, getSavScreen } from '@/server/dal/aftersales';
import { claimCostsByMachine, type ClaimRow } from '@/server/dal/claims';
import type { MachineRow } from '@/server/dal/fleet';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook } from '../types';
import { col, compact, filterLine, param, sheet } from './common';
import { projectFilter } from './scope';

async function machineFilter(ctx: ExportContext): Promise<(m: Pick<MachineRow, 'projectCode' | 'client'>) => boolean> {
  if (ctx.viewer.role !== 'client') return () => true;
  const visible = await projectFilter(ctx);
  const org = ctx.viewer.organisation;
  return (m) => (!!org && m.client === org) || (!!m.projectCode && visible(m.projectCode));
}

const zoneLine = (ctx: ExportContext) => filterLine(ctx.t('Zone'), ctx.zone?.toUpperCase());

function machineSheet(ctx: ExportContext, machines: MachineRow[]): ExportSheet {
  const { t } = ctx;
  return sheet(t('Installed base'), [
    col('number', t('Machine'), 'text', 10), col('name', t('Name'), 'text', 30), col('type', t('Machine type'), 'text', 10), col('client', t('Client'), 'text', 20), col('site', t('Site'), 'text', 20),
    col('zone', t('Zone'), 'text', 6), col('project', t('Project'), 'text', 10), col('delivered', t('Delivered on'), 'date'), col('warrantyEnd', t('Warranty end'), 'date'),
    col('warranty', t('Warranty'), 'text', 22), col('generation', t('Generation'), 'text', 10), col('openClaims', t('Open claims'), 'integer'), col('cost', t('Warranty cost'), 'money_keur'),
    col('ecos', t('ECOs (Vigie)'), 'text', 24),
  ], machines.map((m) => ({
    number: m.number, name: t(m.name), type: m.machineTypeLabel, client: t(m.client), site: t(m.site), zone: m.zone.toUpperCase(), project: m.projectCode ?? '', delivered: m.deliveredOn,
    warrantyEnd: m.warrantyEndOn, warranty: t(m.warrantyText), generation: m.generation ?? '', openClaims: m.openClaims, cost: m.warrantyCostKeur, ecos: m.configuration.ecos.join(' · '),
  })));
}

async function fleetWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const [data, keep] = await Promise.all([getFleetScreen(ctx.zone), machineFilter(ctx)]);
  const machines = data.machines.filter(keep);
  return {
    title: ctx.t('Installed base'),
    filters: compact([zoneLine(ctx)]),
    sheets: [
      machineSheet(ctx, machines),
      sheet(ctx.t('Fitted parts'), [col('number', ctx.t('Machine'), 'text', 10), col('ref', ctx.t('Reference'), 'text', 18), col('revision', ctx.t('Revision'), 'text', 8)],
        machines.flatMap((m) => m.parts.map((p) => ({ number: m.number, ref: p.ref, revision: p.revision })))),
    ],
  };
}

async function savWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const view = savViewOf(param(ctx, 'view'));
  const [data, costs, keep] = await Promise.all([getSavScreen(ctx.zone), claimCostsByMachine({ zone: ctx.zone }), machineFilter(ctx)]);
  const machines = new Set(data.machines.filter(keep).map((m) => m.number));
  const claims = data.claims.filter((c: ClaimRow) => machines.has(c.machineNumber));
  const claimsSheet = sheet(t('Claims'), [
    col('number', t('Claim'), 'text', 9), col('machine', t('Machine'), 'text', 28), col('client', t('Client'), 'text', 20), col('issue', t('Issue'), 'text', 40), col('severity', t('Severity'), 'text', 10),
    col('reported', t('Reported on'), 'date'), col('status', t('Status'), 'text', 14), col('coverage', t('Coverage'), 'text', 14), col('cost', t('Cost'), 'money_keur'),
    col('eco', 'ECO (Vigie)', 'text', 14), col('owner', t('Owner'), 'text', 16), col('next', t('Next step'), 'text', 30),
  ], claims.map((c) => ({
    number: c.number, machine: `${c.machineNumber} · ${t(c.machineName)}`, client: t(c.client), issue: t(c.issue), severity: t(c.severityLabel), reported: c.reportedOn, status: t(c.statusLabel),
    coverage: t(c.coverageLabel), cost: c.costKeur, eco: c.ecoNumber ?? '', owner: c.owner, next: t(c.nextStep),
  })));
  const interventions = sheet(t('Interventions'), [
    col('number', t('Intervention'), 'text', 10), col('machine', t('Machine'), 'text', 28), col('site', t('Site'), 'text', 20), col('scheduled', t('Scheduled on'), 'date'), col('technicians', t('Technicians'), 'text', 24),
    col('type', t('Type'), 'text', 30), col('days', t('Duration (days)'), 'number', 8, { decimals: 1 }), col('status', t('Status'), 'text', 14),
  ], data.interventions.filter((i) => machines.has(i.machineNumber)).map((i) => ({
    number: i.number, machine: `${i.machineNumber} · ${t(i.machineName)}`, site: t(i.site), scheduled: i.scheduledOn, technicians: i.technicians, type: t(i.typeText), days: i.durationDays, status: t(i.statusLabel),
  })));
  const costSheet = sheet(t('Costs per machine'), [
    col('machine', t('Machine'), 'text', 28), col('client', t('Client'), 'text', 20), col('claims', t('Claims'), 'integer'), col('warranty', t('Under warranty'), 'money_keur'), col('chargeable', t('Chargeable'), 'money_keur'),
  ], costs.filter((c) => machines.has(c.machine.number)).map((c) => ({ machine: `${c.machine.number} · ${t(c.machine.name)}`, client: t(c.machine.client), claims: c.claims, warranty: c.warrantyKeur, chargeable: c.chargeableKeur })));
  const first = view === 'interventions' ? interventions : view === 'costs' ? costSheet : claimsSheet;
  return {
    title: t('Warranty claims & interventions'),
    filters: compact([zoneLine(ctx)]),
    sheets: [first, ...[claimsSheet, interventions, costSheet].filter((s) => s !== first)],
  };
}

registerExportProvider({ screen: 'fleet', table: fleetWorkbook, fileBase: () => 'installed-base' });
registerExportProvider({ screen: 'sav', table: savWorkbook, fileBase: () => 'warranty-claims' });
