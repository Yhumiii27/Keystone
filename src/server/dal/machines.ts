import 'server-only';
// Installed base DAL — the machines in service and their as-maintained configuration, as far as the technical
// reference needs them (part record "Installed base", 09 §2.2). TODO(db): machines are not modelled before phase 8
// (fleet, after-sales): FLEET and AS_MAINT are read from the prototype data set. The state of each fitted part comes
// from the ECO effectivity Vigie reports (eco.ts, Vigie mirror).
import { warrantyStatus, installedPartState, isoOfDisplayDate, type InstalledPartState, type WarrantyStatus } from '@/server/db/codes';
import { PROTO } from '@/server/prototype';
import { listEcos } from './eco';

type FleetRow = [string, string, string, string, string, string, string, string, string];

export interface MachineRow {
  /** "MCH-041". */
  id: string;
  machineType: string;
  name: string;
  client: string;
  location: string;
  /** Delivering project code; null = "—". */
  projectCode: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  warrantyStatus: WarrantyStatus;
  /** EN text as recorded ("Extended → 4 Jun 2027"). */
  warrantyText: string;
  /** "Gen 1" / "Gen 2"; null without an as-maintained configuration. */
  generation: string | null;
}

const statusOf = (text: string): WarrantyStatus => (text.startsWith('Extended') ? 'extended' : warrantyStatus.code(text));

/** Machines in service (FLEET order). */
export async function listInstalledBase(): Promise<MachineRow[]> {
  const am = PROTO.AS_MAINT as Record<string, { gen: string }>;
  return (PROTO.FLEET as FleetRow[]).map(([id, machineType, name, client, location, project, start, end, warranty]) => ({
    id, machineType, name, client, location, projectCode: project && project !== '—' ? project : null, warrantyStart: isoOfDisplayDate(start), warrantyEnd: isoOfDisplayDate(end),
    warrantyStatus: statusOf(warranty), warrantyText: warranty, generation: am[id]?.gen ?? null,
  }));
}

export interface FittedMachine {
  id: string;
  name: string;
  generation: string;
  /** Revision of the part fitted ("rev C"). */
  revision: string;
  state: InstalledPartState;
  stateLabel: string;
  /** ECO that drives the state; null when Latest without a pending change. */
  ecoNumber: string | null;
}

/**
 * Machines carrying a part (`fleetUse` 4302) with the state of that part: Pinned / Retrofit pending / Decision pending /
 * Update planned / Latest, from the non-rejected Vigie ECOs that list the part (first Pinned wins).
 */
export async function machinesCarryingPart(ref: string): Promise<FittedMachine[]> {
  const am = PROTO.AS_MAINT as Record<string, { gen: string; parts: Record<string, string> }>;
  const ecos = (await listEcos({ partRefs: [ref] })).filter((e) => e.status !== 'rejected');
  return (PROTO.FLEET as FleetRow[])
    .filter((m) => am[m[0]]?.parts[ref] !== undefined)
    .map((m) => {
      let state: InstalledPartState = 'latest';
      let eco: string | null = null;
      for (const e of ecos) {
        const t = e.effectivity.find((x) => x.targetType === 'machine' && x.targetRef === m[0]);
        if (!t || state === 'pinned') continue;
        if (t.disposition === 'pinned') { state = 'pinned'; eco = e.number; }
        else if (t.disposition === 'retrofit') { state = 'retrofit_pending'; eco = e.number; }
        else if (!t.disposition && e.status !== 'released') { state = 'decision_pending'; eco = e.number; }
        else if (t.disposition === 'update' && e.status !== 'released' && state === 'latest') { state = 'update_planned'; eco = e.number; }
      }
      return { id: m[0], name: m[2], generation: am[m[0]].gen, revision: am[m[0]].parts[ref], state, stateLabel: installedPartState.label(state), ecoNumber: eco };
    });
}
