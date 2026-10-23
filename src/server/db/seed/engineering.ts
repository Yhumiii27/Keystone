// Engineering seed (docs/spec/11 §8.5): the engineering register of HLT-026 (ENG_DISC, ENG_INPUTS, ENG_RULES, ENG_CHECKS,
// ENG_OUTPUTS, ENG_CHANGES, ENG_TOOLS, ENG_MAP, ENG_DELTAS 3736–3746 — the deliverables ENG_DOCS are Codex records,
// seeded by seed/documents.ts), the P&ID under validation (PID, PID_TAGS, PID_STEPS 3583–3611) and the machine-type
// aggregate edited on the Machine types screen (NP_TEMPLATES phases / cost categories / description / calendar,
// ITP_TEMPLATES systems). The prototype keys the register and the P&ID to HLT-026 (PID.code; ENG_* are Harbor Line's).
import { eq } from 'drizzle-orm';
import { isPerEquipmentPhase } from '@/domain/project-equipment';
import { PROTO } from '@/server/prototype';
import {
  bomScope, calendar, checkSeverity, checkStatus, costType, discipline, drawingState, isoOfDemoDate, machineType, outputState, pidTagKind,
  type Discipline, type DocRecipient, type PidRole, type PlcType, type StepState,
} from '../codes';
import {
  engChanges, engChecks, engColumnMappings, engConsistencyRules, engDisciplines, engImportDeltas, engImportTools, engInputs, engOutputs, machineTypeCostCategories,
  machineTypeItpSystems, machineTypePhases, machineTypes, pidSheets, pidTags, pidValidationSteps,
} from '../schema';
import type { Tx } from '../types';
import { must, personIdOrNull, type SeedCtx } from './context';

interface ProtoInput { disc: Discipline; doc: string; rev: string; ack: boolean; from: string; title: string }
interface ProtoCheck { id: string; pair: string; sev: string; title: string; detail: string; disc: Discipline; status: string }
interface ProtoOutput { id: string; disc: Discipline; name: string; to: DocRecipient[]; source: string; state: string }
interface ProtoTag { tag: string; desc: string; kind: string; scope: string; ref: string; note: string; act: string; plc: string; fb: string; role: PidRole }

/** Project of the engineering register and of the P&ID (PID.code = HLT-026). */
export const ENG_PROJECT = 'HLT-026';

export async function seedEngineering(tx: Tx, ctx: SeedCtx): Promise<void> {
  const projectId = must(ctx.projectByCode, ENG_PROJECT, 'project');
  const acts = ctx.activity.get(ENG_PROJECT) ?? new Map<string, string>();

  await seedEngineeringReference(tx, (lead) => ({ leadName: lead, leadPersonId: personIdOrNull(ctx, lead) }));
  await tx.insert(engInputs).values((PROTO.ENG_INPUTS as ProtoInput[]).map((i, position) => ({
    projectId, consumer: i.disc, documentNumber: i.doc, documentId: ctx.document.get(i.doc) ?? null, providerParty: (i.from || null) as DocRecipient | null,
    externalTitle: i.title || null, revisionInUse: i.rev, acknowledged: i.ack, position,
  })));
  await tx.insert(engChecks).values((PROTO.ENG_CHECKS as ProtoCheck[]).map((c, position) => ({
    projectId, number: c.id, rulePair: c.pair, severity: checkSeverity.code(c.sev[0].toUpperCase() + c.sev.slice(1)), title: c.title, detail: c.detail, owner: c.disc,
    status: checkStatus.code(c.status), position,
  })));
  await tx.insert(engOutputs).values((PROTO.ENG_OUTPUTS as ProtoOutput[]).map((o, position) => ({
    projectId, number: o.id, discipline: o.disc, name: o.name, recipients: o.to, source: o.source, state: outputState.code(o.state), position,
  })));
  await tx.insert(engChanges).values((PROTO.ENG_CHANGES as [string, string, string][]).map(([date, text, rcp], sortOrder) => ({
    projectId, changedOn: isoOfDemoDate(date)!, text, recipients: rcp.split(',') as DocRecipient[], sortOrder,
  })));
  await tx.insert(engImportDeltas).values((PROTO.ENG_DELTAS as [string, string, string][]).map(([sym, label], position) => ({ position, kind: sym === '+' ? 'new' as const : 'changed' as const, label })));

  // P&ID under validation.
  const pid = PROTO.PID as { code: string; doc: string; rev: string; date: string; sheets: number; by: string; checker: string; status: string };
  const pidProjectId = must(ctx.projectByCode, pid.code, 'project');
  await tx.insert(pidSheets).values({
    projectId: pidProjectId, documentNumber: pid.doc, documentId: ctx.document.get(pid.doc) ?? null, revision: pid.rev, issuedOn: isoOfDemoDate(pid.date)!,
    sheetCount: pid.sheets, authorName: pid.by, authorPersonId: personIdOrNull(ctx, pid.by), checkerName: pid.checker, checkerPersonId: personIdOrNull(ctx, pid.checker),
    status: drawingState.code(pid.status),
  });
  const pidActs = ctx.activity.get(pid.code) ?? acts;
  await tx.insert(pidTags).values((PROTO.PID_TAGS as ProtoTag[]).map((t, position) => ({
    projectId: pidProjectId, tag: t.tag, description: t.desc, kind: pidTagKind.code(t.kind), scope: bomScope.code(t.scope), partRef: t.ref || null, note: t.note,
    activityCode: t.act, activityId: pidActs.get(t.act) ?? null, plcType: (t.plc || null) as PlcType | null, stateFeedback: t.fb, role: t.role, sheet: 1 + (position % 4), position,
  })));
  await tx.insert(pidValidationSteps).values((PROTO.PID_STEPS as [string, StepState, string, string][]).map(([label, state, date, who], position) => ({
    projectId: pidProjectId, position, label, state, dateOn: date && date !== '—' ? isoOfDemoDate(date) : null, who,
  })));

  await seedMachineTypeAggregate(tx);
}

/**
 * Engineering disciplines, consistency rules, import tools and column mapping — reference data of both seeds (R-011).
 * `lead` gives a discipline's lead: the prototype's person (demo) or none (production: "—", no fictitious people).
 */
export async function seedEngineeringReference(tx: Tx, lead: (name: string) => { leadName: string; leadPersonId: string | null }): Promise<void> {
  await tx.insert(engDisciplines).values(Object.entries(PROTO.ENG_DISC as Record<string, [string, string, string, string]>).map(([code, [label, icon, name, tools]], position) => {
    discipline.code(label);
    return { code: code as Discipline, icon, ...lead(name), tools, position };
  }));
  await tx.insert(engConsistencyRules).values(Object.entries(PROTO.ENG_RULES as Record<string, string>).map(([pair, label], position) => ({ pair, label, position })));
  await tx.insert(engImportTools).values((PROTO.ENG_TOOLS as [string, Discipline][]).map(([label, disc], position) => ({ position, label, discipline: disc })));
  await tx.insert(engColumnMappings).values((PROTO.ENG_MAP as [string, string][]).map(([sourceColumn, targetField], position) => ({ position, sourceColumn, targetField })));
}

/** Phases, cost categories, ITP systems, description and calendar of each machine type (MT_ALL 5085 sources). */
export async function seedMachineTypeAggregate(tx: Tx): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templates = PROTO.NP_TEMPLATES as any[];
  const itp = PROTO.ITP_TEMPLATES as Record<string, string[]>;
  for (const mt of PROTO.MACHINE_TYPES as string[]) {
    const code = machineType.code(mt);
    const t = templates.find((x) => x.mt === mt) ?? {};
    await tx.update(machineTypes).set({ description: t.desc ?? '', calendar: calendar.code(t.cal ?? 'Standard 5d · 8h') }).where(eq(machineTypes.code, code));
    const phases = (t.phases ?? []) as string[];
    // R-185: the phases specific to an equipment (generated once per equipment line by the wizard).
    if (phases.length) await tx.insert(machineTypePhases).values(phases.map((name, position) => ({ machineTypeCode: code, position, name, perEquipment: isPerEquipmentPhase(code, name) })));
    const cats = (t.cats ?? []) as [string, string, string][];
    if (cats.length)
      await tx.insert(machineTypeCostCategories).values(cats.map(([name, type, budget], position) => ({
        machineTypeCode: code, position, name, costType: costType.code(type), budgetKeur: parseFloat(budget),
      })));
    const systems = itp[mt] ?? [];
    if (systems.length) await tx.insert(machineTypeItpSystems).values(systems.map((name, position) => ({ machineTypeCode: code, position, name })));
  }
}
