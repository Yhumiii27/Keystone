import 'server-only';
// Portfolio schedule DAL (docs/spec/05 §3; 11 §3.2 PipelineStagePlan). Delivery 1 modelled the pipeline stage plans
// (PIPE_PLAN → pipeline_stage_plans) and the stage history (stage_transitions); this module resolves, per live project
// of the zone, the stage windows the 24-month portfolio Gantt draws (`pgRow`, logic 4529–4548):
//  - pipeline projects (Initiative, APS, APD): their PIPE_PLAN windows, else the default windows relative to the start;
//  - projects in execution: windows built from the stage history dates (Initiative, APS, APD, Etudes) with defaults.
// Execution bar inputs (start/finish months, float, forecast finish) come with the planning summary of the project.
import { mIdx } from '@/lib/format';
import { PG_NOW, type PipelineWindow, type StageCode } from '@/server/db/codes';
import type { ZoneKey } from '@/server/session';
import { listStageHistory } from './lifecycle';
import { getPipelinePlans, listScheduleSummaries, type MilestoneRow, type ScheduleControl } from './planning';
import { listProjects, type ProjectRow } from './projects';

/** Horizon of the portfolio Gantt: 24 months from Jan 2026 (`PG_MONTHS`). */
export const PG_MONTHS = 24;
export { PG_NOW };

export interface StageWindow {
  window: PipelineWindow;
  /** 'Initiative' | 'Board' | 'APS' | 'APD'. */
  label: string;
  /** Month offsets from Jan 2026. */
  start: number;
  end: number;
  /** Board windows: approved (ended), decision pending (running at PG_NOW) or planned. */
  board: 'approved' | 'pending' | 'planned' | null;
}

export interface PortfolioScheduleRow {
  project: ProjectRow;
  pipeline: boolean;
  /** Month index of the start (PG_NOW when unknown) and end of the finish month (null when "—"). */
  startMonth: number;
  finishMonth: number | null;
  windows: StageWindow[];
  /** Where the windows come from. */
  windowsSource: 'pipeline_plan' | 'default' | 'stage_history';
  /** End of the last board = start of execution. */
  execStart: number;
  /** Planning summary of projects with data (float, forecast finish, milestones), for `projectIndicators`. */
  schedule: (ScheduleControl & { milestones: MilestoneRow[] }) | null;
}

export interface PortfolioSchedule {
  /** Live projects of the zone (not Clos / Annulé), register order. */
  rows: PortfolioScheduleRow[];
  /** Mean duration in days of the completed boards across every pipeline plan (all zones, logic 4554). */
  averageBoardWaitDays: number;
}

const PIPELINE: ReadonlySet<StageCode> = new Set(['initiative', 'aps', 'apd']);
const CLOSED: ReadonlySet<StageCode> = new Set(['clos', 'annule']);
const LABEL: Record<PipelineWindow, string> = { initiative: 'Initiative', board: 'Board', aps: 'APS', apd: 'APD' };

const boardState = (w: PipelineWindow, a: number, b: number): StageWindow['board'] =>
  w !== 'board' ? null : b <= PG_NOW ? 'approved' : a <= PG_NOW ? 'pending' : 'planned';
const win = (window: PipelineWindow, start: number, end: number): StageWindow => ({ window, label: LABEL[window], start, end, board: boardState(window, start, end) });

/** Rows of the portfolio schedule for a zone (null = all zones). */
export async function getPortfolioSchedule(zone: ZoneKey | null): Promise<PortfolioSchedule> {
  const [all, plans, history, summaries] = await Promise.all([listProjects(), getPipelinePlans(), listStageHistory(), listScheduleSummaries()]);
  const rows = all
    .filter((p) => (!zone || p.zone === zone) && !CLOSED.has(p.stage))
    .map((p): PortfolioScheduleRow => {
      const pipeline = PIPELINE.has(p.stage);
      const startMonth = mIdx(p.start) ?? PG_NOW;
      const fin = mIdx(p.finish);
      let windows: StageWindow[];
      let windowsSource: PortfolioScheduleRow['windowsSource'];
      if (pipeline) {
        const plan = plans[p.code];
        windowsSource = plan ? 'pipeline_plan' : 'default';
        windows = plan
          ? plan.map((w) => win(w.window, w.startMonth, w.endMonth))
          : [
              win('initiative', startMonth - 3, startMonth - 2.2), win('board', startMonth - 2.2, startMonth - 1.6), win('aps', startMonth - 1.6, startMonth - 0.8),
              win('board', startMonth - 0.8, startMonth - 0.4), win('apd', startMonth - 0.4, startMonth + 0.3), win('board', startMonth + 0.3, startMonth + 0.6),
            ];
      } else {
        const hist = history[p.code] ?? [];
        const hm = (s: StageCode) => {
          const h = hist.find((x) => x.stage === s);
          return h ? mIdx(h.date) : null;
        };
        const i0 = hm('initiative') ?? startMonth;
        const a0 = hm('aps') ?? i0 + 1;
        const d0 = hm('apd') ?? a0 + 1.1;
        const e0 = hm('etudes') ?? d0 + 1.2;
        windowsSource = 'stage_history';
        windows = [win('initiative', i0, a0 - 0.25), win('board', a0 - 0.25, a0), win('aps', a0, d0 - 0.25), win('board', d0 - 0.25, d0), win('apd', d0, e0 - 0.3), win('board', e0 - 0.3, e0)];
      }
      return {
        project: p, pipeline, startMonth, finishMonth: fin === null ? null : fin + 1, windows, windowsSource, execStart: windows[windows.length - 1].end,
        schedule: summaries[p.code] ?? null,
      };
    });
  const waits = Object.values(plans).flatMap((pl) => pl.filter((w) => w.window === 'board' && w.endMonth <= PG_NOW).map((w) => (w.endMonth - w.startMonth) * 30));
  return { rows, averageBoardWaitDays: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0 };
}
