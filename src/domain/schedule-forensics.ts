// R-206 — forensic delay analysis: a reference schedule (a baseline snapshot) against a later one (another baseline or the
// current schedule), per activity and along the driving path to the project finish. Pure.
//
// - Variances are in working days on the project calendar, positive = later than the reference: start variance = start
//   boundaries' difference, finish variance = finish boundaries' difference (src/domain/calendar.ts).
// - Slip attribution walks the driving path (earliest first, src/domain/schedule-quality-cpm.ts `drivingPathToFinish`): each
//   activity's contribution is its finish variance minus the finish variance it inherited from its driving predecessor (0 for
//   the first one), split into "late start" (start variance − inherited) and "longer duration" (finish variance − start
//   variance). The contributions add up to the finish variance of the last activity of the path, i.e. the project finish slip
//   along the driving path. An activity absent from the reference contributes nothing known; the next known one carries it.
import type { IsoDate, WorkCalendar } from './calendar';

export interface DatedActivity {
  id: string;
  start: IsoDate | null;
  finish: IsoDate | null;
}

export interface VarianceRow {
  id: string;
  refStart: IsoDate | null;
  refFinish: IsoDate | null;
  cmpStart: IsoDate | null;
  cmpFinish: IsoDate | null;
  /** Working days, positive = later; null when a date is missing on either side. */
  startVar: number | null;
  finishVar: number | null;
  /** In both schedules, only in the later one (added), or only in the reference (removed). */
  presence: 'both' | 'added' | 'removed';
}

export interface ScheduleComparison {
  rows: VarianceRow[];
  /** Latest finish of each schedule. */
  refFinish: IsoDate | null;
  cmpFinish: IsoDate | null;
  /** Project finish slip, working days (positive = later); null when a side has no finish. */
  finishSlip: number | null;
  /** Activities finishing later / earlier than in the reference. */
  later: number;
  earlier: number;
}

const latest = (rows: readonly DatedActivity[]) => rows.reduce<IsoDate | null>((m, r) => (r.finish && (!m || r.finish > m) ? r.finish : m), null);

/** Per-activity start / finish variances, rows in the later schedule's order, then the activities only in the reference. */
export function compareSchedules(ref: readonly DatedActivity[], cmp: readonly DatedActivity[], cal: WorkCalendar): ScheduleComparison {
  const refById = new Map(ref.map((r) => [r.id, r]));
  const cmpIds = new Set(cmp.map((r) => r.id));
  const sv = (a: IsoDate | null, b: IsoDate | null) => (a && b ? cal.startBoundary(b) - cal.startBoundary(a) : null);
  const fv = (a: IsoDate | null, b: IsoDate | null) => (a && b ? cal.finishBoundary(b) - cal.finishBoundary(a) : null);
  const rows: VarianceRow[] = cmp.map((c) => {
    const r = refById.get(c.id);
    return {
      id: c.id, refStart: r?.start ?? null, refFinish: r?.finish ?? null, cmpStart: c.start, cmpFinish: c.finish,
      startVar: r ? sv(r.start, c.start) : null, finishVar: r ? fv(r.finish, c.finish) : null, presence: r ? 'both' : 'added',
    };
  });
  for (const r of ref) {
    if (!cmpIds.has(r.id)) rows.push({ id: r.id, refStart: r.start, refFinish: r.finish, cmpStart: null, cmpFinish: null, startVar: null, finishVar: null, presence: 'removed' });
  }
  const refFinish = latest(ref);
  const cmpFinish = latest(cmp);
  return {
    rows, refFinish, cmpFinish, finishSlip: fv(refFinish, cmpFinish),
    later: rows.filter((r) => (r.finishVar ?? 0) > 0).length, earlier: rows.filter((r) => (r.finishVar ?? 0) < 0).length,
  };
}

export interface SlipStep {
  id: string;
  startVar: number | null;
  finishVar: number | null;
  /** Start variance beyond what the driving predecessor passed on. */
  lateStart: number | null;
  /** Finish variance beyond the start variance. */
  longerDuration: number | null;
  /** lateStart + longerDuration: what this activity added to the slip (negative = it recovered time). */
  contribution: number | null;
}

export interface SlipAttribution {
  /** The driving path, earliest first. */
  steps: SlipStep[];
  /** Finish variance at the end of the path (the slip along it); null when no activity of the path is in the reference. */
  total: number | null;
  /** Steps that added time, largest first. */
  drivers: SlipStep[];
}

/** Attribution of the finish slip to the activities of the driving path (`path` earliest first). */
export function slipAttribution(path: readonly string[], comparison: Pick<ScheduleComparison, 'rows'>): SlipAttribution {
  const byId = new Map(comparison.rows.map((r) => [r.id, r]));
  let inherited = 0;
  let total: number | null = null;
  const steps: SlipStep[] = path.map((id) => {
    const r = byId.get(id);
    const startVar = r?.startVar ?? null;
    const finishVar = r?.finishVar ?? null;
    if (finishVar === null) return { id, startVar, finishVar, lateStart: null, longerDuration: null, contribution: null };
    const contribution = finishVar - inherited;
    const lateStart = startVar === null ? null : startVar - inherited;
    const longerDuration = startVar === null ? null : finishVar - startVar;
    inherited = finishVar;
    total = finishVar;
    return { id, startVar, finishVar, lateStart, longerDuration, contribution };
  });
  const drivers = steps.filter((s) => (s.contribution ?? 0) > 0).sort((a, b) => b.contribution! - a.contribution!);
  return { steps, total, drivers };
}
