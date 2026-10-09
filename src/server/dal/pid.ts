import 'server-only';
// P&ID validation DAL — tags, overlay and process validation (docs/spec/09 §6). Keystone owns the tag list and its
// mapping to the project BOM. The rules are src/domain/pid.ts (golden-tested): tag status (`tagStatus` 4766): Client
// scope → Client; no reference → Unmapped; reference not in the catalogue → Unknown ref; not in the project's BOM →
// Not in BOM; part not Validated → "Part <status>"; else Linked. Coverage = Linked / tags in Keystone scope (Keystone +
// Overlay). Mapping candidates: BOM parts of a compatible type (instruments: Electronics, Electrical, Fire & safety;
// equipment: Electrical, Mechanical, Heavy equipment, Assembly), catalogue order, at most 8.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PID_COMPATIBLE_TYPES, feedbackMissing, pidCandidatesOf, pidCoverage, pidNavBadge, pidTagStatusOf } from '@/domain/pid';
import { getDb } from '@/server/db/client';
import {
  bomScope, drawingState, partStatus, pidTagKind, pidTagStatus, plcType, stepState,
  type BomScope, type DrawingState, type PartStatus, type PidRole, type PidTagKind, type PidTagStatus, type PlcType, type StepState,
} from '@/server/db/codes';
import { activities, documents, parts, pidSheets, pidTags, pidValidationSteps, projectBomLines, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';

export type { Actor };
type Q = DB | Tx;

export interface PidTagRow {
  tag: string;
  description: string;
  kind: PidTagKind;
  kindLabel: string;
  scope: BomScope;
  scopeLabel: string;
  /** Mapped reference; null = unmapped. */
  partRef: string | null;
  partName: string | null;
  partStatus: PartStatus | null;
  note: string;
  activityCode: string;
  activityName: string | null;
  plcType: PlcType | null;
  /** "Process PLC", "Safety PLC", "Local"; null = "—". */
  plcLabel: string | null;
  stateFeedback: string;
  role: PidRole;
  /** Actuator wired to a process or safety PLC without state feedback ("Missing"). */
  feedbackMissing: boolean;
  status: PidTagStatus;
  statusLabel: string;
  sheet: number;
}

export interface PidValidation {
  projectCode: string;
  sheet: {
    documentNumber: string; revision: string; issuedOn: string; sheetCount: number; author: string; checker: string; status: DrawingState; statusLabel: string;
    /** The Codex record's current revision and status (11 §7 #10, A-9: the tags were extracted from `revision`). */
    codexRevision: string | null; codexStatus: string | null;
  };
  tags: PidTagRow[];
  steps: { label: string; state: StepState; stateLabel: string; dateOn: string | null; who: string }[];
  coverage: { inScope: number; linked: number; pct: number; unmapped: number; referenceIssues: number; overlay: number; client: number };
}

async function bomRefs(q: Q, projectId: string): Promise<Set<string>> {
  const rows = await q.select({ ref: parts.ref, qty: projectBomLines.quantity }).from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId))
    .where(eq(projectBomLines.projectId, projectId));
  return new Set(rows.filter((r) => r.qty > 0).map((r) => r.ref));
}

/** P&ID validation of a project; null when it has no P&ID registered (the screen's empty state). */
export async function getPidValidation(projectCode: string): Promise<PidValidation | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [sheet] = await db.select({ s: pidSheets, rev: documents.currentRevision, st: documents.status }).from(pidSheets)
    .leftJoin(documents, eq(documents.id, pidSheets.documentId)).where(eq(pidSheets.projectId, p.id));
  if (!sheet) return null;
  const [tags, steps, acts, bom] = await Promise.all([
    db.select().from(pidTags).where(eq(pidTags.projectId, p.id)).orderBy(asc(pidTags.position)),
    db.select().from(pidValidationSteps).where(eq(pidValidationSteps.projectId, p.id)).orderBy(asc(pidValidationSteps.position)),
    db.select({ code: activities.code, name: activities.name }).from(activities).where(eq(activities.projectId, p.id)),
    bomRefs(db, p.id),
  ]);
  const refs = [...new Set(tags.map((t) => t.partRef).filter((r): r is string => !!r))];
  const partRows = refs.length ? await db.select({ ref: parts.ref, name: parts.name, status: parts.status }).from(parts).where(inArray(parts.ref, refs)) : [];
  const partOf = new Map(partRows.map((x) => [x.ref, x]));
  const actName = new Map(acts.map((a) => [a.code, a.name]));
  const rows: PidTagRow[] = tags.map((t) => {
    const part = t.partRef ? partOf.get(t.partRef) : undefined;
    const status = pidTagStatusOf(t.scope, t.partRef, part, !!t.partRef && bom.has(t.partRef));
    return {
      tag: t.tag, description: t.description, kind: t.kind, kindLabel: pidTagKind.label(t.kind), scope: t.scope, scopeLabel: bomScope.label(t.scope), partRef: t.partRef,
      partName: part?.name ?? null, partStatus: part?.status ?? null, note: t.note, activityCode: t.activityCode, activityName: actName.get(t.activityCode) ?? null,
      plcType: t.plcType, plcLabel: t.plcType ? plcType.label(t.plcType) : null, stateFeedback: t.stateFeedback, role: t.role,
      feedbackMissing: feedbackMissing(t), status, statusLabel: pidTagStatus.label(status), sheet: t.sheet,
    };
  });
  return {
    projectCode,
    sheet: {
      documentNumber: sheet.s.documentNumber, revision: sheet.s.revision, issuedOn: sheet.s.issuedOn, sheetCount: sheet.s.sheetCount, author: sheet.s.authorName,
      checker: sheet.s.checkerName, status: sheet.s.status, statusLabel: drawingState.label(sheet.s.status), codexRevision: sheet.rev ?? null, codexStatus: sheet.st ?? null,
    },
    tags: rows,
    steps: steps.map((s) => ({ label: s.label, state: s.state, stateLabel: stepState.label(s.state), dateOn: s.dateOn, who: s.who })),
    coverage: pidCoverage(rows),
  };
}

/**
 * Mapping candidates of a tag: BOM parts of a compatible type, catalogue order, at most 8 (`pidCands`). Computed for
 * client-scope tags too (the drawer does not offer them; `mapPidTag` refuses client scope).
 */
export async function pidCandidates(projectCode: string, tag: string): Promise<{ ref: string; name: string; status: PartStatus; statusLabel: string }[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [t] = await db.select().from(pidTags).where(and(eq(pidTags.projectId, p.id), eq(pidTags.tag, tag)));
  if (!t) return [];
  const bom = await bomRefs(db, p.id);
  const rows = await db.select({ ref: parts.ref, name: parts.name, status: parts.status, type: parts.type }).from(parts)
    .where(inArray(parts.type, [...PID_COMPATIBLE_TYPES[t.kind]])).orderBy(asc(parts.position));
  return pidCandidatesOf(t.kind, rows, bom).map((r) => ({ ref: r.ref, name: r.name, status: r.status, statusLabel: partStatus.label(r.status) }));
}

/** Maps a tag in Keystone scope to a BOM reference (a candidate), or unlinks it (`partRef` null). */
export async function mapPidTag(projectCode: string, tag: string, partRef: string | null, actor: Actor): Promise<void> {
  requireWorkspace('pid', actor, 'P&ID validation');
  const db = await getDb();
  const candidates = partRef ? await pidCandidates(projectCode, tag) : [];
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [t] = await tx.select().from(pidTags).where(and(eq(pidTags.projectId, p.id), eq(pidTags.tag, tag)));
    if (!t) throw new Error(`Unknown tag ${tag} on ${projectCode}`);
    if (t.scope === 'client') throw new Error('Client-supplied equipment: no BOM reference expected');
    if (partRef && !candidates.some((c) => c.ref === partRef)) throw new Error(`${partRef} is not a BOM article of a compatible type`);
    if (!partRef && !t.partRef) throw new Error(`${tag} is not mapped`);
    // Picking the reference already mapped changes nothing (no second audit row).
    if (partRef && partRef === t.partRef) throw new Error(`${tag} is already linked to ${partRef}`);
    const who = await whoIs(tx, actor);
    await tx.update(pidTags).set({ partRef, mappedAt: new Date(), mappedByName: who.who, updatedAt: new Date() }).where(eq(pidTags.id, t.id));
    await trace(tx, who, {
      objectRef: tag, change: partRef ? `mapped to ${partRef}${t.partRef ? ` (was ${t.partRef})` : ''}` : `unlinked from ${t.partRef}`, area: 'P&ID', entityType: 'pid_tag', entityId: t.id, projectId: p.id,
    });
  });
}

/** Keystone-scope tags not Linked while the coverage is below 100 % (P&ID nav badge), per project. */
export async function pidBadgeByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code }).from(pidSheets).innerJoin(projects, eq(projects.id, pidSheets.projectId));
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = await getPidValidation(r.code);
    // No badge "0" when nothing is in our scope (coverage 0 % with nothing to link — src/domain/pid.ts `pidNavBadge`).
    const badge = v ? pidNavBadge(v.coverage) : null;
    if (badge) out[r.code] = badge;
  }
  return out;
}
