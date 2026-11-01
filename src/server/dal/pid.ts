import 'server-only';
// P&ID validation DAL — tags, overlay and process validation (docs/spec/09 §6). Keystone owns the tag list and its
// mapping to the project BOM. The rules are src/domain/pid.ts (golden-tested): tag status (`tagStatus` 4766): Client
// scope → Client; no reference → Unmapped; reference not in the catalogue → Unknown ref; not in the project's BOM →
// Not in BOM; part not Validated → "Part <status>"; else Linked. Coverage = Linked / tags in Keystone scope (Keystone +
// Overlay). Mapping candidates (R-108, E-6 = a): the whole catalogue, searched by reference or name, filtered by type (the
// tag kind's compatible types by default — instruments: Electronics, Electrical, Fire & safety; equipment: Electrical,
// Mechanical, Heavy equipment, Assembly), the project BOM's articles first, at most 20. Linking an article outside the BOM can
// add it to the BOM in the same transaction. R-109 (A-9): the gap between the tag list's revision and Codex's reference one.
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  feedbackMissing, pidCoverage, pidNavBadge, pidRevisionGap, pidTagStatusOf, searchPidCandidates, type PidRevisionGap, type PidTypeFilter,
} from '@/domain/pid';
import { dataText } from '@/i18n/data-text';
import { getDb } from '@/server/db/client';
import {
  bomScope, drawingState, partStatus, pidTagKind, pidTagStatus, plcType, stepState,
  type BomScope, type DrawingState, type PartStatus, type PidRole, type PidTagKind, type PidTagStatus, type PlcType, type StepState,
} from '@/server/db/codes';
import { activities, documents, parts, pidSheets, pidTags, pidValidationSteps, projectBomLines, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { addBomLine } from './bom';
import { projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';
import { editsProjectScreen } from './team-guard';

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
    /** R-109 (A-9 = a): Codex's reference revision is ahead of (or not comparable with) the tag list's; null = nothing to report. */
    gap: PidRevisionGap | null;
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
      gap: pidRevisionGap(sheet.s.revision, sheet.rev ?? null, sheet.st ?? null),
    },
    tags: rows,
    steps: steps.map((s) => ({ label: s.label, state: s.state, stateLabel: stepState.label(s.state), dateOn: s.dateOn, who: s.who })),
    coverage: pidCoverage(rows),
  };
}

export interface PidCandidate {
  ref: string;
  name: string;
  status: PartStatus;
  statusLabel: string;
  /** In the project BOM (quantity > 0): linking it gives a Linked tag; otherwise "Link and add to the BOM" is offered. */
  inBom: boolean;
}

/**
 * Mapping candidates of a tag (R-108, E-6 = a): the whole catalogue, searched by reference or name (the French name too when
 * `lang` is fr), filtered by type (default: the tag kind's compatible types), the project BOM's articles first, at most 20
 * (`more` = refine the search). Computed for client-scope tags too (the drawer does not offer them; `mapPidTag` refuses them).
 */
export async function pidCandidates(projectCode: string, tag: string, opts: { q?: string; type?: PidTypeFilter; lang?: 'en' | 'fr' } = {}): Promise<{ rows: PidCandidate[]; more: boolean }> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [t] = await db.select().from(pidTags).where(and(eq(pidTags.projectId, p.id), eq(pidTags.tag, tag)));
  if (!t) return { rows: [], more: false };
  const [bom, catalogue] = await Promise.all([
    bomRefs(db, p.id),
    db.select({ ref: parts.ref, name: parts.name, status: parts.status, type: parts.type }).from(parts).orderBy(asc(parts.position)),
  ]);
  const lang = opts.lang ?? 'en';
  const found = searchPidCandidates(catalogue, { kind: t.kind, q: opts.q ?? '', type: opts.type ?? 'compatible', bomRefs: bom, display: lang === 'fr' ? (x) => dataText(x.name, lang) : undefined });
  return { rows: found.rows.map((r) => ({ ref: r.ref, name: r.name, status: r.status, statusLabel: partStatus.label(r.status), inBom: r.inBom })), more: found.more };
}

/** R-108: "Link and add to the BOM" — the BOM line added with the mapping (quantity, default 1). */
export interface PidBomAdd {
  quantity: number;
}

/**
 * Maps a tag in Keystone scope to a catalogue reference (R-108: any catalogue article, E-6), or unlinks it (`partRef` null).
 * Refuses an unknown reference, a client-supplied tag and the reference already mapped. With `addToBom`, the article joins
 * the project BOM in the same transaction (`addBomLine`): quantity as given, the tag's scope (Keystone / Overlay), the tag's
 * activity only when it is in the project plan (an imported tag may carry another code); the actor must edit the project's
 * BOM (workspace and team, re-checked here). Audited on the tag and on the BOM; the BOM addition is in the activity feed.
 */
export async function mapPidTag(projectCode: string, tag: string, partRef: string | null, actor: Actor, addToBom?: PidBomAdd): Promise<void> {
  requireWorkspace('pid', actor, 'P&ID validation');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [t] = await tx.select().from(pidTags).where(and(eq(pidTags.projectId, p.id), eq(pidTags.tag, tag)));
    if (!t) throw new Error(`Unknown tag ${tag} on ${projectCode}`);
    if (t.scope === 'client') throw new Error('Client-supplied equipment: no BOM reference expected');
    if (partRef) {
      const [part] = await tx.select({ ref: parts.ref }).from(parts).where(eq(parts.ref, partRef));
      if (!part) throw new Error(`${partRef} is not in the catalogue`);
    }
    if (!partRef && !t.partRef) throw new Error(`${tag} is not mapped`);
    // Picking the reference already mapped changes nothing (no second audit row).
    if (partRef && partRef === t.partRef && !addToBom) throw new Error(`${tag} is already linked to ${partRef}`);
    if (addToBom && !partRef) throw new Error('Invalid request');
    if (addToBom && !(await editsProjectScreen(tx, actor, p.id, 'bom'))) throw new Error('This project BOM is read-only for you');
    const who = await whoIs(tx, actor);
    if (partRef !== t.partRef) {
      await tx.update(pidTags).set({ partRef, mappedAt: new Date(), mappedByName: who.who, updatedAt: new Date() }).where(eq(pidTags.id, t.id));
      await trace(tx, who, {
        objectRef: tag, change: partRef ? `mapped to ${partRef}${t.partRef ? ` (was ${t.partRef})` : ''}` : `unlinked from ${t.partRef}`, area: 'P&ID', entityType: 'pid_tag', entityId: t.id, projectId: p.id,
      });
    }
    if (addToBom && partRef) {
      const [act] = await tx.select({ code: activities.code }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, t.activityCode)));
      const scope = t.scope === 'overlay' ? 'overlay' : 'keystone';
      await addBomLine(projectCode, { ref: partRef, quantity: addToBom.quantity, activityCode: act?.code ?? null, scope, note: null }, actor.name, tx);
      await trace(tx, who, {
        objectRef: `${p.code} BOM`, change: `${partRef} × ${addToBom.quantity} added from P&ID tag ${tag}`, area: 'BOM', entityType: 'pid_tag', entityId: t.id, projectId: p.id,
        activity: { text: `Added ${partRef} × ${addToBom.quantity} to the BOM from P&ID tag ${tag}`, kind: 'change' },
      });
    }
  });
}

/**
 * Keystone-scope tags not Linked while the coverage is below 100 % (P&ID nav badge), per project. R-017: three reads for the
 * whole portfolio (the tags of the projects with a P&ID sheet, their parts, the BOM references) instead of the full P&ID
 * validation of each project; the tag status and the coverage are the same rules (`pidTagStatusOf`, `pidCoverage`).
 */
export async function pidBadgeByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const [tags, bom] = await Promise.all([
    db.select({ code: projects.code, scope: pidTags.scope, partRef: pidTags.partRef }).from(pidTags)
      .innerJoin(projects, eq(projects.id, pidTags.projectId))
      .innerJoin(pidSheets, eq(pidSheets.projectId, pidTags.projectId)),
    db.select({ code: projects.code, ref: parts.ref, qty: projectBomLines.quantity }).from(projectBomLines)
      .innerJoin(parts, eq(parts.id, projectBomLines.partId)).innerJoin(projects, eq(projects.id, projectBomLines.projectId))
      .innerJoin(pidSheets, eq(pidSheets.projectId, projectBomLines.projectId)),
  ]);
  const refs = [...new Set(tags.map((t) => t.partRef).filter((r): r is string => !!r))];
  const partRows = refs.length ? await db.select({ ref: parts.ref, status: parts.status }).from(parts).where(inArray(parts.ref, refs)) : [];
  const partOf = new Map(partRows.map((x) => [x.ref, x]));
  const inBom = new Set(bom.filter((b) => b.qty > 0).map((b) => `${b.code}|${b.ref}`));
  const byProject = new Map<string, { scope: (typeof tags)[number]['scope']; status: ReturnType<typeof pidTagStatusOf> }[]>();
  for (const t of tags) {
    const part = t.partRef ? partOf.get(t.partRef) : undefined;
    const status = pidTagStatusOf(t.scope, t.partRef, part, !!t.partRef && inBom.has(`${t.code}|${t.partRef}`));
    const list = byProject.get(t.code) ?? [];
    if (!list.length) byProject.set(t.code, list);
    list.push({ scope: t.scope, status });
  }
  const out: Record<string, number> = {};
  for (const [code, rows] of byProject) {
    // No badge "0" when nothing is in our scope (coverage 0 % with nothing to link — src/domain/pid.ts `pidNavBadge`).
    const badge = pidNavBadge(pidCoverage(rows));
    if (badge) out[code] = badge;
  }
  return out;
}
