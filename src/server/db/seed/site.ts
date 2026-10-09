// Site seed (docs/spec/11 §8.5): the site sheet (SITE 3573, HLT-026), equipment (SITE_EQUIP), client prerequisites
// (SITE_PREREQ), rotation plan (SITE_ROTATION), collisions (SITE_COLLISIONS), mission costs (SITE_COSTS) and daily
// reports (SITE_REPORTS, numbered DR-001… in date order). The Cursus approvals (SITE_DOCS) go to the Cursus mirror
// (seed/cursus.ts), the HSE register (SITE_HSE) to the Vigie mirror (seed/vigie.ts), the site punch list to punch_items.
import { PROTO } from '@/server/prototype';
import { collisionKind, confirmStatus, equipmentSource, isoOfDisplayDate } from '../codes';
import { dailyReports, missionCostLines, siteCollisions, siteEquipment, sitePrerequisites, siteRotations, siteSheets } from '../schema';
import type { Tx } from '../types';
import { must, personIdOrNull, type SeedCtx } from './context';

/** "Man-days planned" of the prototype's Team & mobilisation tab (a literal there, data here). */
export const SEED_MAN_DAYS = 168;

export async function seedSite(tx: Tx, ctx: SeedCtx): Promise<void> {
  const s = PROTO.SITE as Record<string, string | number>;
  const code = s.code as string;
  const projectId = must(ctx.projectByCode, code, 'project');
  const acts = ctx.activity.get(code) ?? new Map<string, string>();
  const iso = (t: string) => {
    const v = isoOfDisplayDate(t);
    if (!v) throw new Error(`Seed: unparseable date "${t}"`);
    return v;
  };
  await tx.insert(siteSheets).values({
    projectId, siteName: s.site as string, country: s.country as string, timeZone: s.tz as string, language: s.lang as string, currency: s.cur as string,
    clientContact: s.contact as string, workingHours: s.hours as string, localHolidays: s.holidays as string, accessConstraints: s.access as string,
    startOn: iso(s.start as string), endOn: iso(s.end as string), doneDays: s.doneDays as number, planDays: s.planDays as number, manDaysPlanned: SEED_MAN_DAYS,
    cursusChantierId: null,
  });
  await tx.insert(siteEquipment).values((PROTO.SITE_EQUIP as [string, string, string, string][]).map(([name, source, status, note], position) => ({
    projectId, name, source: equipmentSource.code(source), status: confirmStatus.code(status) as 'pending' | 'confirmed', note, position,
  })));
  await tx.insert(sitePrerequisites).values((PROTO.SITE_PREREQ as [string, string, string, string, string][]).map(([title, act, due, status, evidence], position) => ({
    projectId, title, activityCode: act, activityId: acts.get(act) ?? null, neededBy: iso(due), status: confirmStatus.code(status), evidence, position,
  })));
  await tx.insert(siteRotations).values((PROTO.SITE_ROTATION as [string, string, string, string, string, string, string][]).map(([who, role, from, to, lodging, travel, rot], position) => ({
    projectId, personName: who, personId: personIdOrNull(ctx, who), roleOnSite: role, fromOn: iso(from), toOn: iso(to), lodging, travel, rotationNo: parseInt(rot, 10), position,
  })));
  await tx.insert(siteCollisions).values((PROTO.SITE_COLLISIONS as [string, string, string, string][]).map(([who, what, kind, fix], position) => ({
    projectId, personName: who, personId: personIdOrNull(ctx, who), description: what, kind: collisionKind.code(kind), proposedFix: fix, position,
  })));
  await tx.insert(missionCostLines).values((PROTO.SITE_COSTS as [string, number, number][]).map(([name, budget, actual], position) => ({
    projectId, name, budgetKeur: budget, actualKeur: actual, position,
  })));
  const reports = (PROTO.SITE_REPORTS as [string, string, string, string, string, string][])
    .map(([date, act, pct, text, link, by]) => ({ date: iso(date), act, pct, text, link, by }))
    .sort((a, b) => a.date.localeCompare(b.date));
  await tx.insert(dailyReports).values(reports.map((r, i) => ({
    projectId, number: `DR-${String(i + 1).padStart(3, '0')}`, reportOn: r.date, activityLabel: r.act, activityId: acts.get(r.act) ?? null,
    percentComplete: r.pct && r.pct !== '—' ? parseFloat(r.pct) : null, text: r.text, linkRef: r.link && r.link !== '—' ? r.link : null, authorName: r.by,
    authorPersonId: personIdOrNull(ctx, r.by),
  })));
}
