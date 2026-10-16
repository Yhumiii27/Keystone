import 'server-only';
// Trends & status report DAL (docs/spec/04 §2, 11 §3.3 StatusSnapshot): the weekly snapshots frozen at each
// Friday status date (CPI, SPI, EAC, critical-path float, risk exposure, milestone slip), the BAC and contingency
// targets, the next status report date, and the writers (generate status report, freeze a snapshot).
import { asc, desc, eq } from 'drizzle-orm';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import {
  addDaysIso, isoWeekOf, reportAudience, reportPeriod, reportSections, shortDateOfIso,
  type ReportAudience, type ReportPeriod, type ReportSections,
} from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { persons, projectControls, projects, statusReports, statusSnapshots } from '@/server/db/schema';

export interface SnapshotRow {
  /** "W39". */
  week: string;
  statusDate: string;
  /** "25 Sep" (SNAP_DATES). */
  dateText: string;
  cpi: number;
  spi: number;
  /** k€. */
  eac: number;
  /** Critical-path float, days. */
  float: number;
  /** Open-risk EMV, k€. */
  risk: number;
  /** Milestone slip, days. */
  slip: number;
}

/** The six indicator series in week order (TKPI keys). */
export interface SnapshotSeries {
  cpi: number[];
  spi: number[];
  eac: number[];
  float: number[];
  risk: number[];
  slip: number[];
}

export interface StatusReportRow {
  period: ReportPeriod;
  periodLabel: string;
  audience: ReportAudience;
  audienceLabel: string;
  sections: ReportSections;
  sectionsLabel: string;
  note: string | null;
  statusDate: string;
  generatedBy: string | null;
  generatedAt: string;
}

export interface Trends {
  projectCode: string;
  /** Chronological (W27 → W39); the history table lists them reversed. */
  snapshots: SnapshotRow[];
  series: SnapshotSeries;
  /** EAC target (BAC) and the contingency shown as the risk target text, k€. */
  bac: number;
  contingency: number | null;
  /** Next weekly status report: the Friday after the last snapshot ("2 Oct"). */
  nextReport: { date: string; text: string } | null;
  /** Reports generated so far, newest first. */
  reports: StatusReportRow[];
}

/** Trends of a project; null when the project has no snapshot (projects without data). */
export async function getTrends(projectCode: string): Promise<Trends | null> {
  const db = await getDb();
  const [p] = await db
    .select({ id: projects.id, bac: projects.budgetKeur, cont: projectControls.contingencyKeur })
    .from(projects)
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) return null;
  const [snaps, reports] = await Promise.all([
    db.select().from(statusSnapshots).where(eq(statusSnapshots.projectId, p.id)).orderBy(asc(statusSnapshots.statusDate)),
    db
      .select({ r: statusReports, full: persons.fullName, short: persons.shortName })
      .from(statusReports)
      .leftJoin(persons, eq(persons.id, statusReports.generatedByPersonId))
      .where(eq(statusReports.projectId, p.id))
      .orderBy(desc(statusReports.generatedAt)),
  ]);
  if (!snaps.length) return null;
  const rows: SnapshotRow[] = snaps.map((s) => ({
    week: s.weekCode, statusDate: s.statusDate, dateText: shortDateOfIso(s.statusDate), cpi: s.cpi, spi: s.spi, eac: s.eacKeur,
    float: s.floatDays, risk: s.riskEmvKeur, slip: s.milestoneSlipDays,
  }));
  const next = addDaysIso(rows[rows.length - 1].statusDate, 7);
  return {
    projectCode, snapshots: rows,
    series: {
      cpi: rows.map((r) => r.cpi), spi: rows.map((r) => r.spi), eac: rows.map((r) => r.eac),
      float: rows.map((r) => r.float), risk: rows.map((r) => r.risk), slip: rows.map((r) => r.slip),
    },
    bac: p.bac, contingency: p.cont ?? null, nextReport: { date: next, text: shortDateOfIso(next) },
    reports: reports.map(({ r, full, short }) => ({
      period: r.period, periodLabel: reportPeriod.label(r.period), audience: r.audience, audienceLabel: reportAudience.label(r.audience),
      sections: r.sections, sectionsLabel: reportSections.label(r.sections), note: r.note, statusDate: r.statusDate,
      generatedBy: full ?? short ?? null, generatedAt: r.generatedAt.toISOString(),
    })),
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface StatusReportInput {
  period: ReportPeriod;
  audience: ReportAudience;
  sections: ReportSections;
  note?: string;
}

/** "Generate status report" (AF.trends): records the request (the PDF itself is not produced — 04 OQ9). */
export async function recordStatusReport(projectCode: string, input: StatusReportInput, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const actor = await findPerson(tx, actorName);
    const [r] = await tx
      .insert(statusReports)
      .values({ projectId: p.id, period: input.period, audience: input.audience, sections: input.sections, note: input.note?.trim() || null, statusDate: await businessToday(tx), generatedByPersonId: actor?.id ?? null })
      .returning({ id: statusReports.id });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: 'Status report',
      change: `generated · ${reportPeriod.label(input.period)} · ${reportAudience.label(input.audience)}`, area: 'Trends', entityType: 'status_report', entityId: r.id, projectId: p.id,
    });
  });
}

export interface SnapshotInput {
  statusDate: string;
  cpi: number;
  spi: number;
  eacKeur: number;
  floatDays: number;
  riskEmvKeur: number;
  milestoneSlipDays: number;
}

/** Freezes (or re-freezes) the snapshot of a status date — the weekly job of 11 §3.3. */
export async function freezeSnapshot(projectCode: string, s: SnapshotInput): Promise<void> {
  const db = await getDb();
  const p = await requireProject(db, projectCode);
  const weekCode = `W${isoWeekOf(s.statusDate)}`;
  const values = {
    projectId: p.id, weekCode, statusDate: s.statusDate, cpi: s.cpi, spi: s.spi, eacKeur: s.eacKeur, floatDays: s.floatDays,
    riskEmvKeur: s.riskEmvKeur, milestoneSlipDays: s.milestoneSlipDays, frozenAt: new Date(),
  };
  await db.insert(statusSnapshots).values(values).onConflictDoUpdate({ target: [statusSnapshots.projectId, statusSnapshots.weekCode], set: values });
}
