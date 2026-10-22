import 'server-only';
// Progress and SPI published to the other EPC2I tools (R-189, Arche K-04: pub_avancement_projets). Both are computed in
// TypeScript — the earned value of the project's activities at its data date (src/server/dal/evm.ts), the same figures the
// projects register, the Home and the Budget show — so a SQL view cannot compute them: the scheduled job `share-progress`
// keeps them in `share_project_progress`, which the view reads. A project without activity budgets keeps its own figures
// (projects.progress / projects.spi), as on every screen. A row changes (and its `updated_at`, the view's `maj_le`, moves)
// only when a value changes, so an incremental reader sees nothing new after a refresh that changed nothing.
// Sales side only (P-05 / AC-2): the actual cost, CPI and EAC the earned value also yields are never stored here.
import { eq } from 'drizzle-orm';
import { projectDataDate } from '@/domain/ch4-defaults';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { projects, shareProjectProgress } from '@/server/db/schema';
import { listProjectEvms } from './evm';

export interface ShareProgressRow {
  projectCode: string;
  situationOn: string;
  progressPct: number;
  spi: number | null;
}

/** Progress (0–1) → %, one decimal; SPI to two decimals (the screens' rounding). */
export const progressPctOf = (progress: number) => Math.round(progress * 1000) / 10;
export const spiOf = (spi: number | null | undefined) => (spi == null || !Number.isFinite(spi) ? null : Math.round(spi * 100) / 100);

/** The figures every project would publish now (pure read). */
export async function computeShareProgress(): Promise<ShareProgressRow[]> {
  const db = await getDb();
  const [today, evms, rows] = await Promise.all([
    businessToday(db),
    listProjectEvms(),
    db.select({ code: projects.code, progress: projects.progress, spi: projects.spi, dataDate: projects.dataDate }).from(projects),
  ]);
  return rows.map((p) => {
    const evm = evms.get(p.code);
    return {
      projectCode: p.code,
      situationOn: evm ? evm.dataDate : projectDataDate(p, today),
      progressPct: progressPctOf(evm ? evm.progress : p.progress),
      spi: spiOf(evm ? evm.spi : p.spi),
    };
  });
}

/** Writes the figures of every project; returns how many rows were created or changed. Idempotent. */
export async function refreshShareProgress(): Promise<{ projects: number; changed: number }> {
  const figures = await computeShareProgress();
  const db = await getDb();
  return db.transaction(async (tx) => {
    const ids = new Map((await tx.select({ id: projects.id, code: projects.code }).from(projects)).map((r) => [r.code, r.id]));
    const stored = new Map((await tx.select().from(shareProjectProgress)).map((r) => [r.projectId, r]));
    let changed = 0;
    for (const f of figures) {
      const projectId = ids.get(f.projectCode);
      if (!projectId) continue;
      const old = stored.get(projectId);
      if (old && old.situationOn === f.situationOn && old.progressPct === f.progressPct && old.spi === f.spi) continue;
      const values = { situationOn: f.situationOn, progressPct: f.progressPct, spi: f.spi, updatedAt: new Date() };
      if (old) await tx.update(shareProjectProgress).set(values).where(eq(shareProjectProgress.projectId, projectId));
      else await tx.insert(shareProjectProgress).values({ projectId, ...values });
      changed++;
    }
    return { projects: figures.length, changed };
  });
}
