import 'server-only';
// R-160 (P2, owner's answer D9-32 of 10 Nov 2026): the CE conformity file of each equipment line of a project (R-185) —
// Machinery Regulation (EU) 2023/1230, applicable from 20 Jan 2027 — and the reference checklists of Settings. Read by the
// Commissioning & handover screen (the "CE conformity" card and the file), the Projects register (the portfolio card) and the
// Server Functions that warn at the handover (Plan SAT, registering delivered machines). Rules: src/domain/ce-conformity.ts.
// Documents live in Codex: Keystone keeps their references only. Permission checks belong to the calling Server Function; the
// writers re-check the workspace and the role.
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  CE_CHECKLIST_DEFAULTS, CE_TECHNICAL_ROLES, EMPTY_CE_FILE, applyCeScope, ceChangedFields, ceMarketDate, ceReadiness, ceRegulationApplies,
  parseCeFile, parseChecklistEntry, type CeChecklistKind, type CeEditScope, type CeFileValues, type CeReadiness,
  type EhsrStatus, type TechFileEntry,
} from '@/domain/ce-conformity';
import { SETTINGS_DIRECTOR_ONLY, canEditSettings } from '@/domain/settings-rules';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { machineType } from '@/server/db/codes';
import {
  ceChecklistItems, ceFiles, commissioningSteps, commissioningSystems, deliverables, handoverItems, machineTypes, machines, projectEquipments, projects,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { managesProject, projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';
import { assertRecordFresh, tokenOf, type VersionedTable } from './record-version';

type Q = DB | Tx;

export const CE_FILE_TABLE: VersionedTable = { table: ceFiles, id: ceFiles.id, version: ceFiles.version, entityType: 'ce_file' };

// ── Checklists ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CeChecklistRow {
  code: string;
  title: string;
  active: boolean;
  isDefault: boolean;
}

export type CeChecklists = Record<CeChecklistKind, CeChecklistRow[]>;

/** Both checklists, every entry (active or not), in Settings order. */
export async function listCeChecklists(q?: Q): Promise<CeChecklists> {
  const db = q ?? (await getDb());
  const rows = await db.select().from(ceChecklistItems).orderBy(asc(ceChecklistItems.kind), asc(ceChecklistItems.position), asc(ceChecklistItems.code));
  const out: CeChecklists = { ehsr: [], techfile: [] };
  for (const r of rows) out[r.kind].push({ code: r.code, title: r.title, active: r.active, isDefault: r.isDefault });
  return out;
}

const activeCodes = (l: CeChecklists) => ({ ehsr: l.ehsr.filter((e) => e.active).map((e) => e.code), techFile: l.techfile.filter((e) => e.active).map((e) => e.code) });

/** Settings writers: the Settings workspace and the roles that edit Settings (the portfolio director, A-14). */
function checklistWriter(actor: Actor) {
  requireWorkspace('settings', actor, 'Settings');
  if (!canEditSettings(actor.role)) throw new Error(SETTINGS_DIRECTOR_ONLY);
}

/** Adds an entry to a checklist (a removed entry with the same code comes back with the new title). */
export async function addCeChecklistItem(kind: string, code: string, title: string, actor: Actor): Promise<string> {
  checklistWriter(actor);
  const parsed = parseChecklistEntry(kind, code, title);
  if (!parsed.ok) throw new Error(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(ceChecklistItems).where(eq(ceChecklistItems.kind, v.kind));
    const same = rows.find((r) => r.code === v.code);
    if (same?.active) throw new Error('This entry is already in the list');
    const position = rows.reduce((m, r) => Math.max(m, r.position + 1), 0);
    const who = await whoIs(tx, actor);
    if (same) {
      await tx.update(ceChecklistItems).set({ active: true, title: v.title, position, updatedAt: new Date() }).where(eq(ceChecklistItems.id, same.id));
      await trace(tx, who, {
        objectRef: `Settings · CE conformity · ${v.code}`, change: `entry restored · ${v.code} ${v.title}`, area: 'Settings', entityType: 'ce_checklist_item', entityId: same.id,
        before: { active: false, title: same.title }, after: { active: true, title: v.title },
      });
    } else {
      const [row] = await tx.insert(ceChecklistItems).values({ kind: v.kind, code: v.code, title: v.title, position, active: true, isDefault: false }).returning({ id: ceChecklistItems.id });
      await trace(tx, who, {
        objectRef: `Settings · CE conformity · ${v.code}`, change: `entry added · ${v.code} ${v.title}`, area: 'Settings', entityType: 'ce_checklist_item', entityId: row.id,
        after: { kind: v.kind, code: v.code, title: v.title },
      });
    }
    return v.code;
  });
}

/** Removes (deactivates) or restores an entry; the files keep their answers, the readiness counts the active entries only. */
export async function setCeChecklistItemActive(kind: string, code: string, active: boolean, actor: Actor): Promise<void> {
  checklistWriter(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(ceChecklistItems).where(and(eq(ceChecklistItems.kind, kind as CeChecklistKind), eq(ceChecklistItems.code, code)));
    if (!row) throw new Error('Unknown entry');
    if (row.active === active) return;
    await tx.update(ceChecklistItems).set({ active, updatedAt: new Date() }).where(eq(ceChecklistItems.id, row.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Settings · CE conformity · ${row.code}`, change: `entry ${active ? 'restored' : 'removed'} · ${row.code} ${row.title}`, area: 'Settings',
      entityType: 'ce_checklist_item', entityId: row.id, before: { active: row.active }, after: { active },
    });
  });
}

/** "Reset to defaults" of the CE checklists: the default entries active with their default titles, the added ones removed. */
export async function resetCeChecklists(actor: Actor): Promise<void> {
  checklistWriter(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(ceChecklistItems);
    const before = rows.filter((r) => r.active).map((r) => `${r.kind}:${r.code}`);
    for (const kind of Object.keys(CE_CHECKLIST_DEFAULTS) as CeChecklistKind[]) {
      const defaults = CE_CHECKLIST_DEFAULTS[kind];
      for (const [position, d] of defaults.entries()) {
        const cur = rows.find((r) => r.kind === kind && r.code === d.code);
        if (cur) await tx.update(ceChecklistItems).set({ title: d.title, position, active: true, isDefault: true, updatedAt: new Date() }).where(eq(ceChecklistItems.id, cur.id));
        else await tx.insert(ceChecklistItems).values({ kind, code: d.code, title: d.title, position, active: true, isDefault: true });
      }
      for (const r of rows.filter((x) => x.kind === kind && !defaults.some((d) => d.code === x.code) && x.active)) {
        await tx.update(ceChecklistItems).set({ active: false, updatedAt: new Date() }).where(eq(ceChecklistItems.id, r.id));
      }
    }
    const after = Object.entries(CE_CHECKLIST_DEFAULTS).flatMap(([k, ds]) => ds.map((d) => `${k}:${d.code}`));
    await trace(tx, await whoIs(tx, actor), { objectRef: 'Settings · CE conformity', change: 'CE checklists reset to defaults', area: 'Settings', before: { active: before }, after: { active: after } });
  });
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const toValues = (f: typeof ceFiles.$inferSelect): CeFileValues => ({
  regime: f.regime, category: f.category, route: f.route, riskAssessmentRef: f.riskAssessmentRef, standards: f.standards ?? [], instructionsRef: f.instructionsRef,
  declarationSignatory: f.declarationSignatory, declarationOn: f.declarationOn, declarationRef: f.declarationRef, ceMarkingOn: f.ceMarkingOn,
  ehsr: (f.ehsr ?? {}) as Record<string, EhsrStatus>, techFile: (f.techFile ?? {}) as Record<string, TechFileEntry>,
});

export interface CeLine {
  /** "EQ-01". */
  ref: string;
  /** Display code of the machine type ("MEMU"). */
  typeLabel: string;
  quantity: number;
  /** Typed label of the line (dataText); null = none. */
  label: string | null;
  /** The stored file; null before the first save. */
  file: CeFileValues | null;
  /** Edit token (R-010) of the stored file; null before the first save. */
  token: string | null;
  updatedAt: string | null;
  readiness: CeReadiness;
  /** When the line's machines are placed on the market (ceMarketDate); null = unknown. */
  marketDate: string | null;
  /** The Regulation applies (placed on the market from 20 Jan 2027, or date unknown). */
  regulationApplies: boolean;
  /** Installed-base machines of the line ("MCH-050"). */
  machines: { number: string; deliveredOn: string | null }[];
  /** The line's systems have a handover step done or dated (the warning is due). */
  atHandover: boolean;
}

export interface ProjectCe {
  projectCode: string;
  lines: CeLine[];
  checklists: CeChecklists;
  /** Project deliverables a technical-file heading may point to (certificates first). */
  deliverables: { number: string; title: string; type: string }[];
  /** The handover dossier's line "CE declaration & certificates of conformity" (R-160 reuses it), when the project has one. */
  dossierLine: { item: string; status: string; documentRef: string | null } | null;
}

/** Is a handover-dossier line the CE declaration line ("CE declaration & certificates of conformity", type COC)? */
const isCeDossierLine = (h: { item: string; documentTypeCode: string }) => h.documentTypeCode === 'COC' || /\bCE\b/.test(h.item);

interface LoadedProject {
  id: string;
  code: string;
  stage: string;
  plannedFinishDate: string | null;
  finishMonth: number | null;
}

/** Computes the lines of some projects (one query per table). */
async function linesOfProjects(db: Q, ps: LoadedProject[], lists: CeChecklists, readAt: Date): Promise<Map<string, CeLine[]>> {
  const out = new Map<string, CeLine[]>();
  if (!ps.length) return out;
  const ids = ps.map((p) => p.id);
  const [lines, files, fleet, systems] = await Promise.all([
    db.select({ e: projectEquipments, typeLabel: machineTypes.label }).from(projectEquipments)
      .leftJoin(machineTypes, eq(machineTypes.code, projectEquipments.machineTypeCode))
      .where(inArray(projectEquipments.projectId, ids)).orderBy(asc(projectEquipments.position), asc(projectEquipments.ref)),
    db.select().from(ceFiles).where(inArray(ceFiles.projectId, ids)),
    db.select({ number: machines.number, projectId: machines.projectId, equipmentId: machines.equipmentId, deliveredOn: machines.deliveredOn }).from(machines)
      .where(inArray(machines.projectId, ids)).orderBy(asc(machines.number)),
    db.select({ projectId: commissioningSystems.projectId, equipmentId: commissioningSystems.equipmentId, status: commissioningSteps.status, dateOn: commissioningSteps.dateOn })
      .from(commissioningSteps).innerJoin(commissioningSystems, eq(commissioningSystems.id, commissioningSteps.systemId))
      .where(and(inArray(commissioningSystems.projectId, ids), eq(commissioningSteps.step, 'handover'))),
  ]);
  const active = activeCodes(lists);
  for (const p of ps) {
    const own = lines.filter((l) => l.e.projectId === p.id);
    const single = own.length === 1;
    out.set(p.code, own.map(({ e, typeLabel }) => {
      const stored = files.find((f) => f.equipmentId === e.id) ?? null;
      const file = stored ? toValues(stored) : null;
      const mine = <T extends { projectId: string | null; equipmentId: string | null }>(xs: T[]) =>
        xs.filter((x) => x.projectId === p.id && (x.equipmentId === e.id || (x.equipmentId === null && single)));
      const lineMachines = mine(fleet);
      const handover = systems.filter((x) => x.projectId === p.id && (x.equipmentId === e.id || x.equipmentId === null));
      const marketDate = ceMarketDate({
        quantity: e.quantity, deliveredOn: lineMachines.map((m) => m.deliveredOn).filter((d): d is string => !!d), handoverOn: handover.map((h) => h.dateOn),
        plannedFinish: p.plannedFinishDate, finishMonth: p.finishMonth,
      });
      return {
        ref: e.ref, typeLabel: typeLabel ?? (machineType.isCode(e.machineTypeCode) ? machineType.label(e.machineTypeCode) : e.machineTypeCode), quantity: e.quantity, label: e.label,
        file, token: stored ? tokenOf(stored.version, readAt) : null, updatedAt: stored ? stored.updatedAt.toISOString() : null,
        readiness: ceReadiness(file, active), marketDate, regulationApplies: ceRegulationApplies(marketDate),
        machines: lineMachines.map((m) => ({ number: m.number, deliveredOn: m.deliveredOn })),
        atHandover: handover.some((h) => h.status === 'done' || h.status === 'in_progress' || !!h.dateOn) || lineMachines.length > 0,
      };
    }));
  }
  return out;
}

const projectCols = { id: projects.id, code: projects.code, stage: projects.stage, plannedFinishDate: projects.plannedFinishDate, finishMonth: projects.finishMonth };

/** The CE files of a project's equipment lines, with what the screen needs; null for an unknown project. */
export async function getProjectCe(projectCode: string): Promise<ProjectCe | null> {
  const db = await getDb();
  const readAt = new Date();
  const [p] = await db.select(projectCols).from(projects).where(eq(projects.code, projectCode));
  if (!p) return null;
  const checklists = await listCeChecklists(db);
  const [lines, delivs, dossier] = await Promise.all([
    linesOfProjects(db, [p], checklists, readAt),
    db.select({ number: deliverables.number, title: deliverables.title, type: deliverables.type }).from(deliverables).where(eq(deliverables.projectId, p.id)).orderBy(asc(deliverables.number)),
    db.select().from(handoverItems).where(eq(handoverItems.projectId, p.id)).orderBy(asc(handoverItems.position)),
  ]);
  const ce = dossier.find(isCeDossierLine);
  return {
    projectCode: p.code, lines: lines.get(p.code) ?? [], checklists,
    deliverables: [...delivs.filter((d) => d.type === 'certificates'), ...delivs.filter((d) => d.type !== 'certificates')],
    dossierLine: ce ? { item: ce.item, status: ce.status, documentRef: ce.documentRef } : null,
  };
}

/** The equipment line of a commissioning system ("EQ-02"); null = common to the project (or unknown). */
export async function equipmentRefOfSystem(projectCode: string, system: string): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.select({ ref: projectEquipments.ref }).from(commissioningSystems)
    .innerJoin(projects, eq(projects.id, commissioningSystems.projectId))
    .leftJoin(projectEquipments, eq(projectEquipments.id, commissioningSystems.equipmentId))
    .where(and(eq(projects.code, projectCode), eq(commissioningSystems.name, system)));
  return r?.ref ?? null;
}

export interface PortfolioCeRow {
  projectCode: string;
  projectName: string;
  line: CeLine;
}

/** Stages whose machines are not (or no longer) to be placed on the market by the project. */
const OUT_OF_SCOPE_STAGES = new Set(['clos', 'annule']);

/**
 * The portfolio list: the equipment lines of every open project (not closed, not cancelled) whose CE file is incomplete while
 * the Regulation applies to them (placed on the market from 20 Jan 2027, or date unknown), earliest market date first.
 */
export async function listPortfolioCeGaps(): Promise<PortfolioCeRow[]> {
  const db = await getDb();
  const readAt = new Date();
  const ps = (await db.select({ ...projectCols, name: projects.name }).from(projects)).filter((p) => !OUT_OF_SCOPE_STAGES.has(p.stage));
  const checklists = await listCeChecklists(db);
  const lines = await linesOfProjects(db, ps, checklists, readAt);
  const rows: PortfolioCeRow[] = [];
  for (const p of ps) {
    for (const line of lines.get(p.code) ?? []) {
      if (line.regulationApplies && !line.readiness.complete) rows.push({ projectCode: p.code, projectName: p.name, line });
    }
  }
  return rows.sort((a, b) => (a.line.marketDate ?? '9999').localeCompare(b.line.marketDate ?? '9999') || a.projectCode.localeCompare(b.projectCode) || a.line.ref.localeCompare(b.line.ref));
}

export interface SaveCeInput {
  /** The file sent by the form (untrusted). */
  values: unknown;
  /** R-010 token the form read (null = no check). */
  token?: string | null;
  /** What the viewer may change (ceEditScope, computed by the Server Function from the project context). */
  scope: CeEditScope;
}

/**
 * Saves the CE file of an equipment line (created at the first save). The fields outside the editor's scope keep their stored
 * values (a PM changes the declaration and the marking only). No change → no write. Audit: area "CE conformity", the changed
 * fields before / after; activity on the project.
 */
export async function saveCeFile(projectCode: string, ref: string, input: SaveCeInput, actor: Actor): Promise<{ changed: boolean; readiness: CeReadiness }> {
  requireWorkspace('commissioning', actor, 'Commissioning & handover');
  if (input.scope === 'none') throw new Error('This CE file is read-only for you');
  if (input.scope === 'technical' && !(CE_TECHNICAL_ROLES as readonly string[]).includes(actor.role)) throw new Error('This CE file is read-only for you');
  if (input.scope === 'project' && actor.role !== 'pm') throw new Error('This CE file is read-only for you');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (input.scope === 'project' && !(await managesProject(tx, actor, p))) throw new Error('This CE file is read-only for you');
    const [line] = await tx.select().from(projectEquipments).where(and(eq(projectEquipments.projectId, p.id), eq(projectEquipments.ref, ref)));
    if (!line) throw new Error('Unknown equipment line');
    const lists = await listCeChecklists(tx);
    const delivs = await tx.select({ number: deliverables.number }).from(deliverables).where(eq(deliverables.projectId, p.id));
    const parsed = parseCeFile(input.values, { ehsrCodes: lists.ehsr.map((e) => e.code), techCodes: lists.techfile.map((e) => e.code), deliverables: delivs.map((d) => d.number) });
    if (!parsed.ok) throw new Error(parsed.error);
    const [stored] = await tx.select().from(ceFiles).where(eq(ceFiles.equipmentId, line.id));
    const who = await whoIs(tx, actor);
    if (stored) await assertRecordFresh(tx, CE_FILE_TABLE, stored.id, input.token, { name: who.who, personId: who.personId });
    const before = stored ? toValues(stored) : EMPTY_CE_FILE;
    const after = applyCeScope(before, parsed.value, input.scope);
    const readiness = ceReadiness(after, activeCodes(lists));
    const diff = ceChangedFields(before, after);
    if (!Object.keys(diff.after).length) return { changed: false, readiness };
    const set = { ...after, updatedAt: new Date() };
    let id: string;
    if (stored) {
      await tx.update(ceFiles).set(set).where(eq(ceFiles.id, stored.id));
      id = stored.id;
    } else {
      [{ id }] = await tx.insert(ceFiles).values({ projectId: p.id, equipmentId: line.id, ...after }).returning({ id: ceFiles.id });
    }
    const message = systemMessage('ce.fileUpdated', { ref, done: readiness.done, total: readiness.total });
    await trace(tx, who, {
      objectRef: `${p.code} · ${ref} · CE file`, message, area: 'CE conformity',
      entityType: 'ce_file', entityId: id, projectId: p.id, before: diff.before, after: diff.after,
      activity: { message, kind: 'change' },
    });
    return { changed: true, readiness };
  });
}
