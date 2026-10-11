import 'server-only';
// Project engineering register DAL — Synthesis and the four discipline screens (docs/spec/09 §7–8). Keystone owns
// the register; files stay in the business tools. Deliverables are Codex index records of the project whose service is
// a discipline (documents.ts): Freeze / Propose release change their Codex status, shared with the Documents screen;
// Validate release (PM) starts their Codex approval circuit. Rules:
// - input state (E-5 = a): the provider document's latest revision is its current one once frozen or released, else
//   (a Draft) the previous letter (`prevRev`; "A" stays "A"); external documents (the client's BOD-CLI-026) are always
//   up to date. Outdated when the revision in use differs from the latest, else Up to date when confirmed, else To
//   confirm (`inRows` 4794; domain `inputLatest`);
// - an output recorded "Blocked" is Ready once its discipline has no open blocking check (`outRows` 4795);
// - "Propose release" is refused while the discipline owns an open blocking check; "Validate release" is the PM's
//   (the project's PM or the director — the prototype had no role check, 09 §8.6). Delivery 7 (P-7c = a, R-106): it
//   starts the type's approval circuit in Codex through the outbox; the deliverable is Released when Codex has every
//   step approved (the status is never set here);
// - the import wizard freezes the imported revision as the consumer's input (to confirm), resolves the consumer's
//   revision-alignment checks not resolved yet, sent back ones included ("Closed by import of rev D") and, for the
//   instrument list extracted from the P&ID, also updates the consumer's P&ID input (`finish` 4813).
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  DISCIPLINES, checkSeverity, checkStatus, discipline, docRecipient, documentStatus, inputState, isOpenCheck, outputState,
  type CheckSeverity, type CheckStatus, type Discipline, type DocRecipient, type DocumentStatus, type InputState, type OutputState,
} from '@/server/db/codes';
import {
  documents, engChanges, engChecks, engColumnMappings, engConsistencyRules, engDisciplines, engImportDeltas, engImportTools,
  engImports, engInputs, engOutputs, projects,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { CLOSED_BY_IMPORT, inputLatest } from '@/domain/engineering';
import { freezeDocument, listProjectDocuments, proposeDocumentRelease, recordCircuitStart, type VaultDocument } from './documents';
import { managesProject, projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';

export type { Actor };

/** Previous revision letter (`prevRev`): "D" → "C"; "A" stays "A"; non-letters unchanged. */
export const prevRev = (rev: string) => (/^[B-Z]$/.test(rev) ? String.fromCharCode(rev.charCodeAt(0) - 1) : rev);
/** "PID-HLT-026" → "PID", "LST-INS-026" → "LST-INS", "BOD-CLI-026" → "BOD-CLI" (`shortDoc`: the project code, then its number, removed). */
export const shortDoc = (id: string, projectCode: string) => id.replace(`-${projectCode}`, '').replace(`-${projectCode.split('-')[1] ?? ''}`, '');

export interface EngDisciplineRow { code: Discipline; label: string; icon: string; lead: string; tools: string }

export interface EngInputRow {
  consumer: Discipline;
  documentNumber: string;
  title: string;
  /** Provider: the discipline of an internal document, else the external party ("client"). */
  provider: DocRecipient;
  providerLabel: string;
  revisionInUse: string;
  latest: string;
  acknowledged: boolean;
  outdated: boolean;
  state: InputState;
  stateLabel: string;
  /** The document is a Codex record. */
  inCodex: boolean;
}

export interface EngDeliverableRow {
  number: string;
  title: string;
  discipline: Discipline;
  revision: string;
  status: DocumentStatus;
  statusLabel: string;
  issuedOn: string;
  author: string;
  recipients: DocRecipient[];
  /** Open blocking checks owned by the discipline (release gate). */
  blockingChecks: number;
  canFreeze: boolean;
  canPropose: boolean;
  proposeBlocked: boolean;
  /** Release proposed and the Codex approval circuit not started yet (P-7c): "Validate release (PM)" starts it. */
  canValidate: boolean;
  /** Circuit line under the status (EN source): "Awaiting PM validation", "Approval circuit started · Pending sync with Codex"…; null when none. */
  codexNote: string | null;
}

export interface EngCheckRow {
  number: string;
  rulePair: string;
  ruleLabel: string;
  severity: CheckSeverity;
  severityLabel: string;
  title: string;
  detail: string;
  owner: Discipline;
  ownerLabel: string;
  /** Lead of the owning discipline. */
  lead: string;
  status: CheckStatus;
  statusLabel: string;
  open: boolean;
  note: string;
}

export interface EngOutputRow {
  number: string;
  discipline: Discipline;
  name: string;
  recipients: DocRecipient[];
  source: string;
  /** Derived state (Blocked → Ready without open blocking check). */
  state: OutputState;
  stateLabel: string;
  /** Open blocking checks of the discipline when Blocked. */
  blockingChecks: number;
  generatedAt: string | null;
  generatedFormat: string | null;
}

export interface EngineeringRegister {
  projectCode: string;
  disciplines: EngDisciplineRow[];
  inputs: EngInputRow[];
  deliverables: EngDeliverableRow[];
  checks: EngCheckRow[];
  outputs: EngOutputRow[];
  changes: { changedOn: string; text: string; recipients: DocRecipient[] }[];
  /** Import wizard reference data. */
  tools: { position: number; label: string; discipline: Discipline }[];
  mappings: { sourceColumn: string; targetField: string }[];
  deltas: { kind: 'new' | 'changed'; label: string }[];
  imports: { consumer: Discipline; documentNumber: string; revision: string; fileName: string; importedBy: string; importedAt: string }[];
}

/** Rule labels (ENG_RULES) and discipline referents (ENG_DISC). */
async function reference() {
  const db = await getDb();
  const [rules, discs, tools, maps, deltas] = await Promise.all([
    db.select().from(engConsistencyRules).orderBy(asc(engConsistencyRules.position)),
    db.select().from(engDisciplines).orderBy(asc(engDisciplines.position)),
    db.select().from(engImportTools).orderBy(asc(engImportTools.position)),
    db.select().from(engColumnMappings).orderBy(asc(engColumnMappings.position)),
    db.select().from(engImportDeltas).orderBy(asc(engImportDeltas.position)),
  ]);
  return { rules, discs, tools, maps, deltas };
}

/** The engineering register of a project; null when the project has none (the screens' empty state). */
export async function getEngineeringRegister(projectCode: string): Promise<EngineeringRegister | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [inputs, checks, outputs, changes, imports] = await Promise.all([
    db.select().from(engInputs).where(eq(engInputs.projectId, p.id)).orderBy(asc(engInputs.position)),
    db.select().from(engChecks).where(eq(engChecks.projectId, p.id)).orderBy(asc(engChecks.position)),
    db.select().from(engOutputs).where(eq(engOutputs.projectId, p.id)).orderBy(asc(engOutputs.position)),
    db.select().from(engChanges).where(eq(engChanges.projectId, p.id)).orderBy(asc(engChanges.sortOrder)),
    db.select().from(engImports).where(eq(engImports.projectId, p.id)).orderBy(desc(engImports.importedAt)),
  ]);
  if (!inputs.length && !checks.length && !outputs.length) return null;
  const [ref, docs] = await Promise.all([reference(), listProjectDocuments(projectCode)]);
  const ruleLabel = new Map(ref.rules.map((r) => [r.pair, r.label]));
  const leadOf = new Map(ref.discs.map((d) => [d.code, d.leadName]));
  // Engineering deliverables (ENG_DOCS): the project's discipline records distributed to other services (with recipients).
  const engDocs = docs.filter((d) => d.project === projectCode && (DISCIPLINES as readonly string[]).includes(d.service) && d.recipients.length > 0);
  const docByNumber = new Map(docs.map((d) => [d.number, d]));
  const checkRows: EngCheckRow[] = checks.map((c) => ({
    number: c.number, rulePair: c.rulePair, ruleLabel: ruleLabel.get(c.rulePair) ?? c.rulePair, severity: c.severity, severityLabel: checkSeverity.label(c.severity), title: c.title,
    detail: c.detail, owner: c.owner, ownerLabel: discipline.label(c.owner), lead: leadOf.get(c.owner) ?? '', status: c.status, statusLabel: checkStatus.label(c.status),
    open: isOpenCheck(c.status), note: c.resolutionNote,
  }));
  const blocking = (d: Discipline) => checkRows.filter((c) => c.open && c.severity === 'blocking' && c.owner === d).length;
  return {
    projectCode,
    disciplines: ref.discs.map((d) => ({ code: d.code, label: discipline.label(d.code), icon: d.icon, lead: d.leadName, tools: d.tools })),
    inputs: inputs.map((i) => {
      const doc = docByNumber.get(i.documentNumber);
      const internal = !!doc && (DISCIPLINES as readonly string[]).includes(doc.service);
      const latest = inputLatest(i.revisionInUse, doc);
      const outdated = i.revisionInUse !== latest;
      const state: InputState = outdated ? 'outdated' : i.acknowledged ? 'up_to_date' : 'to_confirm';
      const provider = (internal ? doc!.service : i.providerParty ?? 'client') as DocRecipient;
      return {
        consumer: i.consumer, documentNumber: i.documentNumber, title: doc?.title ?? i.externalTitle ?? i.documentNumber, provider, providerLabel: docRecipient.label(provider),
        revisionInUse: i.revisionInUse, latest, acknowledged: i.acknowledged, outdated, state, stateLabel: inputState.label(state), inCodex: !!doc,
      };
    }),
    deliverables: engDocs.map((d: VaultDocument) => {
      const nb = blocking(d.service as Discipline);
      return {
        number: d.number, title: d.title, discipline: d.service as Discipline, revision: d.revision, status: d.status, statusLabel: documentStatus.label(d.status), issuedOn: d.issuedOn,
        author: d.author, recipients: d.recipients, blockingChecks: nb, canFreeze: d.status === 'draft', canPropose: d.status === 'frozen' && !nb,
        proposeBlocked: d.status === 'frozen' && nb > 0, canValidate: d.status === 'release_proposed' && !d.circuitState.started, codexNote: d.circuitNote,
      };
    }),
    checks: checkRows,
    outputs: outputs.map((o) => {
      const nb = blocking(o.discipline);
      const state: OutputState = o.state === 'blocked' && !nb ? 'ready' : o.state;
      return {
        number: o.number, discipline: o.discipline, name: o.name, recipients: o.recipients, source: o.source, state, stateLabel: outputState.label(state),
        blockingChecks: state === 'blocked' ? nb : 0, generatedAt: o.generatedAt?.toISOString() ?? null, generatedFormat: o.generatedFormat,
      };
    }),
    changes: changes.map((c) => ({ changedOn: c.changedOn, text: c.text, recipients: c.recipients })),
    tools: ref.tools.map((t) => ({ position: t.position, label: t.label, discipline: t.discipline })),
    mappings: ref.maps.map((m) => ({ sourceColumn: m.sourceColumn, targetField: m.targetField })),
    deltas: ref.deltas.map((d) => ({ kind: d.kind, label: d.label })),
    imports: imports.map((x) => ({ consumer: x.consumer, documentNumber: x.documentNumber, revision: x.revision, fileName: x.fileName, importedBy: x.importedByName, importedAt: x.importedAt.toISOString() })),
  };
}

/** Open blocking checks per project and per owning discipline (Synthesis and discipline nav badges). */
export async function engBlockingByProject(): Promise<Record<string, Record<Discipline | 'total', number>>> {
  const db = await getDb();
  const rows = await db.select({ projectId: engChecks.projectId, owner: engChecks.owner, status: engChecks.status, severity: engChecks.severity }).from(engChecks);
  const codes = new Map((await db.select({ id: projects.id, code: projects.code }).from(projects)).map((p) => [p.id, p.code]));
  const out: Record<string, Record<Discipline | 'total', number>> = {};
  for (const r of rows) {
    if (r.severity !== 'blocking' || !isOpenCheck(r.status)) continue;
    const code = codes.get(r.projectId)!;
    out[code] ??= { total: 0, process: 0, meca: 0, elec: 0, auto: 0 };
    out[code].total++;
    out[code][r.owner]++;
  }
  return out;
}

// ── Writers ─────────────────────────────────────────────────────────────────────────────────────────────

const ENG = (actor: Actor) => requireWorkspace('eng', actor, 'Project engineering');

/** "Confirm" an input the discipline consumes (not outdated, not yet confirmed). */
export async function confirmEngInput(projectCode: string, consumer: Discipline, documentNumber: string, actor: Actor): Promise<void> {
  ENG(actor);
  const reg = await getEngineeringRegister(projectCode);
  const row = reg?.inputs.find((i) => i.consumer === consumer && i.documentNumber === documentNumber);
  if (!row) throw new Error(`Unknown input ${documentNumber} of ${consumer}`);
  if (row.outdated) throw new Error(`${documentNumber}: import the new revision first`);
  if (row.acknowledged) throw new Error(`${documentNumber} is already confirmed`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const who = await whoIs(tx, actor);
    const [i] = await tx.update(engInputs).set({ acknowledged: true, acknowledgedAt: new Date(), acknowledgedByPersonId: who.personId, updatedAt: new Date() })
      .where(and(eq(engInputs.projectId, p.id), eq(engInputs.consumer, consumer), eq(engInputs.documentNumber, documentNumber))).returning({ id: engInputs.id });
    await trace(tx, who, {
      objectRef: documentNumber, change: `consumption confirmed by ${discipline.label(consumer)} · rev ${row.revisionInUse}`, area: 'Engineering', entityType: 'eng_input', entityId: i.id, projectId: p.id,
    });
  });
}

/** "Resolve here" (→ Resolved, "Resolved in Keystone") or "Send back to tool" (→ Sent back, "closes on next import") on an open check. */
export async function closeEngCheck(projectCode: string, number: string, how: 'resolved' | 'sent_back', actor: Actor): Promise<void> {
  ENG(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [c] = await tx.select().from(engChecks).where(and(eq(engChecks.projectId, p.id), eq(engChecks.number, number)));
    if (!c) throw new Error(`Unknown check ${number} on ${projectCode}`);
    if (!isOpenCheck(c.status)) throw new Error(`${number} is ${checkStatus.label(c.status)}`);
    const who = await whoIs(tx, actor);
    const note = how === 'resolved' ? 'Resolved in Keystone' : 'Sent back to tool · closes on next import';
    await tx.update(engChecks).set({ status: how, resolutionNote: note, resolvedAt: new Date(), resolvedByName: who.who, updatedAt: new Date() }).where(eq(engChecks.id, c.id));
    await trace(tx, who, {
      objectRef: number, change: `status: ${checkStatus.label(c.status)} → ${checkStatus.label(how)} · ${note}`, area: 'Engineering', entityType: 'eng_check', entityId: c.id, projectId: p.id,
      activity: { text: `${how === 'resolved' ? 'Resolved' : 'Sent back'} ${number} · ${c.title}`, kind: 'change' },
    });
  });
}

/** "Generate xlsx" on an output that is not Blocked (simulated: records the generation, "Generated today · xlsx"). */
export async function generateEngOutput(projectCode: string, number: string, actor: Actor): Promise<void> {
  ENG(actor);
  const reg = await getEngineeringRegister(projectCode);
  const o = reg?.outputs.find((x) => x.number === number);
  if (!o) throw new Error(`Unknown output ${number} on ${projectCode}`);
  if (o.state === 'blocked') throw new Error(`${number} is blocked by ${o.blockingChecks} blocking inconsistencies`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const who = await whoIs(tx, actor);
    const [row] = await tx.update(engOutputs).set({ generatedAt: new Date(), generatedFormat: 'xlsx', generatedByName: who.who })
      .where(and(eq(engOutputs.projectId, p.id), eq(engOutputs.number, number))).returning({ id: engOutputs.id });
    await trace(tx, who, { objectRef: `${number} · ${o.name}`, change: 'generated · xlsx', area: 'Engineering', entityType: 'eng_output', entityId: row.id, projectId: p.id });
  });
}

async function engDeliverable(projectCode: string, number: string): Promise<EngDeliverableRow> {
  const reg = await getEngineeringRegister(projectCode);
  const d = reg?.deliverables.find((x) => x.number === number);
  if (!d) throw new Error(`${number} is not an engineering deliverable of ${projectCode}`);
  return d;
}

/** "Freeze" an own deliverable (Draft → Frozen, in Codex). */
export async function freezeEngDeliverable(projectCode: string, number: string, actor: Actor): Promise<void> {
  ENG(actor);
  await engDeliverable(projectCode, number);
  await freezeDocument(number, actor.name);
}

/** "Propose release" (Frozen → Release proposed), refused while the discipline owns an open blocking check. */
export async function proposeEngRelease(projectCode: string, number: string, actor: Actor): Promise<void> {
  ENG(actor);
  const d = await engDeliverable(projectCode, number);
  if (d.blockingChecks) throw new Error(`Release blocked · ${d.blockingChecks} blocking`);
  await proposeDocumentRelease(number, actor.name);
}

/**
 * "Validate release (PM)" (Delivery 7, P-7c = a, R-106): the project's PM or the director starts the document type's
 * approval circuit in Codex (outbox, "pending sync with Codex"). The deliverable stays Release proposed; Codex
 * releases it once every step is approved (withdrawing the previous revision, the client acknowledging again).
 */
export async function validateEngRelease(projectCode: string, number: string, actor: Actor, at: Date = new Date()): Promise<{ entryId: string }> {
  ENG(actor);
  await engDeliverable(projectCode, number);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (!(await managesProject(tx, actor, p.pmPersonId))) throw new Error('Only the project manager validates releases');
    const { entryId } = await recordCircuitStart(tx, number, { name: actor.name, role: actor.role }, at);
    return { entryId };
  });
}

export interface EngImportInput {
  consumer: Discipline;
  documentNumber: string;
  /** Position of the source tool (ENG_TOOLS). */
  toolPosition: number;
}

/**
 * Import wizard "Import · freeze this revision as input": the consumer's input becomes the document's current revision
 * (to confirm); the instrument list also updates the consumer's P&ID input; the consumer's revision-alignment checks
 * not resolved yet (open, in progress, sent back) close ("Closed by import of rev D"). Returns the revision and the
 * checks closed.
 */
export async function importEngList(projectCode: string, input: EngImportInput, actor: Actor): Promise<{ revision: string; closedChecks: string[] }> {
  ENG(actor);
  if (!(DISCIPLINES as readonly string[]).includes(input.consumer)) throw new Error('Invalid discipline');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [tool] = await tx.select().from(engImportTools).where(eq(engImportTools.position, input.toolPosition));
    if (!tool) throw new Error('Unknown source tool');
    const [doc] = await tx.select({ id: documents.id, rev: documents.currentRevision, projectId: documents.projectId, typeCode: documents.typeCode, service: documents.service })
      .from(documents).where(eq(documents.number, input.documentNumber));
    if (!doc || doc.projectId !== p.id) throw new Error(`Unknown document ${input.documentNumber} on ${projectCode}`);
    if (doc.service === input.consumer) throw new Error(`${input.documentNumber} is a deliverable of ${discipline.label(input.consumer)}, not an input`);
    const who = await whoIs(tx, actor);
    const setInput = async (tx2: Tx, number: string, rev: string, documentId: string) => {
      const [cur] = await tx2.select({ id: engInputs.id }).from(engInputs).where(and(eq(engInputs.projectId, p.id), eq(engInputs.consumer, input.consumer), eq(engInputs.documentNumber, number)));
      if (cur) await tx2.update(engInputs).set({ revisionInUse: rev, acknowledged: false, acknowledgedAt: null, acknowledgedByPersonId: null, updatedAt: new Date() }).where(eq(engInputs.id, cur.id));
      else {
        const all = await tx2.select({ pos: engInputs.position }).from(engInputs).where(eq(engInputs.projectId, p.id));
        await tx2.insert(engInputs).values({
          projectId: p.id, consumer: input.consumer, documentNumber: number, documentId, revisionInUse: rev, acknowledged: false, position: all.reduce((m, x) => Math.max(m, x.pos + 1), 0),
        });
      }
    };
    await setInput(tx, input.documentNumber, doc.rev, doc.id);
    if (input.documentNumber.startsWith('LST-INS-')) {
      const [pidDoc] = await tx.select({ id: documents.id, number: documents.number, rev: documents.currentRevision }).from(documents)
        .where(and(eq(documents.projectId, p.id), eq(documents.typeCode, 'PID')));
      if (pidDoc) await setInput(tx, pidDoc.number, pidDoc.rev, pidDoc.id);
    }
    // Revision-alignment checks of the consumer not resolved yet: open, in progress or sent back ("closes on next import").
    const open = await tx.select().from(engChecks).where(and(eq(engChecks.projectId, p.id), eq(engChecks.owner, input.consumer), eq(engChecks.rulePair, 'revision'), inArray(engChecks.status, [...CLOSED_BY_IMPORT])));
    const note = `Closed by import of rev ${doc.rev}`;
    for (const c of open) await tx.update(engChecks).set({ status: 'resolved', resolutionNote: note, resolvedAt: new Date(), resolvedByName: who.who, updatedAt: new Date() }).where(eq(engChecks.id, c.id));
    const fileName = `${input.documentNumber}_rev${doc.rev}.xlsx`;
    await tx.insert(engImports).values({
      projectId: p.id, consumer: input.consumer, documentNumber: input.documentNumber, revision: doc.rev, toolPosition: tool.position, fileName, rows: 27,
      importedByName: who.who, importedByPersonId: who.personId, importedAt: new Date(),
    });
    await trace(tx, who, {
      objectRef: input.documentNumber, change: `imported rev ${doc.rev} for ${discipline.label(input.consumer)} (${tool.label})${open.length ? ` · closed ${open.map((c) => c.number).join(', ')}` : ''}`,
      area: 'Engineering', entityType: 'eng_import', projectId: p.id, activity: { text: `Imported ${input.documentNumber} rev ${doc.rev} · ${discipline.label(input.consumer)}`, kind: 'sync' },
    });
    return { revision: doc.rev, closedChecks: open.map((c) => c.number) };
  });
}
