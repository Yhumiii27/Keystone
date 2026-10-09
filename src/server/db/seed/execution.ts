// Project execution seed (docs/spec/11 §8.4): the inspection & test plan (ITP 3717), the ITP punch list (PUNCH 3718)
// and the site punch list (SITE_PUNCH 3581, the site sheet's project) as two registers of punch items, commissioning
// and the handover dossier (COMMISSIONING 3721), lessons learned, closure checklist and customer satisfaction
// (LESSONS / CLOSURE / SATISFACTION 3732–3734). Harbor Line only in the prototype; other projects get nothing.
import { PROTO } from '@/server/prototype';
import {
  closureItemStatus, commissioningCellStatus, commissioningStep, handoverItemStatus, itpPointType, itpResult, itpStage, lessonStatus, lessonTheme, machineType,
  punchOwnerParty, punchSource, punchStatus, type PunchCategory, type PunchSource,
} from '../codes';
import {
  closureItems, commissioningSteps, commissioningSystems, handoverItems, itpInspections, itpPlans, lessonsLearned, punchItems, satisfactionScores,
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

export async function seedExecution(tx: Tx, ctx: SeedCtx): Promise<void> {
  const docId = (ref: string | null) => (ref ? ctx.document.get(ref) ?? null : null);

  // ITP plans and inspections.
  for (const [code, plan] of Object.entries(PROTO.ITP as Record<string, { tpl: string; custom: number; items: ItpRow[] }>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const planId = newId();
    await tx.insert(itpPlans).values({ id: planId, projectId, machineTypeCode: machineType.code(plan.tpl) });
    const customFrom = plan.items.length - plan.custom;
    const inspections = plan.items.map(([number, system, name, type, stage, reference, date, status, doc], position) => {
      const result = itpResult.code(status);
      return {
        id: newId(), planId, number, system, name, pointType: itpPointType.code(type), stage: itpStage.code(stage), reference,
        plannedOn: optionalIso(date, result === 'passed' || result === 'failed'), result, recordRef: doc || null, recordDocumentId: docId(doc || null),
        isCustom: position >= customFrom, position,
      };
    });
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
          dueOn: optionalIso(due, st === 'closed'), status: st, position,
        };
      }));
  }

  // Site punch list (SITE_PUNCH belongs to the site sheet's project).
  const siteCode = PROTO.SITE.code as string;
  const sitePunch = PROTO.SITE_PUNCH as SitePunchRow[];
  if (sitePunch.length)
    await tx.insert(punchItems).values(sitePunch.map(([number, description, ncr, status, owner, due], position) => {
      const st = punchStatus.code(status);
      return {
        projectId: must(ctx.projectByCode, siteCode, 'project'), register: 'site' as const, number, description, location: '', ncrNumber: ncr && ncr !== '—' ? ncr : null,
        ownerParty: punchOwnerParty.code(owner), dueOn: optionalIso(due, st === 'closed'), status: st, position,
      };
    }));

  // Commissioning grid and handover dossier.
  type Comm = { systems: string[]; steps: string[]; grid: Record<string, string[]>; dossier: [string, string, string, string][] };
  for (const [code, c] of Object.entries(PROTO.COMMISSIONING as Record<string, Comm>)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    const systems = c.systems.map((name, position) => ({ id: newId(), projectId, name, position }));
    await tx.insert(commissioningSystems).values(systems);
    await tx.insert(commissioningSteps).values(systems.flatMap((s) =>
      c.grid[s.name].map((cell, position) => {
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
