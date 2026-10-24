import 'server-only';
// R-187 (Arche K-02, K-03, K-10): the "Subsidiaries' machine needs" card of Portfolio › Projects — the needs mirrored from Arche
// (capex connector, src/server/integrations/capex/), Keystone's answers (need_answers, published by pub_reponses_besoins) and the
// project created, or the equipment line added, at the order. Rules: src/domain/capex-needs.ts. The Server Functions
// (src/features/capex-needs/actions.ts) check the viewer and parse the input; every writer here checks the role again and parses
// again, writes one audit row and one activity event in its transaction.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  ANSWER_NATURE_LABEL, ANSWER_STATUS_LABEL, CAPEX_NEEDS_DIRECTOR_ONLY, answerEditable, answerNeedBlocker, answerTransitionBlocker, canAnswerCapexNeeds, defaultNeedAmount,
  latestAnswerOf, needEquipmentLine, nextAnswerNumber, orderActionBlocker, parseNeedAnswer, type AnswerStatus, type NeedCatalogueEntry, type NeedRecord,
  type NeedStatus, type OfferNature, type Qualification,
} from '@/domain/capex-needs';
import { catalogueChoiceValue, catalogueRef } from '@/domain/machine-catalogue';
import { systemMessage } from '@/domain/system-messages';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { machineType, type EstimateClass } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { capexMirror, capexNeeds, machineCatalogueEntries, machineTypes, needAnswers, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { archeSource, type ArcheSource } from '@/server/integrations/capex/config';
import { lastCapexRuns } from '@/server/integrations/capex/mirror';
import { addProjectEquipment } from './project-equipment';
import { createWizardProject, type CreatedProject, type WizardCreateInput } from './projects-register';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface NeedAnswerRow {
  id: string;
  number: string;
  needRef: string;
  capexCode: string;
  nature: OfferNature;
  qualification: Qualification;
  /** Typed text (dataText). */
  reason: string | null;
  estimateClass: EstimateClass | null;
  centralKeur: number | null;
  lowKeur: number | null;
  highKeur: number | null;
  leadTimeWeeks: number | null;
  validUntil: string | null;
  documentRef: string | null;
  projectCode: string | null;
  status: AnswerStatus;
  /** ISO timestamp (repondu_le). */
  answeredAt: string;
  answeredByName: string;
}

export interface InboxCapex {
  code: string;
  title: string;
  subsidiaryCode: string | null;
  subsidiaryName: string | null;
  site: string | null;
  countryIso2: string | null;
  phaseCode: string | null;
  g2On: string | null;
}

export interface InboxCatalogue extends NeedCatalogueEntry {
  status: 'draft' | 'published' | 'retired';
  /** Display code of the machine type ("EMP", "R&D"). */
  typeLabel: string;
}

export interface InboxNeed extends NeedRecord {
  capex: InboxCapex | null;
  catalogue: InboxCatalogue | null;
  /** Latest first. */
  answers: NeedAnswerRow[];
  latest: NeedAnswerRow | null;
  /** The EPC2i project delivering the need (K-10), from its answers. */
  projectCode: string | null;
  /** Default central amount of a new answer (catalogue price × quantity, E50), null without catalogue price. */
  defaultAmount: number | null;
}

export interface NeedsInbox {
  needs: InboxNeed[];
  source: ArcheSource;
  /** Last read of Arche's views (any outcome), and the last successful one — ISO. */
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastRunError: string | null;
  lastOkAt: string | null;
}

const toAnswer = (a: typeof needAnswers.$inferSelect, projectCode: string | null): NeedAnswerRow => ({
  id: a.id, number: a.number, needRef: a.needRef, capexCode: a.capexCode, nature: a.nature, qualification: a.qualification, reason: a.reason,
  estimateClass: a.estimateClass, centralKeur: a.centralKeur, lowKeur: a.lowKeur, highKeur: a.highKeur, leadTimeWeeks: a.leadTimeWeeks, validUntil: a.validUntil,
  documentRef: a.documentRef, projectCode, status: a.status, answeredAt: a.answeredAt.toISOString(), answeredByName: a.answeredByName,
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toNeed = (n: typeof capexNeeds.$inferSelect): NeedRecord => ({
  needRef: n.needRef, capexCode: n.capexCode, line: n.line, catalogueCode: n.catalogueCode, catalogueVersion: n.catalogueVersion, freeLabel: n.freeLabel,
  quantity: n.quantity, options: n.options ?? [], targetCapacity: n.targetCapacity, capacityUnit: n.capacityUnit, neededOn: n.neededOn, site: n.site,
  status: n.status as NeedStatus, comment: n.comment, submittedAt: iso(n.submittedAt), orderedOn: n.orderedOn, sourceUpdatedAt: iso(n.sourceUpdatedAt),
});

const typeLabelOf = (code: string, label: string | null) => label ?? (machineType.isCode(code) ? machineType.label(code) : code);

/** The catalogue versions the needs reference (any status), by "code@version". */
async function catalogueOf(q: Q, needs: readonly NeedRecord[]): Promise<Map<string, InboxCatalogue>> {
  const codes = [...new Set(needs.map((n) => n.catalogueCode).filter((c): c is string => !!c))];
  if (!codes.length) return new Map();
  const rows = await q
    .select({ e: machineCatalogueEntries, typeLabel: machineTypes.label })
    .from(machineCatalogueEntries)
    .leftJoin(machineTypes, eq(machineTypes.code, machineCatalogueEntries.machineTypeCode))
    .where(inArray(machineCatalogueEntries.code, codes));
  return new Map(rows.map((r) => [catalogueChoiceValue(r.e.code, r.e.version), {
    code: r.e.code, version: r.e.version, machineTypeCode: r.e.machineTypeCode, label: r.e.label, options: r.e.options ?? [], nominalCapacity: r.e.nominalCapacity,
    capacityUnit: r.e.capacityUnit, indicativePriceKeur: r.e.indicativePriceKeur, status: r.e.status, typeLabel: typeLabelOf(r.e.machineTypeCode, r.typeLabel),
  }]));
}

const catalogueKey = (n: Pick<NeedRecord, 'catalogueCode' | 'catalogueVersion'>) => (n.catalogueCode && n.catalogueVersion ? catalogueChoiceValue(n.catalogueCode, n.catalogueVersion) : null);

async function answersOf(q: Q, needRefs?: string[]): Promise<NeedAnswerRow[]> {
  const rows = await q
    .select({ a: needAnswers, projectCode: projects.code })
    .from(needAnswers)
    .leftJoin(projects, eq(projects.id, needAnswers.projectId))
    .where(needRefs ? inArray(needAnswers.needRef, needRefs.length ? needRefs : ['']) : undefined)
    .orderBy(desc(needAnswers.answeredAt), desc(needAnswers.number));
  return rows.map((r) => toAnswer(r.a, r.projectCode));
}

/** The card: every mirrored need (submitted first, then ordered, then withdrawn; by CAPEX and line) with its CAPEX and answers. */
export async function getNeedsInbox(): Promise<NeedsInbox> {
  const db = await getDb();
  const [needRows, capexRows, answers, runs] = await Promise.all([
    db.select().from(capexNeeds).orderBy(asc(capexNeeds.capexCode), asc(capexNeeds.line)),
    db.select().from(capexMirror),
    answersOf(db),
    lastCapexRuns(db),
  ]);
  const needs = needRows.map(toNeed);
  const catalogue = await catalogueOf(db, needs);
  const capex = new Map(capexRows.map((c) => [c.code, c]));
  const rank: Record<NeedStatus, number> = { submitted: 0, ordered: 1, withdrawn: 2 };
  const out: InboxNeed[] = needs.map((n) => {
    const own = answers.filter((a) => a.needRef === n.needRef);
    const c = capex.get(n.capexCode);
    const entry = catalogue.get(catalogueKey(n) ?? '') ?? null;
    return {
      ...n,
      capex: c ? { code: c.code, title: c.title, subsidiaryCode: c.subsidiaryCode, subsidiaryName: c.subsidiaryName, site: c.site, countryIso2: c.countryIso2, phaseCode: c.phaseCode, g2On: c.g2On } : null,
      catalogue: entry, answers: own, latest: latestAnswerOf(own).get(n.needRef) ?? null, projectCode: own.find((a) => a.projectCode)?.projectCode ?? null,
      defaultAmount: defaultNeedAmount(n, entry),
    };
  });
  out.sort((a, b) => rank[a.status] - rank[b.status] || a.capexCode.localeCompare(b.capexCode) || a.line.localeCompare(b.line));
  return {
    needs: out, source: archeSource(), lastRunAt: iso(runs.last?.syncedAt ?? null), lastRunOk: runs.last ? runs.last.ok : null, lastRunError: runs.last?.error ?? null,
    lastOkAt: iso(runs.lastOk?.syncedAt ?? null),
  };
}

/** Answers published to Arche (tests, exports): every row, latest first. */
export const listNeedAnswers = async (): Promise<NeedAnswerRow[]> => answersOf(await getDb());

async function needOf(q: Q, needRef: string): Promise<NeedRecord | null> {
  const [n] = await q.select().from(capexNeeds).where(eq(capexNeeds.needRef, needRef));
  return n ? toNeed(n) : null;
}

/** One mirrored need with its catalogue version and CAPEX (the project creation's prefill). */
export async function getInboxNeed(needRef: string): Promise<InboxNeed | null> {
  return (await getNeedsInbox()).needs.find((n) => n.needRef === needRef) ?? null;
}

function requireDirector(actor: Actor): void {
  if (!canAnswerCapexNeeds(actor.role)) throw new Error(CAPEX_NEEDS_DIRECTOR_ONLY);
}

async function whoOf(tx: Tx, actor: Actor) {
  const p = await findPerson(tx, actor.name);
  return { actorName: p ? nameOf(p) : actor.name, actorPersonId: p?.id ?? null };
}

const plain = (a: Partial<typeof needAnswers.$inferSelect>) => ({
  nature: a.nature, qualification: a.qualification, reason: a.reason ?? null, estimateClass: a.estimateClass ?? null, centralKeur: a.centralKeur ?? null,
  lowKeur: a.lowKeur ?? null, highKeur: a.highKeur ?? null, leadTimeWeeks: a.leadTimeWeeks ?? null, validUntil: a.validUntil ?? null, documentRef: a.documentRef ?? null,
  status: a.status,
});

/**
 * Records a new answer (status "in preparation") to a mirrored need that is not withdrawn. The project of the need's previous
 * answers (K-10) is carried over, so the most recent answer still names it. Returns the answer number.
 */
export async function createNeedAnswer(needRef: string, input: Record<string, unknown>, actor: Actor): Promise<string> {
  requireDirector(actor);
  const parsed = parseNeedAnswer(input, await businessToday());
  if (!parsed.ok) throw new Error(parsed.error);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const need = await needOf(tx, needRef);
    const blocker = answerNeedBlocker(need);
    if (blocker) throw new Error(blocker);
    const existing = await tx.select({ number: needAnswers.number }).from(needAnswers);
    const number = nextAnswerNumber(existing.map((r) => r.number));
    const [carried] = await tx.select({ projectId: needAnswers.projectId }).from(needAnswers)
      .where(and(eq(needAnswers.needRef, needRef))).orderBy(desc(needAnswers.answeredAt), desc(needAnswers.number)).limit(1);
    const who = await whoOf(tx, actor);
    const now = new Date();
    const [row] = await tx.insert(needAnswers).values({
      number, needRef, capexCode: need!.capexCode, ...parsed.value, projectId: carried?.projectId ?? null, status: 'en_cours', answeredAt: now,
      answeredByPersonId: who.actorPersonId, answeredByName: who.actorName, createdAt: now, updatedAt: now,
    }).returning({ id: needAnswers.id });
    const message = systemMessage('needAnswer.recorded', { number, need: needRef, nature: ANSWER_NATURE_LABEL[parsed.value.nature] });
    await writeAudit(tx, { ...who, objectRef: `${number} · ${needRef}`, message, area: 'Projects', entityType: 'need_answer', entityId: row.id, after: plain({ ...parsed.value, status: 'en_cours' }) });
    await recordActivity(tx, { ...who, message, kind: 'change' });
    return number;
  });
}

async function answerOf(tx: Tx, number: string) {
  const [a] = await tx.select().from(needAnswers).where(eq(needAnswers.number, number)).for('update');
  if (!a) throw new Error('Unknown answer');
  return a;
}

/** Edits an answer in preparation (a sent answer is final: record a new one). No change → no write. */
export async function updateNeedAnswer(number: string, input: Record<string, unknown>, actor: Actor): Promise<void> {
  requireDirector(actor);
  const parsed = parseNeedAnswer(input, await businessToday());
  if (!parsed.ok) throw new Error(parsed.error);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const a = await answerOf(tx, number);
    if (!answerEditable(a.status)) throw new Error('Only an answer in preparation is edited: record a new answer');
    const before = plain(a);
    const after = plain({ ...a, ...parsed.value });
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx.update(needAnswers).set({ ...parsed.value, updatedAt: new Date() }).where(eq(needAnswers.id, a.id));
    const who = await whoOf(tx, actor);
    const message = systemMessage('needAnswer.edited', { number, need: a.needRef });
    await writeAudit(tx, { ...who, objectRef: `${number} · ${a.needRef}`, message, area: 'Projects', entityType: 'need_answer', entityId: a.id, before, after });
  });
}

/** Moves an answer: in preparation → sent (dated: repondu_le) or lapsed; sent → accepted or lapsed (`answerTransitionBlocker`). */
export async function setNeedAnswerStatus(number: string, to: AnswerStatus, actor: Actor): Promise<void> {
  requireDirector(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const a = await answerOf(tx, number);
    const blocker = answerTransitionBlocker(a, to);
    if (blocker) throw new Error(blocker);
    const now = new Date();
    await tx.update(needAnswers).set({ status: to, ...(to === 'remise' ? { answeredAt: now } : {}), updatedAt: now }).where(eq(needAnswers.id, a.id));
    const who = await whoOf(tx, actor);
    const message = systemMessage('needAnswer.status', { number, need: a.needRef, from: ANSWER_STATUS_LABEL[a.status], to: ANSWER_STATUS_LABEL[to] });
    await writeAudit(tx, { ...who, objectRef: `${number} · ${a.needRef}`, message, area: 'Projects', entityType: 'need_answer', entityId: a.id, before: { status: a.status }, after: { status: to } });
    await recordActivity(tx, { ...who, message, kind: 'change' });
  });
}

/** The project already delivering a need (an answer carries it), or null. */
async function placedOn(q: Q, needRef: string): Promise<string | null> {
  const [r] = await q.select({ code: projects.code }).from(needAnswers).innerJoin(projects, eq(projects.id, needAnswers.projectId)).where(eq(needAnswers.needRef, needRef)).limit(1);
  return r?.code ?? null;
}

/** The ordered need, its catalogue version and its equipment line, checked for an order action (K-10). */
async function orderedNeed(q: Q, needRef: string, typeIfFree?: string | null) {
  const need = await needOf(q, needRef);
  const blocker = orderActionBlocker(need, await placedOn(q, needRef));
  if (blocker) throw new Error(blocker);
  const entry = (await catalogueOf(q, [need!])).get(catalogueKey(need!) ?? '') ?? null;
  if (need!.catalogueCode && !entry) throw new Error('Unknown catalogue entry');
  const line = needEquipmentLine(need!, entry, typeIfFree);
  if (!line) throw new Error('Choose the machine type of this free need');
  return { need: need!, entry, line };
}

/**
 * K-10: the need is now delivered by `projectId` — the need's answers point at it (pub_reponses_besoins.projet_code), a sent answer
 * of the need becomes accepted (the order is its acceptance), and the project takes the CAPEX link when it has none. In the
 * creating transaction.
 */
async function placeNeed(tx: Tx, need: NeedRecord, projectId: string, who: { actorName: string; actorPersonId: string | null }): Promise<void> {
  const answers = await tx.select().from(needAnswers).where(eq(needAnswers.needRef, need.needRef)).orderBy(desc(needAnswers.answeredAt), desc(needAnswers.number));
  if (!answers.length) throw new Error('Record Keystone’s answer to this need first: the project code is published with it');
  const now = new Date();
  await tx.update(needAnswers).set({ projectId, updatedAt: now }).where(eq(needAnswers.needRef, need.needRef));
  const latest = answers[0];
  if (latest.status === 'remise' && (latest.nature === 'devis' || latest.nature === 'offre_ferme')) {
    await tx.update(needAnswers).set({ status: 'acceptee', updatedAt: now }).where(eq(needAnswers.id, latest.id));
    const message = systemMessage('needAnswer.status', { number: latest.number, need: need.needRef, from: ANSWER_STATUS_LABEL.remise, to: ANSWER_STATUS_LABEL.acceptee });
    await writeAudit(tx, { ...who, objectRef: `${latest.number} · ${need.needRef}`, message, area: 'Projects', entityType: 'need_answer', entityId: latest.id, before: { status: 'remise' }, after: { status: 'acceptee' } });
  }
  const [p] = await tx.select({ capexCode: projects.capexCode }).from(projects).where(eq(projects.id, projectId));
  if (p && !p.capexCode) await tx.update(projects).set({ capexCode: need.capexCode, besoinRef: need.needRef, updatedAt: now }).where(eq(projects.id, projectId));
}

/** The wizard's input from the director's draft, without the lines: the need gives the first line (K-10). */
export type NeedProjectInput = Omit<WizardCreateInput, 'equipments' | 'capexLink' | 'afterCreate' | 'machineType'> & {
  /** The draft's lines after the first (the need's) — other equipment of the project, if any. */
  otherLines?: WizardCreateInput['equipments'];
  /** Machine type of a free need (no catalogue entry): chosen in the wizard. */
  typeIfFree?: string | null;
};

/**
 * K-10, (a): creates the EPC2i project from an ordered need with the wizard's creation path (`createWizardProject`): EQ-01 = the
 * need's equipment line (type from its catalogue version, quantity, options, capacity, besoin_ref, catalogue code and version),
 * the project's CAPEX link set, and — in the same transaction — the need's answers pointing at the project. Never automatic.
 */
export async function createProjectFromNeed(needRef: string, input: NeedProjectInput, actor: Actor): Promise<CreatedProject> {
  requireDirector(actor);
  const db = await getDb();
  const { need, line } = await orderedNeed(db, needRef, input.typeIfFree);
  const mt = line.machineTypeCode as WizardCreateInput['machineType'];
  if (input.templateCode !== 'blank' && input.templateCode !== mt) throw new Error('The template is the machine type of the need');
  return createWizardProject({
    ...input,
    machineType: mt,
    equipments: [
      {
        machineType: mt, quantity: line.quantity, catalogueCode: line.catalogueCode, catalogueVersion: line.catalogueVersion, keepCatalogue: true, label: line.label,
        capacityValue: line.capacityValue, capacityUnit: line.capacityUnit, options: line.options, besoinRef: line.besoinRef,
      },
      ...(input.otherLines ?? []),
    ],
    capexLink: { capexCode: need.capexCode, needRef: need.needRef },
    actorName: actor.name,
    afterCreate: async (tx, created) => {
      // Checked again inside the transaction: two directors creating from the same need, one wins.
      const again = orderActionBlocker(await needOf(tx, needRef), await placedOn(tx, needRef));
      if (again) throw new Error(again);
      await placeNeed(tx, need, created.projectId, created.who);
      const message = systemMessage('needAnswer.projectCreated', { need: needRef, project: created.code });
      await writeAudit(tx, { ...created.who, objectRef: `${created.code} · ${needRef}`, message, area: 'Projects', entityType: 'project', entityId: created.projectId, projectId: created.projectId,
        after: { capexCode: need.capexCode, besoinRef: needRef } });
      await recordActivity(tx, { ...created.who, message, kind: 'change', projectId: created.projectId });
    },
  });
}

/**
 * K-10, (b): adds the ordered need's equipment line to an existing project (the Contract screen's "Add equipment line" path,
 * R-185), with its ITP plan; the need's answers point at the project and the project takes the CAPEX link when it has none.
 * Returns the line reference (EQ-0n).
 */
export async function addNeedToProject(needRef: string, projectCode: string, typeIfFree: string | null, actor: Actor): Promise<string> {
  requireDirector(actor);
  const db = await getDb();
  const { need, line } = await orderedNeed(db, needRef, typeIfFree);
  const [p] = await db.select({ stage: projects.stage }).from(projects).where(eq(projects.code, projectCode));
  if (!p) throw new Error('Unknown project');
  if (p.stage === 'clos' || p.stage === 'annule') throw new Error('Choose a project that is not closed or cancelled');
  return addProjectEquipment(projectCode, {
    machineTypeCode: line.machineTypeCode, quantity: line.quantity, label: line.label ?? '', capacityValue: line.capacityValue, capacityUnit: line.capacityUnit ?? '',
    options: line.options, besoinRef: line.besoinRef, catalogue: line.catalogueCode && line.catalogueVersion ? catalogueChoiceValue(line.catalogueCode, line.catalogueVersion) : '',
  }, actor, {
    keepCatalogue: true,
    afterAdd: async (tx, added) => {
      const again = orderActionBlocker(await needOf(tx, needRef), await placedOn(tx, needRef));
      if (again) throw new Error(again);
      await placeNeed(tx, need, added.projectId, added.who);
      const message = systemMessage('needAnswer.lineAdded', { need: needRef, project: projectCode, ref: added.ref });
      await writeAudit(tx, { ...added.who, objectRef: `${projectCode} · ${needRef}`, message, area: 'Projects', entityType: 'project_equipment', entityId: added.lineId, projectId: added.projectId,
        after: { besoinRef: needRef, catalogue: line.catalogueCode && line.catalogueVersion ? catalogueRef(line.catalogueCode, line.catalogueVersion) : null } });
      await recordActivity(tx, { ...added.who, message, kind: 'change', projectId: added.projectId });
    },
  });
}

/** Projects an ordered need may be added to (not closed nor cancelled), register order. */
export async function listOpenProjects(): Promise<{ code: string; name: string }[]> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, name: projects.name, stage: projects.stage }).from(projects).orderBy(asc(projects.sortOrder));
  return rows.filter((r) => r.stage !== 'clos' && r.stage !== 'annule').map((r) => ({ code: r.code, name: r.name }));
}
