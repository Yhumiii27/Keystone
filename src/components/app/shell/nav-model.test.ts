import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { buildSidebar, crumbBase, matchScreen, searchNav, swapProjectInPath } from './nav-model';

describe('matchScreen', () => {
  it('maps URLs to registry screens', () => {
    expect(matchScreen('/')).toEqual({ id: 'home' });
    expect(matchScreen('/projects/HLT-026/plan')).toEqual({ id: 'plan', code: 'HLT-026' });
    expect(matchScreen('/projects/HLT-026/engineering/process')).toEqual({ id: 'eng-process', code: 'HLT-026' });
    expect(matchScreen('/my/tasks/T-2314')).toEqual({ id: 'task', taskId: 'T-2314' });
    expect(matchScreen('/resources/approvals/Engineering')).toEqual({ id: 'approvals' });
    expect(matchScreen('/resources/approvals/Engineering', 'exact')).toBeNull();
    expect(matchScreen('/nope', 'exact')).toBeNull();
    expect(matchScreen('/projects/HLT-026/nope', 'exact')).toBeNull();
  });
  it('swaps the project and keeps the screen', () => {
    expect(swapProjectInPath('/projects/HLT-026/budget', 'NDC-031')).toBe('/projects/NDC-031/budget');
  });
});

describe('crumbBase (crumbOf)', () => {
  it('section · group or fixed fallbacks', () => {
    expect(crumbBase('risks')).toBe('Project · Control');
    expect(crumbBase('eng-elec')).toBe('Project · Project engineering');
    expect(crumbBase('overview')).toBe('Portfolio');
    expect(crumbBase('task')).toBe('My work');
    expect(crumbBase('docs')).toBe('Documents');
    expect(crumbBase('client')).toBe('Keystone');
  });
});

describe('buildSidebar (docs/spec/01 §4.3–4.6)', () => {
  const base = { badges: { meetings: '1', interfaces: '1', risks: '1', site: 'NO GO', eco: '1' }, navOpen: {}, subs: { project: '#026 · Harbor Line Terminal Expansion' } };

  it('defaults: Project open with Steering group open, other sections closed with counts/badges', () => {
    const m = buildSidebar({ ...base, role: 'director', active: 'home' });
    expect(m.fixed.map((e) => e.id)).toEqual(['home', 'myprojects', 'mywork', 'myapprovals', 'docs']);
    const project = m.sections.find((s) => s.key === 'project')!;
    expect(project.open).toBe(true);
    const groups = project.rows.filter((r) => r.kind === 'group');
    expect(groups.map((g) => [g.label, g.open, g.badge, g.count])).toEqual([
      ['Contract', false, '', '2'],
      ['Steering', true, '', ''],
      ['Team & exchanges', false, '2', ''],
      ['Project engineering', false, '', '7'],
      ['Control', false, '1', ''],
      ['Site & handover', false, '!', ''],
      ['Project review', false, '', '2'],
    ]);
    const items = project.rows.filter((r) => r.kind === 'item').map((r) => (r.kind === 'item' ? r.entry.id : ''));
    expect(items).toEqual(['plan', 'schedule', 'budget', 'hours', 'contingency', 'presources']);
    const portfolio = m.sections.find((s) => s.key === 'portfolio')!;
    expect([portfolio.open, portfolio.count, portfolio.badge]).toEqual([false, '6', '']);
    expect(m.sections.find((s) => s.key === 'tech')!.badge).toBe('1');
  });

  it('closed sections still show the active item; client sees My project', () => {
    const m = buildSidebar({ ...base, role: 'client', active: 'changes', navOpen: { project: false } });
    expect(m.fixed.map((e) => e.id)).toEqual(['home', 'client', 'myapprovals', 'docs']);
    const project = m.sections.find((s) => s.key === 'project')!;
    expect(project.rows.filter((r) => r.kind === 'item').map((r) => (r.kind === 'item' ? r.entry.id : ''))).toEqual(['changes']);
  });

  it('prepends the Outside my workspace section', () => {
    const m = buildSidebar({ ...base, role: 'member', active: 'plan' });
    expect(m.sections[0].key).toBe('outside');
    expect(m.sections[0].rows).toEqual([{ kind: 'item', entry: { id: 'plan', label: 'Plan — WBS', badge: '', active: true } }]);
    const t = buildSidebar({ ...base, role: 'pm', active: 'task' });
    expect(t.sections[0].rows[0]).toMatchObject({ entry: { id: 'mywork', label: 'My tasks' } });
  });

  it('page search matches FR and EN labels, accessible pages only, max 8', () => {
    const m = buildSidebar({ ...base, role: 'director', active: null });
    const fr = makeT('fr');
    expect(searchNav(m.searchable, 'risq', fr).map((h) => h.id)).toEqual(['risks']);
    expect(searchNav(m.searchable, 'risk', fr).map((h) => h.id)).toEqual(['risks']);
    expect(searchNav(m.searchable, 'e', fr)).toHaveLength(8);
    const eng = searchNav(m.searchable, 'P&ID', fr)[0];
    expect(eng.section).toBe('Project engineering');
    const member = buildSidebar({ ...base, role: 'member', active: null });
    expect(searchNav(member.searchable, 'budget', fr)).toEqual([]);
  });
});
