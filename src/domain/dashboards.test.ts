// R-203 (K-203): the pure rules of the user dashboards — layout schema, widget rights per persona, layout edits, period filter.
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@/config/personas';
import { canSee } from '@/config/role-screens';
import { DEMO_TODAY_ISO } from './clock';
import {
  DASHBOARD_MAX_WIDGETS, EMPTY_LAYOUT, WIDGET_KINDS, addWidget, availableKinds, availableMetrics, canSeeWidget, cleanDashboardName, defaultWidget, forbiddenWidget,
  inPeriod, layoutSchema, moveWidget, moveWidgetTo, nextWidgetId, parseLayout, removeWidget, replaceWidget, resizeWidget, starterLayout, widgetScreen, type DashboardLayout,
  type Widget,
} from './dashboards';

const kpi = (id: string, metric: 'cpi' | 'spi' = 'cpi'): Widget => ({ id, kind: 'portfolio-kpi', size: 's', metric, scope: 'all', zone: null });
const layoutOf = (...widgets: Widget[]): DashboardLayout => ({ version: 1, widgets });

describe('layout schema', () => {
  it('accepts every kind with its parameters, refuses unknown keys, kinds, metrics, projects and duplicate ids', () => {
    const all: Widget[] = WIDGET_KINDS.map((d, i) => ({ ...defaultWidget(d.kind, { role: 'director', project: 'HLT-026' }), id: `w${i}` }) as Widget);
    expect(layoutSchema.safeParse(layoutOf(...all)).success).toBe(true);
    expect(layoutSchema.safeParse({ version: 1, widgets: [{ ...kpi('a'), extra: 1 }] }).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 1, widgets: [{ ...kpi('a'), kind: 'sql-query' }] }).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 1, widgets: [{ ...kpi('a'), metric: 'salary' }] }).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 1, widgets: [{ id: 'a', kind: 'project-evm', size: 's', project: '' }] }).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 1, widgets: [{ id: 'a', kind: 'project-evm', size: 's', project: "x'; drop" }] }).success).toBe(false);
    expect(layoutSchema.safeParse(layoutOf(kpi('a'), kpi('a'))).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 2, widgets: [] }).success).toBe(false);
    expect(layoutSchema.safeParse({ version: 1, widgets: Array.from({ length: DASHBOARD_MAX_WIDGETS + 1 }, (_, i) => kpi(`w${i}`)) }).success).toBe(false);
    expect(parseLayout('nope')).toBeNull();
    expect(parseLayout(layoutOf(kpi('a')))).toEqual(layoutOf(kpi('a')));
  });

  it('cleans a name: trimmed, spaces collapsed, 1 to 80 characters', () => {
    expect(cleanDashboardName('  Mon   tableau ')).toBe('Mon tableau');
    expect(cleanDashboardName('   ')).toBeNull();
    expect(cleanDashboardName('x'.repeat(81))).toBeNull();
    expect(cleanDashboardName(42)).toBeNull();
  });
});

describe('widget rights per persona', () => {
  it.each(PERSONAS.map((p) => p.role))('%s: a widget is visible exactly when its source screen is in the workspace', (role) => {
    for (const d of WIDGET_KINDS)
      for (const metric of [undefined, 'cpi', 'openTasks', 'pendingApprovals', 'openRisks', 'openPunch', 'lateMilestones', 'progress']) {
        const w = { kind: d.kind, metric };
        expect(canSeeWidget(role, w), `${d.kind} ${metric}`).toBe(role !== 'client' && canSee(role, widgetScreen(w)));
      }
  });

  it('the client has no dashboards and no widget; every internal role has the screen and some widgets', () => {
    expect(availableKinds('client')).toEqual([]);
    for (const p of PERSONAS.filter((x) => x.role !== 'client')) {
      expect(canSee(p.role, 'dashboards'), p.role).toBe(true);
      expect(availableKinds(p.role).length, p.role).toBeGreaterThan(0);
    }
  });

  it('the team member gets no portfolio, risk, punch or budget widget; the director gets them all', () => {
    expect(availableKinds('member').map((k) => k.kind)).toEqual(['my-kpi', 'my-tasks', 'project-kpi']);
    expect(availableMetrics('member', 'project-kpi')).toEqual(['progress', 'cpi', 'spi']);
    expect(availableMetrics('member', 'my-kpi')).toEqual(['openTasks', 'overdueTasks']);
    expect(availableKinds('director').map((k) => k.kind)).toEqual(WIDGET_KINDS.map((k) => k.kind));
    expect(forbiddenWidget('member', layoutOf(kpi('a')))?.id).toBe('a');
    expect(forbiddenWidget('director', layoutOf(kpi('a')))).toBeNull();
  });

  it.each(PERSONAS.map((p) => p.role))('%s: the starter layout holds only widgets the role may see', (role) => {
    const l = starterLayout(role, 'HLT-026');
    expect(layoutSchema.safeParse(l).success).toBe(true);
    expect(forbiddenWidget(role, l)).toBeNull();
    if (role === 'client') expect(l.widgets).toEqual([]);
  });
});

describe('layout edits', () => {
  const l = layoutOf(kpi('a'), kpi('b'), kpi('c'));
  it('add gives a fresh id; remove, replace, resize', () => {
    expect(nextWidgetId(l)).toBe('w1');
    const added = addWidget(l, { kind: 'my-kpi', size: 's', metric: 'openTasks' });
    expect(added.widgets.map((w) => w.id)).toEqual(['a', 'b', 'c', 'w1']);
    expect(addWidget(added, { kind: 'my-kpi', size: 's', metric: 'openTasks' }).widgets.at(-1)!.id).toBe('w2');
    expect(removeWidget(l, 'b').widgets.map((w) => w.id)).toEqual(['a', 'c']);
    expect(replaceWidget(l, kpi('b', 'spi')).widgets[1]).toMatchObject({ id: 'b', metric: 'spi' });
    expect(resizeWidget(l, 'c', 'l').widgets[2].size).toBe('l');
    const full = layoutOf(...Array.from({ length: DASHBOARD_MAX_WIDGETS }, (_, i) => kpi(`x${i}`)));
    expect(addWidget(full, { kind: 'my-kpi', size: 's', metric: 'openTasks' })).toBe(full);
  });

  it('moves by one place (the keyboard buttons) and to an index (drag), clamped at the ends', () => {
    const ids = (x: DashboardLayout) => x.widgets.map((w) => w.id).join('');
    expect(ids(moveWidget(l, 'b', -1))).toBe('bac');
    expect(ids(moveWidget(l, 'b', 1))).toBe('acb');
    expect(moveWidget(l, 'a', -1)).toBe(l);
    expect(moveWidget(l, 'c', 5)).toBe(l);
    expect(moveWidget(l, 'zz', 1)).toBe(l);
    expect(ids(moveWidgetTo(l, 'c', 0))).toBe('cab');
    expect(ids(moveWidgetTo(l, 'a', 2))).toBe('bca');
    expect(EMPTY_LAYOUT.widgets).toEqual([]);
  });
});

describe('period filter (business date)', () => {
  const today = DEMO_TODAY_ISO;
  it('overdue = before today; week / month include the overdue; all includes no due date', () => {
    expect(inPeriod('2026-09-24', today, 'overdue')).toBe(true);
    expect(inPeriod(today, today, 'overdue')).toBe(false);
    expect(inPeriod('2026-09-24', today, 'week')).toBe(true);
    expect(inPeriod('2026-10-02', today, 'week')).toBe(true);
    expect(inPeriod('2026-10-03', today, 'week')).toBe(false);
    expect(inPeriod('2026-10-25', today, 'month')).toBe(true);
    expect(inPeriod('2026-10-26', today, 'month')).toBe(false);
    expect(inPeriod(null, today, 'month')).toBe(false);
    expect(inPeriod(null, today, 'all')).toBe(true);
  });
});
