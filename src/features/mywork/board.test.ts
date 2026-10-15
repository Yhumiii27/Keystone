// R-150 (R-8c a): My work board — status moves by drag-and-drop or the "Move to…" menu. Pure rules (drag payload, targets,
// optimistic coupling) and the static render: editable cards (draggable block, non-draggable title link, menu trigger named
// for its task) versus the read-only board (plain link cards).
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => '/my/tasks' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./actions', () => ({ setTaskStatusAction: vi.fn(), toggleTaskDoneAction: vi.fn() }));

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { TASK_DRAG_TYPE, acceptsDrag, applyWorkOp, isMove, moveTargets } from './board-move';
import { MyWorkBody } from './my-work-body';
import type { WorkItemData } from './model';

const item = (id: string, status: WorkItemData['status'], pct: number, due: number): WorkItemData => ({
  id, href: `/my/tasks/${id}`, title: `Task ${id}`, status, priority: 'med', start: 2, due, estimateH: 8, loggedH: 2, pct, project: 'Harbor Line', activity: 'A1250',
  labels: [], fresh: null, checklist: { done: 1, total: 3 },
});
const ITEMS = [item('T-2301', 'todo', 0, 6), item('T-2302', 'doing', 40, 5), item('T-2303', 'review', 90, 7), item('T-2304', 'done', 100, 3), item('T-2305', 'doing', 100, 4)];

const board = (canEdit: boolean, lang: 'en' | 'fr' = 'en') =>
  renderToStaticMarkup(
    h(I18nProvider, {
      lang,
      children: h(MyWorkBody, { items: ITEMS, loads: null, view: 'board', week: 0, calendarHrefs: { prev: '', next: '' }, canEdit }),
    }),
  );

describe('R-150 — board moves (pure rules)', () => {
  it('only a board card is a drop: its own drag type', () => {
    expect(acceptsDrag([TASK_DRAG_TYPE])).toBe(true);
    expect(acceptsDrag(['text/uri-list', 'text/plain'])).toBe(false);
    expect(acceptsDrag(['Files'])).toBe(false);
  });

  it('"Move to…" lists the three other statuses in board order', () => {
    expect(moveTargets('todo')).toEqual(['doing', 'review', 'done']);
    expect(moveTargets('review')).toEqual(['todo', 'doing', 'done']);
  });

  it('a drop on its own column, or of an unknown task, does nothing', () => {
    expect(isMove(ITEMS, 'T-2302', 'doing')).toBe(false);
    expect(isMove(ITEMS, 'T-9999', 'done')).toBe(false);
    expect(isMove(ITEMS, 'T-2302', 'review')).toBe(true);
  });

  it('optimistic status: done ⇒ 100 %, leaving done from 100 % ⇒ 75 %; the list toggle unchanged', () => {
    expect(applyWorkOp(ITEMS, { kind: 'status', id: 'T-2302', status: 'done' }).find((x) => x.id === 'T-2302')).toMatchObject({ status: 'done', pct: 100 });
    expect(applyWorkOp(ITEMS, { kind: 'status', id: 'T-2304', status: 'review' }).find((x) => x.id === 'T-2304')).toMatchObject({ status: 'review', pct: 75 });
    expect(applyWorkOp(ITEMS, { kind: 'status', id: 'T-2301', status: 'doing' }).find((x) => x.id === 'T-2301')).toMatchObject({ status: 'doing', pct: 0 });
    expect(applyWorkOp(ITEMS, { kind: 'toggle', id: 'T-2301' }).find((x) => x.id === 'T-2301')).toMatchObject({ status: 'done', pct: 100 });
    expect(applyWorkOp(ITEMS, { kind: 'toggle', id: 'T-2304' }).find((x) => x.id === 'T-2304')).toMatchObject({ status: 'doing', pct: 75 });
    // Other tasks untouched (same objects).
    const next = applyWorkOp(ITEMS, { kind: 'status', id: 'T-2302', status: 'done' });
    expect(next.filter((x) => x.id !== 'T-2302')).toEqual(ITEMS.filter((x) => x.id !== 'T-2302'));
  });
});

describe('R-150 — board render', () => {
  it('editable: every card is a draggable block with a non-draggable title link and its "Move to…" trigger; columns by status', () => {
    const html = board(true);
    expect(html.match(/draggable="true"/g)?.length).toBe(ITEMS.length);
    expect(html.match(/draggable="false"/g)?.length).toBe(ITEMS.length);
    for (const x of ITEMS) {
      expect(html).toContain(`data-task-card="${x.id}"`);
      expect(html).toContain(`aria-label="Move to… · ${x.id}"`);
      expect(html).toContain(`href="/my/tasks/${x.id}"`);
    }
    expect(html.match(/aria-haspopup="true"/g)?.length).toBe(ITEMS.length);
    for (const s of ['To do', 'In progress', 'In review', 'Done']) expect(html).toContain(`aria-label="${s}"`);
    // Menus are closed until opened (no menu rows in the markup).
    expect(html).not.toContain('Move to In review');
  });

  it('French: the trigger reads "Déplacer vers…"', () => {
    expect(board(true, 'fr')).toContain('aria-label="Déplacer vers… · T-2301"');
  });

  it('read-only (someone else’s board for a PM, outside the workspace): plain link cards, no drag, no menu', () => {
    const html = board(false);
    expect(html).not.toContain('draggable');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('data-task-card');
    for (const x of ITEMS) expect(html).toContain(`href="/my/tasks/${x.id}"`);
  });

  it('order inside a column stays by due date', () => {
    const html = board(true);
    expect(html.indexOf('data-task-card="T-2305"')).toBeLessThan(html.indexOf('data-task-card="T-2302"'));
  });
});
