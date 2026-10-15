import 'server-only';
// "Import P&ID tags" — staging and apply (docs/spec/09 §6.11; the structured staging import of src/domain/pid-import.ts).
// `stagePidImport` reads only: it plans the import of a parsed table against the project's tags, the catalogue and
// the project's activities. `applyPidImport` re-plans inside one transaction (the plan the user saw may be stale) and
// writes it: new tags, updated tags (the Keystone mapping kept), removed tags ("Replace all"), the P&ID sheet's
// revision (a project without a P&ID gets its sheet and the five validation steps — the empty state's invitation), the
// first validation step "Tags extracted from P&ID rev X", the audit row and the activity event. The viewer is the
// actor; the screen must be in their workspace (Server Functions also check the project read-only rule).
// By design (R-172), the staging is not stored: it is re-planned from the submitted file inside the apply transaction, so
// what is written always matches the current tags. An ImportJob of kind 'pid' (docs/spec/11 §3.12: formatId, fileRef, mode,
// stagingRows, as the schedule imports keep) waits for the owner lifting the import freeze (D-7b).
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  importModeLabel, importSourceLabel, normaliseTag, parsePidTagList, planHasChanges, planPidImport,
  type ExistingPidTag, type PidImportMode, type PidImportPlan, type PidImportSource,
} from '@/domain/pid-import';
import { extractedStepLabel, releasedStepLabel } from '@/domain/pid';
import { getDb } from '@/server/db/client';
import { parisParts } from '@/server/db/codes';
import { activities, documents, parts, persons, pidSheets, pidTags, pidValidationSteps } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';

type Q = DB | Tx;

export interface PidImportInput {
  /** File name as chosen ("PID-HLT-026_revE_tags.xlsx"); '' for pasted cells. */
  fileName: string;
  /** Revision of the drawing the tags come from (normalised, "E"). */
  revision: string;
  source: PidImportSource;
  mode: PidImportMode;
  /** The file's first sheet / text as rows of cells (header included). */
  table: string[][];
}

const RELEASED_RE = /^P&ID released for construction \(rev [^)]*\)$/;
const EXTRACTED_RE = /^Tags extracted from P&ID rev \S+$/;

async function context(q: Q, projectId: string) {
  const [tags, acts, sheet] = await Promise.all([
    q.select().from(pidTags).where(eq(pidTags.projectId, projectId)).orderBy(asc(pidTags.position)),
    q.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, projectId)),
    q.select().from(pidSheets).where(eq(pidSheets.projectId, projectId)).then((r) => r[0] ?? null),
  ]);
  const existing: ExistingPidTag[] = tags.map((t) => ({
    tag: t.tag, description: t.description, kind: t.kind, scope: t.scope, partRef: t.partRef, note: t.note, activityCode: t.activityCode, plcType: t.plcType,
    stateFeedback: t.stateFeedback, role: t.role, sheet: t.sheet,
  }));
  return { tags, existing, acts, sheet };
}

async function catalogueRefs(q: Q, refs: string[]): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const rows = await q.select({ ref: parts.ref }).from(parts).where(inArray(parts.ref, refs));
  return new Set(rows.map((r) => r.ref));
}

async function plan(q: Q, projectId: string, input: Pick<PidImportInput, 'mode' | 'table'>) {
  const ctx = await context(q, projectId);
  const parsed = parsePidTagList(input.table);
  const refs = [...new Set(parsed.rows.map((r) => r.fields.partRef).filter((r): r is string => !!r))];
  const catalogue = await catalogueRefs(q, refs);
  const p = planPidImport(parsed, ctx.existing, input.mode, { catalogue, activities: new Set(ctx.acts.map((a) => a.code)) });
  return { ...ctx, plan: p };
}

export interface PidImportStage {
  plan: PidImportPlan;
  /** Revision of the registered P&ID (null: no P&ID yet — the import registers it). */
  currentRevision: string | null;
  documentNumber: string | null;
}

/** Staged plan of an import (no write). */
export async function stagePidImport(projectCode: string, input: Pick<PidImportInput, 'mode' | 'table'>, actor: Actor): Promise<PidImportStage> {
  requireWorkspace('pid', actor, 'P&ID validation');
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const r = await plan(db, p.id, input);
  return { plan: r.plan, currentRevision: r.sheet?.revision ?? null, documentNumber: r.sheet?.documentNumber ?? null };
}

export interface PidImportResult {
  plan: PidImportPlan;
  revision: string;
  documentNumber: string;
  /** The import registered the project's P&ID. */
  registered: boolean;
}

/** Applies an import (re-planned in the transaction). Throws (EN message) when nothing can be imported. */
export async function applyPidImport(projectCode: string, input: PidImportInput, actor: Actor): Promise<PidImportResult> {
  requireWorkspace('pid', actor, 'P&ID validation');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const { plan: pl, tags, acts, sheet } = await plan(tx, p.id, input);
    if (pl.error) throw new Error(pl.error);
    if (!pl.counts.imported) throw new Error('No valid tag in the file');
    const revChanged = !sheet || sheet.revision !== input.revision;
    if (!planHasChanges(pl) && !revChanged) throw new Error('Nothing to import: every tag is unchanged');

    const who = await whoIs(tx, actor);
    const now = new Date();
    const today = parisParts(now).iso;
    const actId = new Map(acts.map((a) => [a.code, a.id]));
    const rowOf = new Map(tags.map((t) => [normaliseTag(t.tag), t]));
    let position = tags.reduce((m, t) => Math.max(m, t.position + 1), 0);

    for (const l of pl.lines) {
      const v = l.value;
      if (l.delta === 'new' && v) {
        await tx.insert(pidTags).values({
          projectId: p.id, tag: v.tag, description: v.description, kind: v.kind, scope: v.scope, partRef: v.partRef, note: v.note, activityCode: v.activityCode,
          activityId: actId.get(v.activityCode) ?? null, plcType: v.plcType, stateFeedback: v.stateFeedback, role: v.role, sheet: v.sheet, position: position++,
          mappedAt: v.partRef ? now : null, mappedByName: v.partRef ? who.who : null,
        });
      } else if (l.delta === 'updated' && v) {
        const cur = rowOf.get(normaliseTag(l.tag));
        if (!cur) continue;
        const remapped = v.partRef !== cur.partRef;
        await tx.update(pidTags).set({
          description: v.description, kind: v.kind, scope: v.scope, partRef: v.partRef, note: v.note, activityCode: v.activityCode,
          activityId: v.activityCode === cur.activityCode ? cur.activityId : (actId.get(v.activityCode) ?? null), plcType: v.plcType, stateFeedback: v.stateFeedback,
          role: v.role, sheet: v.sheet, updatedAt: now, ...(remapped ? { mappedAt: now, mappedByName: who.who } : {}),
        }).where(eq(pidTags.id, cur.id));
      } else if (l.delta === 'removed') {
        const cur = rowOf.get(normaliseTag(l.tag));
        if (cur) await tx.delete(pidTags).where(eq(pidTags.id, cur.id));
      }
    }

    const sheets = await tx.select({ s: pidTags.sheet }).from(pidTags).where(eq(pidTags.projectId, p.id));
    const maxSheet = sheets.reduce((m, r) => Math.max(m, r.s), 1);
    let documentNumber: string;
    if (!sheet) {
      // A project without a P&ID: its Codex P&ID record when there is one, else the numbering rule PID-<project>.
      const [doc] = await tx.select({ id: documents.id, number: documents.number }).from(documents).where(and(eq(documents.projectId, p.id), eq(documents.typeCode, 'PID')));
      documentNumber = doc?.number ?? `PID-${p.code}`;
      await tx.insert(pidSheets).values({
        projectId: p.id, documentNumber, documentId: doc?.id ?? null, revision: input.revision, issuedOn: today, sheetCount: maxSheet,
        authorName: who.who, authorPersonId: who.personId, checkerName: '', status: 'under_review',
      });
      const pmShort = p.pmPersonId ? (await tx.select({ s: persons.shortName }).from(persons).where(eq(persons.id, p.pmPersonId)))[0]?.s : null;
      await tx.insert(pidValidationSteps).values([
        { projectId: p.id, position: 0, label: extractedStepLabel(input.revision), state: 'done', dateOn: today, who: who.short },
        { projectId: p.id, position: 1, label: 'Tag ↔ BOM reference mapping', state: 'doing', dateOn: null, who: who.short },
        { projectId: p.id, position: 2, label: 'Overlay scope agreed with client', state: 'todo', dateOn: null, who: `${pmShort ?? 'Project manager'} · Client` },
        { projectId: p.id, position: 3, label: 'Process validation review (HAZOP light)', state: 'todo', dateOn: null, who: 'Quality · Engineering' },
        { projectId: p.id, position: 4, label: releasedStepLabel(input.revision), state: 'todo', dateOn: null, who: who.short },
      ]);
    } else {
      documentNumber = sheet.documentNumber;
      await tx.update(pidSheets).set({
        revision: input.revision, sheetCount: Math.max(sheet.sheetCount, maxSheet), ...(revChanged ? { issuedOn: today } : {}), updatedAt: now,
      }).where(eq(pidSheets.id, sheet.id));
      if (revChanged) {
        const steps = await tx.select().from(pidValidationSteps).where(eq(pidValidationSteps.projectId, p.id));
        const first = steps.find((s) => s.position === 0);
        if (first && EXTRACTED_RE.test(first.label)) {
          await tx.update(pidValidationSteps).set({ label: extractedStepLabel(input.revision), state: 'done', dateOn: today, who: who.short })
            .where(and(eq(pidValidationSteps.projectId, p.id), eq(pidValidationSteps.position, 0)));
        }
        for (const s of steps) {
          if (s.state !== 'done' && RELEASED_RE.test(s.label)) {
            await tx.update(pidValidationSteps).set({ label: releasedStepLabel(input.revision) })
              .where(and(eq(pidValidationSteps.projectId, p.id), eq(pidValidationSteps.position, s.position)));
          }
        }
      }
    }

    const c = pl.counts;
    const counts = `${c.new} new, ${c.updated} updated` + (c.removed ? `, ${c.removed} removed` : '') + (c.rejected ? `, ${c.rejected} rejected` : '');
    await trace(tx, who, {
      objectRef: documentNumber,
      change: `imported ${c.imported} tags${input.fileName ? ` from ${input.fileName}` : ''} (rev ${input.revision}, ${importSourceLabel(input.source)}, ${importModeLabel(input.mode)}): ${counts}`,
      area: 'P&ID', entityType: 'pid_sheet', projectId: p.id,
      activity: { text: `Imported P&ID tags · ${documentNumber} rev ${input.revision}`, kind: 'sync' },
    });
    return { plan: pl, revision: input.revision, documentNumber, registered: !sheet };
  });
}
