// Installed base and after-sales seed (docs/spec/11 §8.4): machines (FLEET 3729, 8) with their as-maintained
// configuration (AS_MAINT 3722, 6 machines), warranty claims (CLAIMS 3730, 8) and interventions (INTERVENTIONS 3731,
// 6; the type text "Corrective · WC-014" split into type and claim). See schema/aftersales.ts.
import { PROTO } from '@/server/prototype';
import { claimCoverage, claimStatus, interventionStatus, interventionType, isoOfDemoDate, machineType, ncrSeverity, warrantyStatus, type WarrantyStatus } from '../codes';
import { asc } from 'drizzle-orm';
import { clients, interventions, machinePartRevisions, machines, projectEquipments, warrantyClaims } from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';

type FleetRow = [string, string, string, string, string, string, string, string, string];
type ClaimRow = [string, string, string, string, string, string, string, number, string, string, string];
type InterventionRow = [string, string, string, string, string, string, string];

/** "Extended → 4 Jun 2027" → extended until 2027-06-04; "In warranty" / "Out of warranty". */
export function warrantyOf(text: string): { status: WarrantyStatus; extendedUntil: string | null } {
  const m = /^Extended → (.+)$/.exec(text);
  return m ? { status: 'extended', extendedUntil: isoOfDemoDate(m[1]) } : { status: warrantyStatus.code(text), extendedUntil: null };
}

/** "Corrective · WC-012 (chargeable)" → corrective, WC-012, "(chargeable)"; "Preventive · annual check" → preventive, "annual check". */
export function interventionTypeOf(text: string): { type: ReturnType<typeof interventionType.code>; claim: string | null; detail: string | null } {
  const [head, ...rest] = text.split(' · ');
  const tail = rest.join(' · ').trim();
  const m = /^(WC-\d+)\s*(.*)$/.exec(tail);
  return { type: interventionType.code(head), claim: m ? m[1] : null, detail: m ? m[2] || null : tail || null };
}

/** "0.5 day" → 0.5; "2 days" → 2. */
export const durationDaysOf = (text: string) => parseFloat(text);

export async function seedAftersales(tx: Tx, ctx: SeedCtx): Promise<void> {
  const clientIds = new Map((await tx.select({ id: clients.id, name: clients.name }).from(clients)).map((c) => [c.name, c.id]));
  const am = PROTO.AS_MAINT as Record<string, { gen: string; parts: Record<string, string> }>;
  const fleet = PROTO.FLEET as FleetRow[];
  const machineIds = new Map<string, string>();
  // R-185 part 2: a machine delivered by a project belongs to the project's line of its type (the first one), else its main line
  // — the rule of the migration equipment_links_backfill.
  const lines = await tx.select({ id: projectEquipments.id, projectId: projectEquipments.projectId, mt: projectEquipments.machineTypeCode }).from(projectEquipments)
    .orderBy(asc(projectEquipments.position), asc(projectEquipments.ref));
  const lineOf = (projectId: string | null, mt: string) => {
    const own = lines.filter((l) => l.projectId === projectId);
    return (own.find((l) => l.mt === mt) ?? own[0])?.id ?? null;
  };
  await tx.insert(machines).values(fleet.map(([number, type, name, client, site, project, delivered, wend, status], position) => {
    const id = newId();
    machineIds.set(number, id);
    const w = warrantyOf(status);
    const code = project && project !== '—' ? project : null;
    const projectId = code ? ctx.projectByCode.get(code) ?? null : null;
    return {
      id, number, machineTypeCode: machineType.code(type), name, clientName: client, clientId: clientIds.get(client) ?? null, siteText: site, projectCode: code,
      projectId, equipmentId: projectId ? lineOf(projectId, machineType.code(type)) : null, deliveredOn: isoOfDemoDate(delivered), warrantyEndOn: isoOfDemoDate(wend),
      warrantyStatus: w.status, extendedUntil: w.extendedUntil, generation: am[number]?.gen ?? null, position,
    };
  }));
  const revs = Object.entries(am).flatMap(([number, c]) =>
    Object.entries(c.parts).map(([partRef, revision], position) => ({ machineId: must(machineIds, number, 'machine'), partRef, revision, position })),
  );
  if (revs.length) await tx.insert(machinePartRevisions).values(revs);

  const claimIds = new Map<string, string>();
  await tx.insert(warrantyClaims).values((PROTO.CLAIMS as ClaimRow[]).map(([number, mch, issue, sev, date, status, cover, cost, eco, owner, next], position) => {
    const id = newId();
    claimIds.set(number, id);
    return {
      id, number, machineId: must(machineIds, mch, 'machine'), issue, severity: ncrSeverity.code(sev), reportedOn: isoOfDemoDate(date)!, status: claimStatus.code(status),
      coverage: claimCoverage.code(cover), costKeur: cost, ecoNumber: eco || null, ownerName: owner, ownerPersonId: personIdOrNull(ctx, owner), nextStep: next, position,
    };
  }));
  await tx.insert(interventions).values((PROTO.INTERVENTIONS as InterventionRow[]).map(([number, mch, date, tech, type, dur, status], position) => {
    const t = interventionTypeOf(type);
    return {
      number, machineId: must(machineIds, mch, 'machine'), claimId: t.claim ? claimIds.get(t.claim) ?? null : null, type: t.type, typeDetail: t.detail,
      scheduledOn: isoOfDemoDate(date)!, technicians: tech, durationDays: durationDaysOf(dur), status: interventionStatus.code(status), position,
    };
  }));
}
