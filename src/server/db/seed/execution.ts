// Project execution seed (docs/spec/11 §8.4): the inspection & test plan (ITP 3717) with its systems frozen from the
// template (ITP_TEMPLATES 3716, R-057 / E-9 'a'), the punch list — R-117 (A-6 'a'): one list per project, the ITP punch
// list (PUNCH 3718, origin Inspection, owner party Keystone) then the site punch list (SITE_PUNCH 3581, origin Site,
// category B) numbered after it (HLT-026: P-06…P-08) —, commissioning and the handover dossier (COMMISSIONING 3721),
// lessons learned, closure checklist and customer satisfaction (LESSONS / CLOSURE / SATISFACTION 3732–3734). Harbor Line
// only in the prototype; other projects get nothing. R-185 part 2: the prototype's plan, ITP punch items and commissioning
// systems belong to the project's main line (EQ-01); Harbor Line's EQ-02 (3 × MEMU) gets its own plan with two inspections,
// a punch item and a commissioning system (DEMO_EQ02) so the multi-equipment screens have something to show.
import { and, asc, eq } from 'drizzle-orm';
import { PROTO } from '@/server/prototype';
import {
  closureItemStatus, commissioningCellStatus, commissioningStep, handoverItemStatus, itpPointType, itpResult, itpStage, lessonStatus, lessonTheme, machineType,
  punchOwnerParty, punchSource, punchStatus, type PunchCategory, type PunchSource,
} from '../codes';
import {
  closureItems, commissioningSteps, commissioningSystems, handoverItems, itpInspections, itpPlanSystems, itpPlans, lessonsLearned, projectEquipments, punchItems,
  satisfactionScores,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';
import { forwardIso, optionalIso } from './dates';

type ItpRow = [string, string, string, string, string, string, string, string, string];
type PunchRow = [string, string, string, string, string, string, string, string];
type SitePunchRow = [string, string, string, string, string, string];

/** "ITP I-03" → itp + I-03; "Client inspection" → client_inspection. */
export function punchSourceOf(src: string): { source: PunchSource; inspection: string | null } {
  const m = /^ITP (I-\d+)$/.exec(src);
  return m ? { source: 'itp', inspection: m[1] } : { source: punchSource.code(src), inspection: null };
}

/**
 * R-185 part 2: the demo data of Harbor Line's second equipment line (EQ-02, 3 × MEMU — DEMO_EQUIPMENT_LINES): its ITP plan
 * (MEMU systems) with two inspections numbered after the prototype's (I-14, I-15), a punch item numbered after the site items
 * (P-09, category C: no badge or "Blocking A" changes) and a commissioning system after the prototype's six. Typed text, as
 * the prototype's rows (translated by the data dictionaries).
 */
export const DEMO_EQ02 = {
  project: 'HLT-026',
  ref: 'EQ-02',
  template: 'MEMU',
  inspections: [
    ['I-14', 'Structure', 'Dimensional check — module frames M1–M3', 'Review', 'Workshop', 'Drawing GA-HLT-026-M rev A', '18 Sep', 'Passed', ''],
    ['I-15', 'Hoist', 'Load test — hoists of modules M1–M3', 'Witness', 'FAT', 'EN 13001 · 1.25 × SWL', '12 Nov', 'Planned', ''],
  ] as ItpRow[],
  punch: { number: 'P-09', description: 'Cable gland missing — module M2 junction box', location: 'Electrical · module M2', category: 'C' as PunchCategory, source: 'Site walk', owner: 'S. Haddad', due: '6 Nov' },
  commissioning: { system: 'MEMU modules M1–M3', cells: ['Planned · 20 Nov', 'Planned · 27 Nov', 'Planned · 4 Dec', 'Planned · 12 Dec', 'Planned · 14 Jan'] },
};

/** The equipment line id of a project's line ("EQ-01"), null when the project has no such line. */
async function lineId(tx: Tx, projectId: string, ref?: string): Promise<string | null> {
  const rows = await tx.select({ id: projectEquipments.id, ref: projectEquipments.ref }).from(projectEquipments)
    .where(ref ? and(eq(projectEquipments.projectId, projectId), eq(projectEquipments.ref, ref)) : eq(projectEquipments.projectId, projectId))
    .orderBy(asc(projectEquipments.position), asc(projectEquipments.ref));
  return rows[0]?.id ?? null;
}

const inspectionRows = (planId: string, items: ItpRow[], customFrom: number, docId: (ref: string | null) => string | null) =>
  items.map(([number, system, name, type, stage, reference, date, status, doc], position) => {
    const result = itpResult.code(status);
    return {
      id: newId(), planId, number, system, name, pointType: itpPointType.code(type), stage: itpStage.code(stage), reference,
      plannedOn: optionalIso(date, result === 'passed' || result === 'failed'), result, recordRef: doc || null, recordDocumentId: docId(doc || null),
      isCustom: position >= customFrom, position,
    };
  });

export async function seedExecution(tx: Tx, ctx: SeedCtx): Promise<void> {
  const docId = (ref: string | null) => (ref ? ctx.document.get(ref) ?? null : null);

  // ITP plans and inspections.
  for (const [code, plan] of Object.entries(PROTO.ITP as Record<string, { tpl: string; custom: number; items: ItpRow[] }>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const planId = newId();
    // R-185 (choice 4): the prototype's plan is the main line's (EQ-01).
    const mainLine = await lineId(tx, projectId);
    await tx.insert(itpPlans).values({ id: planId, projectId, equipmentId: mainLine, machineTypeCode: machineType.code(plan.tpl) });
    // R-057 (E-9 'a'): the plan keeps the systems of its template. Copied from the prototype's templates, not the database —
    // the machine-type aggregate is seeded later (seedEngineering), also in the Delivery 5 backfill.
    const templates = PROTO.ITP_TEMPLATES as Record<string, string[]>;
    const systems = templates[plan.tpl]?.length ? templates[plan.tpl] : templates.AUTRE ?? [];
    if (systems.length) await tx.insert(itpPlanSystems).values([...new Set(systems)].map((name, position) => ({ planId, position, name })));
    const customFrom = plan.items.length - plan.custom;
    const inspections = inspectionRows(planId, plan.items, customFrom, docId);
    await tx.insert(itpInspections).values(inspections);
    const inspectionId = new Map(inspections.map((i) => [i.number, i.id]));

    // ITP punch list.
    const punch = (PROTO.PUNCH[code] ?? []) as PunchRow[];
    if (punch.length)
      await tx.insert(punchItems).values(punch.map(([number, description, location, cat, src, owner, due, status], position) => {
        const s = punchSourceOf(src);
        const st = punchStatus.code(status);
        return {
          projectId, register: 'itp' as const, number, description, location, category: cat as PunchCategory, source: s.source,
          sourceInspectionId: s.inspection ? inspectionId.get(s.inspection) ?? null : null, ownerName: owner, ownerPersonId: personIdOrNull(ctx, owner),
          ownerParty: 'keystone' as const, dueOn: optionalIso(due, st === 'closed'), status: st, position,
          // R-185: an item raised by an inspection belongs to the inspection's plan's line (the migration's rule).
          equipmentId: s.inspection && inspectionId.has(s.inspection) ? mainLine : null,
        };
      }));
  }

  // Site punch list (SITE_PUNCH belongs to the site sheet's project). R-117 (A-6 'a'): the same list as the ITP items, numbered
  // after them (the prototype's P-01…P-03 become P-06…P-08 on HLT-026, as the custom migration renumbers an older database),
  // category B, the owner party as recorded.
  const siteCode = PROTO.SITE.code as string;
  const sitePunch = PROTO.SITE_PUNCH as SitePunchRow[];
  const itpPunch = (PROTO.PUNCH[siteCode] ?? []) as PunchRow[];
  const after = itpPunch.reduce((m, [number]) => Math.max(m, parseInt(number.slice(2), 10) || 0), 0);
  if (sitePunch.length)
    await tx.insert(punchItems).values(sitePunch.map(([, description, ncr, status, owner, due], i) => {
      const st = punchStatus.code(status);
      return {
        projectId: must(ctx.projectByCode, siteCode, 'project'), register: 'site' as const, number: `P-${String(after + i + 1).padStart(2, '0')}`, description, location: '',
        category: 'B' as const, ncrNumber: ncr && ncr !== '—' ? ncr : null, ownerParty: punchOwnerParty.code(owner), dueOn: optionalIso(due, st === 'closed'), status: st,
        position: itpPunch.length + i,
      };
    }));

  // R-185 part 2: Harbor Line's EQ-02 — its plan, two inspections and a punch item.
  const eq02Project = ctx.projectByCode.get(DEMO_EQ02.project);
  const eq02 = eq02Project ? await lineId(tx, eq02Project, DEMO_EQ02.ref) : null;
  if (eq02Project && eq02) {
    const planId = newId();
    await tx.insert(itpPlans).values({ id: planId, projectId: eq02Project, equipmentId: eq02, machineTypeCode: machineType.code(DEMO_EQ02.template) });
    const templates = PROTO.ITP_TEMPLATES as Record<string, string[]>;
    await tx.insert(itpPlanSystems).values([...new Set(templates[DEMO_EQ02.template])].map((name, position) => ({ planId, position, name })));
    await tx.insert(itpInspections).values(inspectionRows(planId, DEMO_EQ02.inspections, DEMO_EQ02.inspections.length, docId));
    const pi = DEMO_EQ02.punch;
    const s = punchSourceOf(pi.source);
    await tx.insert(punchItems).values({
      projectId: eq02Project, register: 'itp', number: pi.number, description: pi.description, location: pi.location, category: pi.category, source: s.source,
      ownerName: pi.owner, ownerPersonId: personIdOrNull(ctx, pi.owner), ownerParty: 'keystone', dueOn: optionalIso(pi.due), status: 'open',
      position: ((PROTO.PUNCH[DEMO_EQ02.project] ?? []) as PunchRow[]).length + (PROTO.SITE.code === DEMO_EQ02.project ? (PROTO.SITE_PUNCH as SitePunchRow[]).length : 0),
      equipmentId: eq02,
    });
  }

  // Commissioning grid and handover dossier.
  type Comm = { systems: string[]; steps: string[]; grid: Record<string, string[]>; dossier: [string, string, string, string][] };
  for (const [code, c] of Object.entries(PROTO.COMMISSIONING as Record<string, Comm>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    // R-185: the prototype's systems are the main line's (EQ-01); Harbor Line's EQ-02 adds its own after them.
    const mainLine = await lineId(tx, projectId);
    const extra = code === DEMO_EQ02.project && eq02 ? [DEMO_EQ02.commissioning] : [];
    const grid: Record<string, string[]> = { ...c.grid, ...Object.fromEntries(extra.map((x) => [x.system, x.cells])) };
    const systems = [
      ...c.systems.map((name, position) => ({ id: newId(), projectId, name, position, equipmentId: mainLine })),
      ...extra.map((x, i) => ({ id: newId(), projectId, name: x.system, position: c.systems.length + i, equipmentId: eq02 })),
    ];
    await tx.insert(commissioningSystems).values(systems);
    await tx.insert(commissioningSteps).values(systems.flatMap((s) =>
      grid[s.name].map((cell, position) => {
        const [label, rest] = cell.split(' · ');
        const status = commissioningCellStatus.code(label);
        const isRef = !!rest && /^[A-Z]+-\d+$/.test(rest);
        return {
          systemId: s.id, step: commissioningStep.code(c.steps[position]), status, dateOn: rest && !isRef ? forwardIso(rest, status === 'done') : null,
          blockingRef: isRef ? rest : null, position,
        };
      }),
    ));
    await tx.insert(handoverItems).values(c.dossier.map(([item, type, doc, status], position) => ({
      projectId, item, documentTypeCode: type, documentRef: doc || null, documentId: docId(doc || null), status: handoverItemStatus.code(status), position,
    })));
  }

  // Lessons learned, closure checklist, customer satisfaction.
  for (const [code, list] of Object.entries(PROTO.LESSONS as Record<string, [string, string, string, string, string, string, string][]>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    await tx.insert(lessonsLearned).values(list.map(([number, theme, whatHappened, impact, recommendation, appliesTo, status], position) => ({
      projectId, number, theme: lessonTheme.code(theme), whatHappened, impact, recommendation, appliesTo, status: lessonStatus.code(status), position,
    })));
  }
  for (const [code, list] of Object.entries(PROTO.CLOSURE as Record<string, [string, string, string][]>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    await tx.insert(closureItems).values(list.map(([item, owner, status], position) => ({
      projectId, item, ownerName: owner, ownerPersonId: personIdOrNull(ctx, owner), status: closureItemStatus.code(status), position,
    })));
  }
  for (const [code, list] of Object.entries(PROTO.SATISFACTION as Record<string, [string, number][]>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    await tx.insert(satisfactionScores).values(list.map(([criterion, score], position) => ({ projectId, criterion, score, position })));
  }
}
