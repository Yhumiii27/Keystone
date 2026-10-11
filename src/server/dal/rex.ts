import 'server-only';
// Lessons learned & project closure DAL (docs/spec/07 §2.7). Keystone owns the REX register (LL-nn), the closure
// checklist and the customer-satisfaction survey (read-only). Projects without data have none (empty tables, "—" KPIs).
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { demoFloor } from '@/server/db/helpers';
import {
  CLOSURE_NEXT, LESSON_APPLIES_TO, closureItemStatus, lessonStatus, lessonTheme, nextBusinessNumber,
  type ClosureItemStatus, type LessonStatus, type LessonTheme,
} from '@/server/db/codes';
import { closureItems, lessonsLearned, satisfactionScores } from '@/server/db/schema';
import { optionalText, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

export type { Actor };
export { LESSON_APPLIES_TO };

export interface LessonRow {
  number: string;
  theme: LessonTheme;
  themeLabel: string;
  whatHappened: string;
  impact: string;
  recommendation: string;
  appliesTo: string;
  status: LessonStatus;
  statusLabel: string;
  /** "Validate" (Proposed → Validated) / "Mark applied" (Validated → Applied); null once applied. */
  next: LessonStatus | null;
}

export interface ClosureRow {
  position: number;
  item: string;
  owner: string;
  status: ClosureItemStatus;
  statusLabel: string;
}

export interface SatisfactionRow {
  criterion: string;
  /** 0–5 by 0.5. */
  score: number;
}

export interface ProjectRex {
  projectCode: string;
  lessons: LessonRow[];
  closure: ClosureRow[];
  satisfaction: SatisfactionRow[];
}

const LESSON_NEXT: Record<LessonStatus, LessonStatus | null> = { proposed: 'validated', validated: 'applied', applied: null };

/** Lessons, closure checklist and survey of a project (each empty when none). */
export async function getRex(projectCode: string): Promise<ProjectRex> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [ll, cl, sat] = await Promise.all([
    db.select().from(lessonsLearned).where(eq(lessonsLearned.projectId, p.id)).orderBy(asc(lessonsLearned.position)),
    db.select().from(closureItems).where(eq(closureItems.projectId, p.id)).orderBy(asc(closureItems.position)),
    db.select().from(satisfactionScores).where(eq(satisfactionScores.projectId, p.id)).orderBy(asc(satisfactionScores.position)),
  ]);
  return {
    projectCode,
    lessons: ll.map((l) => ({
      number: l.number, theme: l.theme, themeLabel: lessonTheme.label(l.theme), whatHappened: l.whatHappened, impact: l.impact, recommendation: l.recommendation,
      appliesTo: l.appliesTo, status: l.status, statusLabel: lessonStatus.label(l.status), next: LESSON_NEXT[l.status],
    })),
    closure: cl.map((c) => ({ position: c.position, item: c.item, owner: c.ownerName, status: c.status, statusLabel: closureItemStatus.label(c.status) })),
    satisfaction: sat.map((s) => ({ criterion: s.criterion, score: s.score })),
  };
}

export interface NewLessonInput {
  theme: LessonTheme;
  whatHappened: string;
  impact?: string | null;
  recommendation: string;
  appliesTo: string;
}

/** "Add lesson learned" (AF.rex): Proposed, numbered LL-10, LL-11… per project, impact "—" when empty. */
export async function addLesson(projectCode: string, input: NewLessonInput, actor: Actor): Promise<string> {
  requireWorkspace('rex', actor, 'Lessons learned & closure');
  if (!lessonTheme.isCode(input.theme)) throw new Error('Invalid theme');
  const whatHappened = requiredText(input.whatHappened, 'What happened', 1000);
  const recommendation = requiredText(input.recommendation, 'Recommendation', 1000);
  const appliesTo = requiredText(input.appliesTo, 'Applies to', 200);
  const impact = optionalText(input.impact, 'Impact', 500) ?? '—';
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const existing = await tx.select({ n: lessonsLearned.number, pos: lessonsLearned.position }).from(lessonsLearned).where(eq(lessonsLearned.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'LL-', 2, await demoFloor(tx, 9));
    const who = await whoIs(tx, actor);
    const [row] = await tx.insert(lessonsLearned).values({
      projectId: p.id, number, theme: input.theme, whatHappened, impact, recommendation, appliesTo, status: 'proposed', raisedByName: who.who, raisedByPersonId: who.personId,
      position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0),
    }).returning({ id: lessonsLearned.id });
    await trace(tx, who, {
      objectRef: number, change: `lesson recorded · ${lessonTheme.label(input.theme)} · to be validated`, area: 'REX', entityType: 'lesson_learned', entityId: row.id, projectId: p.id,
      activity: { text: `Recorded lesson learned ${number} (${lessonTheme.label(input.theme)})`, kind: 'comment' },
    });
    return number;
  });
}

/** "Validate" / "Mark applied": one step of a lesson. Returns the new status. */
export async function advanceLesson(projectCode: string, number: string, actor: Actor): Promise<LessonStatus> {
  requireWorkspace('rex', actor, 'Lessons learned & closure');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [l] = await tx.select().from(lessonsLearned).where(and(eq(lessonsLearned.projectId, p.id), eq(lessonsLearned.number, number)));
    if (!l) throw new Error(`Unknown lesson ${number} on ${projectCode}`);
    const next = LESSON_NEXT[l.status];
    if (!next) throw new Error(`${number} is already applied`);
    await tx.update(lessonsLearned).set({ status: next, updatedAt: new Date() }).where(eq(lessonsLearned.id, l.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: number, change: `status: ${lessonStatus.label(l.status)} → ${lessonStatus.label(next)}`, area: 'REX', entityType: 'lesson_learned', entityId: l.id, projectId: p.id,
    });
    return next;
  });
}

/** Closure checklist click: Not started → In progress → Done → Not started. Returns the new status. */
export async function cycleClosureItem(projectCode: string, position: number, actor: Actor): Promise<ClosureItemStatus> {
  requireWorkspace('rex', actor, 'Lessons learned & closure');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    const [c] = await tx.select().from(closureItems).where(and(eq(closureItems.projectId, p.id), eq(closureItems.position, position)));
    if (!c) throw new Error(`Unknown closure item ${position} on ${projectCode}`);
    const next = CLOSURE_NEXT[c.status];
    await tx.update(closureItems).set({ status: next, updatedAt: new Date() }).where(eq(closureItems.id, c.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Closure · ${c.item}`, change: `status: ${closureItemStatus.label(c.status)} → ${closureItemStatus.label(next)}`, area: 'REX', entityType: 'closure_item', entityId: c.id,
      projectId: p.id,
    });
    return next;
  });
}
