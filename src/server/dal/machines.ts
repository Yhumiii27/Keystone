import 'server-only';
// Installed base as the technical reference reads it (part record "Installed base", 09 §2.2; ECO effectivity machines).
// Since Delivery 5 the machines and their as-maintained configuration are in the database (src/server/dal/fleet.ts,
// the Installed base screen's DAL, machines added in Keystone included); this module keeps the shapes the PLM part
// drawer and the ECO screen were built on. The state of each fitted part comes from the ECO effectivity Vigie reports.
import type { InstalledPartState, WarrantyStatus } from '@/server/db/codes';
import { listMachines, machinesFittedWith } from './fleet';

export interface MachineRow {
  /** "MCH-041". */
  id: string;
  machineType: string;
  name: string;
  client: string;
  location: string;
  /** Delivering project code; null = "—". */
  projectCode: string | null;
  /** Delivery date (start of the warranty), ISO. */
  warrantyStart: string | null;
  warrantyEnd: string | null;
  warrantyStatus: WarrantyStatus;
  /** EN text ("In warranty", "Extended → 4 Jun 2027"). */
  warrantyText: string;
  /** "Gen 1" / "Gen 2"; null without an as-maintained configuration. */
  generation: string | null;
}

/** Machines in service (FLEET order, machines added in Keystone after). */
export async function listInstalledBase(): Promise<MachineRow[]> {
  return (await listMachines()).map((m) => ({
    id: m.number, machineType: m.machineType, name: m.name, client: m.client, location: m.site, projectCode: m.projectCode, warrantyStart: m.deliveredOn,
    warrantyEnd: m.warrantyEndOn, warrantyStatus: m.warrantyStatus, warrantyText: m.warrantyText, generation: m.generation,
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
  return (await machinesFittedWith(ref)).map((m) => ({
    id: m.number, name: m.name, generation: m.generation ?? '', revision: m.revision, state: m.state, stateLabel: m.stateLabel, ecoNumber: m.ecoNumber,
  }));
}
