import 'server-only';
// Engineering change orders and Drawings — PDM vault screen data (docs/spec/09 §4–5) on top of the Delivery 4 DAL:
// the ECOs come from Vigie through the connector (eco.ts — Vigie owns them; Keystone shows them, links to them and
// records the viewer's progress), the drawings from the PDM vault mirror (drawings.ts). One read per page, plus the
// lookups the ECO drawer needs (part names and statuses, project stage and PM, machines of the installed base) and
// the sidebar badge.
import { ecoBadge } from '@/domain/eco';
import type { ApproverIdentity } from './myapprovals-identity';
import { getDrawing, getVaultSyncState, listDrawings, type DrawingDetail, type DrawingRow, type VaultSyncState } from './drawings';
import { ecoApprovalQueue, getEco, listEcos, type EcoDetail, type EcoView } from './eco';
import { listInstalledBase, type MachineRow } from './machines';
import { getPartsByRef, type PartRow } from './parts';
import { listProjects, type ProjectRow } from './projects';

export interface EcoScreenData {
  ecos: EcoView[];
  /** ECOs in approval whose key of the viewer is still pending (for a PM: on the projects they manage). */
  awaitingMine: number;
  /** The ECO opened with `?eco=` (null when none or unknown). */
  detail: EcoDrawerData | null;
  /** Its number as Vigie writes it (`?eco=eco-2026-015` opens ECO-2026-015); null when none or unknown. */
  selected: string | null;
}

/** A deep-link id (`?eco=`, `?dwg=`) matched exactly, else ignoring case (as the other screens' `?cr=`, `?po=`). */
export function resolveId(ids: string[], requested: string | null): string | null {
  const r = requested?.trim();
  if (!r) return null;
  return ids.find((id) => id === r) ?? ids.find((id) => id.toUpperCase() === r.toUpperCase()) ?? null;
}

export interface EcoDrawerData {
  eco: EcoDetail;
  /** Catalogue rows of the ECO parts (unknown refs absent). */
  parts: Pick<PartRow, 'ref' | 'name' | 'status' | 'statusLabel'>[];
  /** Projects of the effectivity targets, by code. */
  projects: Record<string, Pick<ProjectRow, 'code' | 'name' | 'status' | 'stage' | 'pm'>>;
  /** Machines of the effectivity targets, by id (the installed base, src/server/dal/machines.ts). */
  machines: Record<string, Pick<MachineRow, 'id' | 'name' | 'client' | 'generation' | 'warrantyStart' | 'warrantyText'>>;
}

/** The ECO drawer's data (null for an unknown ECO). */
export async function getEcoDrawer(number: string): Promise<EcoDrawerData | null> {
  const eco = await getEco(number);
  if (!eco) return null;
  const [parts, projects, machines] = await Promise.all([getPartsByRef(eco.parts), listProjects(), listInstalledBase()]);
  const codes = new Set(eco.effectivity.filter((t) => t.targetType === 'project').map((t) => t.targetRef));
  const ids = new Set(eco.effectivity.filter((t) => t.targetType === 'machine').map((t) => t.targetRef));
  const byRef = new Map(parts.map((p) => [p.ref, p]));
  return {
    eco,
    parts: eco.parts.flatMap((r) => {
      const p = byRef.get(r);
      return p ? [{ ref: p.ref, name: p.name, status: p.status, statusLabel: p.statusLabel }] : [];
    }),
    projects: Object.fromEntries(projects.filter((p) => codes.has(p.code)).map((p) => [p.code, { code: p.code, name: p.name, status: p.status, stage: p.stage, pm: p.pm }])),
    machines: Object.fromEntries(
      machines.filter((m) => ids.has(m.id)).map((m) => [m.id, { id: m.id, name: m.name, client: m.client, generation: m.generation, warrantyStart: m.warrantyStart, warrantyText: m.warrantyText }]),
    ),
  };
}

/** The Change orders page: every ECO Vigie reports for Keystone, the viewer's queue size and the opened ECO. */
export async function getEcoScreen(viewer: Pick<ApproverIdentity, 'name' | 'role'>, requested: string | null): Promise<EcoScreenData> {
  const [ecos, queue] = await Promise.all([listEcos(), ecoApprovalQueue({ name: viewer.name, role: viewer.role })]);
  const selected = resolveId(ecos.map((e) => e.number), requested);
  const detail = selected ? await getEcoDrawer(selected) : null;
  return { ecos, awaitingMine: queue.length, detail, selected: detail ? selected : null };
}

/** Sidebar badge of Change orders: ECOs in approval in Vigie ('' when none). */
export async function ecoNavBadge(): Promise<string> {
  return ecoBadge(await listEcos());
}

export interface DrawingsScreenData {
  drawings: DrawingRow[];
  sync: VaultSyncState | null;
  /** The drawing opened with `?dwg=` (null when none or unknown). */
  detail: DrawingDetail | null;
  /** Its number as the vault writes it (`?dwg=dwg-as-9000` opens DWG-AS-9000); null when none or unknown. */
  selected: string | null;
}

/** The Drawings page: the vault register, the last sync and the opened drawing. */
export async function getDrawingsScreen(requested: string | null): Promise<DrawingsScreenData> {
  const [drawings, sync] = await Promise.all([listDrawings(), getVaultSyncState()]);
  const selected = resolveId(drawings.map((d) => d.number), requested);
  const detail = selected ? await getDrawing(selected) : null;
  return { drawings, sync, detail, selected: detail ? selected : null };
}
