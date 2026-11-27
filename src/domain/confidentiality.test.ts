// ING-29 (owner, 27 Nov 2026): the project team (named team ∪ assignees ∪ internal stakeholders) and who sees a confidential project.
import { describe, expect, it } from 'vitest';
import { canSeeProject, canSetConfidentiality, DIRECTOR_SEES_CONFIDENTIAL, isProjectConfidentiality, onProjectTeam, projectTeam, PUBLISHED_CONFIDENTIALITY } from './confidentiality';

const P = (id: string, short: string) => ({ personId: id, short });

describe('projectTeam', () => {
  const team = projectTeam({
    pm: P('pm', 'A. Naveau'),
    members: [{ ...P('ag', 'A. Girard'), role: 'referent' }, { ...P('pm', 'A. Naveau'), role: 'pm' }],
    assignees: [P('jw', 'J. Wagner'), P('ag', 'A. Girard')],
    stakeholders: [{ ...P('mk', 'M. Kerviel'), role: 'Sponsor', internal: true }, { ...P('cl', 'Client PM'), role: 'Client PM', internal: false }],
  });

  it('is the union of the named team, the assignees and the internal stakeholders, one fact per person and origin', () => {
    expect(team.map((f) => `${f.personId}:${f.origin}`)).toEqual(['pm:equipe', 'ag:equipe', 'jw:affectation', 'ag:affectation', 'mk:partie_prenante']);
    expect(team[0].role).toBe('pm');
    expect(team.find((f) => f.personId === 'mk')?.role).toBe('Sponsor');
  });

  it('never holds an external contact', () => {
    expect(team.some((f) => f.personId === 'cl')).toBe(false);
  });

  it('matches a signed-in user by person and a demo persona by short name', () => {
    expect(onProjectTeam({ role: 'member', personId: 'jw', short: 'x' }, team)).toBe(true);
    expect(onProjectTeam({ role: 'member', personId: null, short: 'M. Kerviel' }, team)).toBe(true);
    expect(onProjectTeam({ role: 'member', personId: 'zz', short: 'J. Wagner' }, team)).toBe(false);
  });
});

describe('canSeeProject', () => {
  const team = [P('pm', 'A. Naveau')];
  it('a normal project is seen by everyone', () => {
    expect(canSeeProject({ role: 'member', personId: 'x', short: 'X' }, 'normal', [])).toBe(true);
  });
  it('a confidential project only by its team — the director included (default)', () => {
    expect(DIRECTOR_SEES_CONFIDENTIAL).toBe(false);
    expect(canSeeProject({ role: 'director', personId: null, short: 'M. Lefebvre' }, 'confidential', team)).toBe(false);
    expect(canSeeProject({ role: 'pm', personId: 'pm', short: '?' }, 'confidential', team)).toBe(true);
    expect(canSeeProject({ role: 'pm', personId: 'other', short: 'A. Naveau' }, 'confidential', team)).toBe(false);
  });
});

describe('values and rights', () => {
  it('two values, published in French', () => {
    expect(isProjectConfidentiality('confidential')).toBe(true);
    expect(isProjectConfidentiality('confidentiel')).toBe(false);
    expect(PUBLISHED_CONFIDENTIALITY).toEqual({ normal: 'normal', confidential: 'confidentiel' });
  });
  it('the leads and the director set it', () => {
    expect(canSetConfidentiality('director', { lead: false })).toBe(true);
    expect(canSetConfidentiality('pm', { lead: true })).toBe(true);
    expect(canSetConfidentiality('member', { lead: false })).toBe(false);
  });
});
