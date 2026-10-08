// Portfolio seed: lifecycle reference, machine types and templates, projects (initialProjects), sites, teams,
// stage deliverable checks and stage history.
import { mIdx } from '@/lib/format';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { STAGES, calendar, costType, isoOfDisplayDate, machineType, pipelineWindow, stage, type StageCode } from '../codes';
import {
  lifecycleStages, lifecycleTransitions, machineTypes, pipelineStagePlans, projectMembers, projectSites, projectTemplateCostCategories,
  projectTemplatePhases, projectTemplates, projects, rexReferences, stageDeliverableChecks, stageDeliverableDefs, stageTransitions,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personId, type SeedCtx } from './context';

const templateCode = (id: string) => (id === 'blank' ? 'blank' : machineType.code(id));

export async function seedPortfolio(tx: Tx, ctx: SeedCtx): Promise<void> {
  // Lifecycle reference.
  await tx.insert(lifecycleStages).values(
    STAGES.map((s, i) => ({
      code: s.code, label: s.label, shortLabel: s.short, seq: s.seq, sortOrder: i + 1, group: s.group,
      description: PROTO.LIFE[s.label] as string, entryGate: (PROTO.GATES[s.label] as string) ?? null,
    })),
  );
  await tx.insert(lifecycleTransitions).values(
    Object.entries(PROTO.TRANS as Record<string, string[]>).flatMap(([from, tos]) =>
      tos.map((to, i) => ({ fromStage: stage.code(from), toStage: stage.code(to), sortOrder: i + 1 })),
    ),
  );
  const defRows = Object.entries(PROTO.STAGE_DELIVS as Record<string, string[]>).flatMap(([label, items]) =>
    items.map((item, position) => ({ id: newId(), stage: stage.code(label), position, label: item })),
  );
  for (const d of defRows) ctx.stageDeliverable.set(`${d.stage}|${d.position}`, d.id);
  await tx.insert(stageDeliverableDefs).values(defRows);

  // Machine types (+ REX payment pattern and references) and new-project templates.
  await tx.insert(machineTypes).values(
    (PROTO.MACHINE_TYPES as string[]).map((mt, i) => {
      const rex = PROTO.REX_FIN[mt];
      return { code: machineType.code(mt), label: mt, depositPct: rex.dep, deliveryPct: rex.deliv, acceptancePct: rex.acc, sortOrder: i + 1 };
    }),
  );
  await tx.insert(rexReferences).values(
    (PROTO.MACHINE_TYPES as string[]).flatMap((mt) =>
      (PROTO.REX_FIN[mt].refs as [string, string, string, string][]).map(([analyticCode, projectName, year, pattern], position) => ({
        id: newId(), machineTypeCode: machineType.code(mt), position, analyticCode, projectName, year, pattern,
      })),
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templates = PROTO.NP_TEMPLATES as any[];
  await tx.insert(projectTemplates).values(
    templates.map((t, i) => ({
      code: templateCode(t.id), machineTypeCode: t.mt ? machineType.code(t.mt) : null, name: t.name, description: t.desc,
      wbsSummary: t.wbs, activitiesSummary: t.acts, calendar: calendar.code(t.cal), sortOrder: i + 1,
    })),
  );
  const phaseRows = templates.flatMap((t) => (t.phases as string[]).map((name, position) => ({ templateCode: templateCode(t.id), position, name })));
  if (phaseRows.length) await tx.insert(projectTemplatePhases).values(phaseRows);
  const catRows = templates.flatMap((t) =>
    (t.cats as [string, string, string][]).map(([name, type, budget], position) => ({
      templateCode: templateCode(t.id), position, name, costType: costType.code(type), budgetKeur: parseFloat(budget),
    })),
  );
  if (catRows.length) await tx.insert(projectTemplateCostCategories).values(catRows);

  // Projects, in register order.
  const rows = PROTO_GEN.initialProjects.map((p, i) => {
    const pid = PROTO.PROJ_ID[p.code] as { id: string; das: string; mt: string; ana: string } | undefined;
    const id = newId();
    ctx.projectByCode.set(p.code, id);
    return {
      id, code: p.code as string, number: pid?.id ?? null, shortCode: (p.code as string).slice(0, 3), name: p.name as string,
      shortName: PROTO_GEN.projectData[p.code] ? ((PROTO.PROJ_NAMES[(p.code as string).slice(0, 3)] as string) ?? null) : null,
      clientId: must(ctx.clientByName, p.client, 'client'), pmPersonId: personId(ctx, p.pm), stage: stage.code(p.status),
      das: pid?.das ?? null, machineTypeCode: pid ? machineType.code(pid.mt) : null, analyticCode: pid?.ana ?? null,
      startText: p.start as string, finishText: p.finish as string, startMonth: mIdx(p.start), finishMonth: mIdx(p.finish),
      budgetKeur: p.budget as number, actualKeur: p.actual as number, progress: p.progress as number, spi: (p.spi as number) ?? null,
      sortOrder: i + 1,
    };
  });
  await tx.insert(projects).values(rows);

  await tx.insert(projectSites).values(
    Object.entries(PROTO.GEO as Record<string, { city: string; country: string; lat: number; lng: number; zone?: 'euna' | 'afr' | 'apac' }>).map(
      ([code, g]) => ({ projectId: must(ctx.projectByCode, code, 'project'), city: g.city, countryName: g.country, lat: g.lat, lng: g.lng, zoneOverride: g.zone ?? null }),
    ),
  );

  const members = Object.entries(PROTO_GEN.projectData).flatMap(([code, pd]) =>
    (pd.team as string[]).map((name, position) => ({ projectId: must(ctx.projectByCode, code, 'project'), personId: personId(ctx, name), position })),
  );
  await tx.insert(projectMembers).values(members);

  // Stage deliverable checks (STAGE_DONE_DEFAULT) and stage history (STAGE_HISTORY).
  const checks = Object.entries(PROTO.STAGE_DONE_DEFAULT as Record<string, Record<string, number[]>>).flatMap(([code, byStage]) =>
    Object.entries(byStage).flatMap(([label, flags]) =>
      flags.map((v, position) => ({
        projectId: must(ctx.projectByCode, code, 'project'),
        deliverableId: must(ctx.stageDeliverable, `${stage.code(label)}|${position}`, 'stage deliverable'),
        done: !!v,
      })),
    ),
  );
  await tx.insert(stageDeliverableChecks).values(checks);

  const history = Object.entries(PROTO.STAGE_HISTORY as Record<string, [string, string, 'auto' | 'forced', string][]>).flatMap(([code, entries]) => {
    let prev: StageCode | null = null;
    return entries.map(([label, dateText, mode, reason], i) => {
      const to = stage.code(label);
      const row = {
        id: newId(), projectId: must(ctx.projectByCode, code, 'project'), seq: i + 1, fromStage: prev, toStage: to,
        effectiveOn: isoOfDisplayDate(dateText)!, mode, reason: reason || null,
      };
      prev = to;
      return row;
    });
  });
  await tx.insert(stageTransitions).values(history);

  // Pipeline stage plan (PIPE_PLAN), used by the portfolio schedule.
  await tx.insert(pipelineStagePlans).values(
    Object.entries(PROTO.PIPE_PLAN as Record<string, [string, number, number][]>).flatMap(([code, windows]) =>
      windows.map(([w, startMonth, endMonth], position) => ({
        id: newId(), projectId: must(ctx.projectByCode, code, 'project'), position, window: pipelineWindow.code(w), startMonth, endMonth,
      })),
    ),
  );
}
