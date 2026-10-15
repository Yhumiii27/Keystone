import 'server-only';
// Engineering change orders DAL — read through the Vigie connector (src/server/integrations/vigie). Vigie owns the ECOs
// (user decision, overrides docs/spec/09 §4): Keystone lists the ECOs relevant to its parts and projects, links to them
// in Vigie and records progress (the viewer's approval-key decision, the step advancements of the prototype) that is
// sent to Vigie. No ECO is created, edited or numbered here.
import { installedBasePinsOf, syncLabelOf, type InstalledBasePin } from '@/domain/eco';
import { getDb } from '@/server/db/client';
import {
  ECO_APPROVER_SHORT, ECO_STEP_ADVANCE, ecoApproverKey, ecoDecision, ecoDisposition, ecoKeyOfRole, ecoStatus, ecoStepIndex, ecoType, interchangeability,
  INTERCHANGEABILITY_NOT_ASSESSED,
  type EcoApproverKey, type EcoDecision, type EcoStatus,
} from '@/server/db/codes';
import { findPerson } from '@/server/db/helpers';
import { projects } from '@/server/db/schema';
import { getVigieEcoConnector, type EcoListFilter, type EcoProgressActor, type EcoProgressInput, type EcoProgressReceipt, type VigieEco } from '@/server/integrations/vigie/eco-connector';
import { vigieEcoUrl, vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { listPurchaseOrdersWithParts, type PurchaseOrderRow } from './purchasing';
import { leadProjectCodes } from './project-team';

export type { EcoProgressActor, EcoProgressInput, EcoProgressReceipt, VigieEco };
export { vigieEcoUrl, vigieNewEcoUrl };

export interface EcoApprovalView {
  key: EcoApproverKey;
  /** "Engineering lead", "Quality (ISO 9001)", "PM of impacted projects". */
  label: string;
  /** "Eng.", "Quality", "PM" (table dots). */
  short: string;
  /** Who decides, as Vigie names them. */
  approver: string;
  /** Vigie's decision, or the decision recorded in Keystone while it waits for Vigie. */
  decision: EcoDecision;
  decisionLabel: string;
  /** The decision is recorded in Keystone and pending sync with Vigie. */
  pendingSync: boolean;
}

export interface EcoView extends VigieEco {
  typeLabel: string;
  statusLabel: string;
  /** Index in the step indicator Draft → Impact analysis → In approval → Released (-1 rejected). */
  stepIndex: number;
  /** The step requested in Keystone (pending sync), labelled; null when none. */
  requestedStatusLabel: string | null;
  /** Open = neither released nor rejected (in Vigie). */
  open: boolean;
  interchangeabilityLabel: string;
  /** PROJ_NAMES display names of the declared projects ("Harbor Line"). */
  projectNames: string[];
  approvalsView: EcoApprovalView[];
  /** Any progress waiting for Vigie ("pending sync with Vigie"). */
  pendingSync: boolean;
  /** "Pending sync with Vigie" / "Sync with Vigie failed" / "Sent to Vigie" (src/domain/eco.ts syncLabelOf); null when nothing waits. */
  pendingSyncLabel: string | null;
}

async function projectNameMap(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, short: projects.shortName }).from(projects);
  return new Map(rows.map((r) => [r.code, r.short ?? r.code]));
}

function view(e: VigieEco, names: Map<string, string>): EcoView {
  return {
    ...e,
    typeLabel: ecoType.label(e.type), statusLabel: ecoStatus.label(e.status), stepIndex: ecoStepIndex(e.status),
    requestedStatusLabel: e.requestedStatus ? ecoStatus.label(e.requestedStatus) : null, open: e.status !== 'released' && e.status !== 'rejected',
    interchangeabilityLabel: e.interchangeability ? interchangeability.label(e.interchangeability) : INTERCHANGEABILITY_NOT_ASSESSED,
    projectNames: e.projects.map((c) => names.get(c) ?? c),
    approvalsView: e.approvals.map((a) => {
      const decision = a.pending?.decision ?? a.decision;
      return { key: a.key, label: ecoApproverKey.label(a.key), short: ECO_APPROVER_SHORT[a.key], approver: a.approver, decision, decisionLabel: ecoDecision.label(decision), pendingSync: !!a.pending };
    }),
    pendingSync: e.pendingProgress.length > 0,
    pendingSyncLabel: syncLabelOf(e),
  };
}

/** ECOs relevant to Keystone, Vigie's order (filter on parts / projects when given). */
export async function listEcos(filter?: EcoListFilter): Promise<EcoView[]> {
  const [ecos, names] = await Promise.all([getVigieEcoConnector().listEcos(filter), projectNameMap()]);
  return ecos.map((e) => view(e, names));
}

export interface EcoDetail extends EcoView {
  /** Orders of any project with a line on an ECO part, still open (not Received / Cancelled) — impact "Open purchase orders". */
  openPurchaseOrders: Pick<PurchaseOrderRow, 'number' | 'projectCode' | 'supplier' | 'status' | 'statusLabel'>[];
  effectivityView: (VigieEco['effectivity'][number] & { dispositionLabel: string | null })[];
}

export async function getEco(number: string): Promise<EcoDetail | null> {
  const [e, names] = await Promise.all([getVigieEcoConnector().getEco(number), projectNameMap()]);
  if (!e) return null;
  const pos = (await listPurchaseOrdersWithParts(e.parts)).filter((o) => o.status !== 'received' && o.status !== 'cancelled');
  return {
    ...view(e, names),
    openPurchaseOrders: pos.map(({ number: n, projectCode, supplier, status, statusLabel }) => ({ number: n, projectCode, supplier, status, statusLabel })),
    effectivityView: e.effectivity.map((t) => ({ ...t, dispositionLabel: t.disposition ? ecoDisposition.label(t.disposition) : null })),
  };
}

/**
 * Records the viewer's progress on an ECO — their decision on their approval key, or a step advancement — and sends it
 * to Vigie through the connector (validated there; "pending sync with Vigie" until Vigie acknowledges it).
 */
export async function recordEcoProgress(number: string, input: EcoProgressInput, actor: EcoProgressActor): Promise<EcoProgressReceipt> {
  return getVigieEcoConnector().recordProgress(number, input, actor);
}

/** ECOs in approval in Vigie (sidebar badge of Change orders). */
export async function countEcosInApproval(): Promise<number> {
  return (await getVigieEcoConnector().listEcos()).filter((e) => e.status === 'in_approval').length;
}

/** First open ECO (Vigie order) touching each part (`ecoOpenFor` 4195): ref → ECO number. */
export async function openEcoByPart(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await getVigieEcoConnector().listEcos()) {
    if (e.status === 'released' || e.status === 'rejected') continue;
    for (const r of e.parts) if (!out[r]) out[r] = e.number;
  }
  return out;
}

/** Parts of the open ECOs ("Parts under change", PU/PR "Under change" — from Vigie's status, 09 OQ9). */
export async function partsUnderChange(): Promise<string[]> {
  const refs = new Set<string>();
  for (const e of await getVigieEcoConnector().listEcos()) if (e.status !== 'released' && e.status !== 'rejected') e.parts.forEach((r) => refs.add(r));
  return [...refs];
}

export type { InstalledBasePin };

/**
 * Parts to keep for the installed base (`pinnedFor` 4198), ref → pins. R-110 (E-4 = a, closes 09 OQ21): a targeted machine
 * whose as-maintained configuration is recorded pins only the ECO parts it carries, at the revision fitted on it; a machine
 * without a configuration keeps every ECO part (`installedBasePinsOf`, src/domain/eco.ts). The configurations of every
 * targeted machine are read in one query (fleet.ts `machineConfigurations`, imported on demand: fleet.ts imports this file).
 */
export async function installedBasePins(): Promise<Record<string, InstalledBasePin[]>> {
  const ecos = (await getVigieEcoConnector().listEcos()).filter((e) => e.status !== 'rejected');
  const machines = [...new Set(ecos.flatMap((e) => e.effectivity.filter((t) => t.targetType === 'machine').map((t) => t.targetRef)))];
  const { machineConfigurations } = await import('./fleet');
  return installedBasePinsOf(ecos, await machineConfigurations(machines));
}

/** Summary of the pins of a part ("Keep for the installed base · 1 machine · ECO-2026-015"): distinct machines and ECOs. */
export function pinSummary(pins: InstalledBasePin[] | undefined): { machines: number; ecos: string[]; firstEco: string | null } | null {
  if (!pins?.length) return null;
  const ecos = [...new Set(pins.map((p) => p.eco))];
  return { machines: new Set(pins.map((p) => p.machine)).size, ecos, firstEco: ecos[0] };
}

// ── My approvals (ECO kind) ────────────────────────────────────────────────────────────────────────────

export interface EcoApprovalItem {
  number: string;
  title: string;
  typeLabel: string;
  projectNames: string[];
  raisedOn: string;
  requestedBy: string;
  key: EcoApproverKey;
}

/**
 * ECOs in approval in Vigie whose approval key of the viewer is still pending and not yet decided in Keystone
 * (apprItems 4724). The PM key goes to the PMs of the ECO's projects; the director holds no key.
 */
export async function ecoApprovalQueue(viewer: EcoProgressActor): Promise<EcoApprovalItem[]> {
  const key = ecoKeyOfRole(viewer.role);
  if (!key) return [];
  const ecos = await listEcos();
  let managed: Set<string> | null = null;
  if (key === 'pm') {
    const db = await getDb();
    const p = await findPerson(db, viewer.name);
    // The PM approval: the PMs of an impacted project — PM of record, co-PMs, deputies (R-041).
    managed = new Set(p ? await leadProjectCodes(db, p.id) : []);
  }
  return ecos
    .filter((e) => e.status === 'in_approval' && e.approvalsView.find((a) => a.key === key)?.decision === 'pending')
    .filter((e) => !managed || e.projects.some((c) => managed!.has(c)))
    .map((e) => ({ number: e.number, title: e.title, typeLabel: e.typeLabel, projectNames: e.projectNames, raisedOn: e.raisedOn, requestedBy: e.requestedBy, key }));
}

/** ECOs approved on the viewer's key (the prototype's "Decided this week" ECO term). */
export async function ecoDecidedCount(viewer: EcoProgressActor): Promise<number> {
  const key = ecoKeyOfRole(viewer.role);
  if (!key) return 0;
  return (await listEcos()).filter((e) => e.approvalsView.find((a) => a.key === key)?.decision === 'ok').length;
}

/** Step a viewer may request from this status ("Start impact analysis", "Submit for approval"); null when none. */
export const ecoNextStep = (status: EcoStatus): EcoStatus | null => ECO_STEP_ADVANCE[status] ?? null;
