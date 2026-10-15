// R-150 (R-8c a): the rules of the My work board's status moves — drag payload, drop acceptance, the "Move to…" targets and
// the optimistic update shared with the list's done toggle. Pure (client islands and tests).
import { TASK_STATUSES, applyStatus, toggleDone, type TaskStatus } from '@/domain/tasks';

/** Drag payload type of a board card: drops without it (links, files, selected text) are ignored. */
export const TASK_DRAG_TYPE = 'application/x-keystone-task';

/** A drag carries a board card (dragover must accept it, or the drop never fires). */
export const acceptsDrag = (types: readonly string[]) => types.includes(TASK_DRAG_TYPE);

/** "Move to…" menu: the three other statuses, board order. */
export const moveTargets = (status: TaskStatus): TaskStatus[] => TASK_STATUSES.filter((s) => s !== status);

/** A move changes something: the task is on the board and its status differs (a drop on its own column does nothing). */
export const isMove = (items: readonly { id: string; status: TaskStatus }[], id: string, status: TaskStatus) =>
  items.some((x) => x.id === id && x.status !== status);

/** Optimistic changes of the person's tasks: the list's done toggle and the board's status move. */
export type WorkOp = { kind: 'toggle'; id: string } | { kind: 'status'; id: string; status: TaskStatus };

/** Applies an optimistic change (status ⇄ % coupling of src/domain/tasks.ts: done ⇒ 100 %, leaving done from 100 % ⇒ 75 %). */
export function applyWorkOp<T extends { id: string; status: TaskStatus; pct: number }>(cur: readonly T[], op: WorkOp): T[] {
  return cur.map((x) => (x.id !== op.id ? x : { ...x, ...(op.kind === 'toggle' ? toggleDone(x) : applyStatus(x, op.status)) }));
}
