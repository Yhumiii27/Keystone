// R-206 — what the schedule quality diagnostic takes from the CPM engine, through its public API only (`schedule()` and its
// result): the critical path test (DCMA #12) and the driving path to the project finish (forensic slip analysis). Pure.
// Another lot (R-204, multi-level planning) extends the engine; these helpers only read `CpmResult.order`, `criticalPath`,
// `projectFinish` and each activity's `finish`, `state` and `drivingPredecessors`.
import { CpmCycleError, CpmInputError, remainingDuration, schedule, type CpmInput, type CpmResult } from './cpm';
import type { CriticalPathTestOutcome } from './schedule-quality';

/** Delay added by the critical path test, working days (a delay long enough to show through any float). */
export const CPT_DELAY_DAYS = 600;

/**
 * DCMA #12: adds `delay` working days to the remaining duration of the first incomplete critical activity and measures how far
 * the project finish moves, on that activity's calendar. Passes (src/domain/schedule-quality.ts) when the finish moves by the
 * delay, within 1 % (calendars with other working weeks or holidays shift the dates slightly).
 */
export function criticalPathTest(input: CpmInput, delay = CPT_DELAY_DAYS): CriticalPathTestOutcome {
  let base: CpmResult;
  try {
    base = schedule(input);
  } catch (e) {
    if (e instanceof CpmCycleError) return { kind: 'cycle', cycle: e.cycle };
    if (e instanceof CpmInputError) return { kind: 'invalid' };
    throw e;
  }
  const id = base.criticalPath[0];
  if (!id) return { kind: 'no_critical' };
  const probed = input.activities.map((a) => {
    if (a.id !== id) return a;
    const progressed = !!a.actualStart || (a.percentComplete ?? 0) > 0 || a.remaining != null;
    return progressed ? { ...a, remaining: remainingDuration(a, input.options?.remainingRounding) + delay } : { ...a, duration: a.duration + delay };
  });
  const delayed = schedule({ ...input, activities: probed });
  const act = input.activities.find((a) => a.id === id)!;
  const cal = input.calendars[act.calendar ?? input.projectCalendar] ?? input.calendars[input.projectCalendar];
  const slip = cal.finishBoundary(delayed.projectFinish) - cal.finishBoundary(base.projectFinish);
  return { kind: 'done', activity: id, delay, slip, tolerance: Math.max(1, Math.round(delay / 100)) };
}

/**
 * The driving path to the project finish, earliest activity first: from the incomplete activity that finishes last (the last
 * one in topological order on a tie), back through the driving predecessor that finishes last (the first listed on a tie),
 * until an activity without driving predecessor (an unconstrained start, a constraint, the data date or actual progress).
 * [] when every activity is complete.
 */
export function drivingPathToFinish(result: Pick<CpmResult, 'order' | 'activities'>): string[] {
  let end: string | null = null;
  for (const id of result.order) {
    const r = result.activities[id];
    if (r.state === 'complete') continue;
    if (!end || r.finish >= result.activities[end].finish) end = id;
  }
  if (!end) return [];
  const path = [end];
  const seen = new Set(path);
  let cur = end;
  for (;;) {
    let next: string | null = null;
    for (const p of result.activities[cur].drivingPredecessors) {
      if (seen.has(p) || !result.activities[p]) continue;
      if (!next || result.activities[p].finish > result.activities[next].finish) next = p;
    }
    if (!next) break;
    path.push(next);
    seen.add(next);
    cur = next;
  }
  return path.reverse();
}
