// R-027 (NEW-CURSUS-2 "a"): matching Cursus's staff directory with Keystone's persons — matricule first, then the work
// e-mail among EPC2i persons; ambiguous e-mails reported; external contacts never touched; new persons with a unique short
// name; existing short names, names and e-mails never overwritten; team → department by exact name only.
import { describe, expect, it } from 'vitest';
import { directoryEntryOf, initialsOf, planDirectoryImport, shortNameOf, uniqueShortName, type DirectoryEntry, type DirectoryPerson } from './directory';

const P = (id: string, over: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  id, fullName: null, shortName: id, email: null, matricule: null, clientId: null, departmentId: null, directoryTeam: null, ...over,
});
const E = (matricule: string, over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({ matricule, nom: 'Wagner', prenom: 'Julien', email: null, equipe: null, ...over });
const DEPTS = [{ id: 'd-eng', name: 'Engineering' }, { id: 'd-site', name: 'Site operations' }];

describe('directory rows', () => {
  it('keeps a usable row (trimmed, e-mail lower-cased, invalid e-mail dropped); refuses rows without matricule or name', () => {
    expect(directoryEntryOf({ matricule: ' EMP-0018 ', nom: ' Wagner ', prenom: 'Julien', email: 'Julien.Wagner@EPC2i.fr', equipe: 'Engineering' }))
      .toEqual({ matricule: 'EMP-0018', nom: 'Wagner', prenom: 'Julien', email: 'julien.wagner@epc2i.fr', equipe: 'Engineering' });
    expect(directoryEntryOf({ matricule: 'EMP-1', nom: 'A', prenom: 'B', email: 'not-an-email' })).toMatchObject({ email: null, equipe: null });
    for (const raw of [null, [], 'x', { nom: 'A', prenom: 'B' }, { matricule: 'EMP 1', nom: 'A', prenom: 'B' }, { matricule: 'EMP-1', nom: '', prenom: 'B' }])
      expect(directoryEntryOf(raw), JSON.stringify(raw)).toBeNull();
  });

  it('short names and initials', () => {
    expect([shortNameOf('Julien', 'Wagner'), shortNameOf('Jean-Paul', 'Martin'), shortNameOf('élodie', 'Roux')]).toEqual(['J. Wagner', 'J.-P. Martin', 'É. Roux']);
    expect(initialsOf('Julien', 'Wagner')).toBe('JW');
    const taken = new Set(['j. wagner', 'j. wagner (2)']);
    expect(uniqueShortName('J. Wagner', taken)).toBe('J. Wagner (3)');
    expect(uniqueShortName('A. Diallo', taken)).toBe('A. Diallo');
  });
});

describe('planDirectoryImport', () => {
  it('matches by matricule, then by e-mail (case-insensitive); fills what is missing, never renames nor overwrites', () => {
    const persons = [
      P('p1', { shortName: 'J. Wagner', fullName: 'Julien Wagner', matricule: 'EMP-0018', email: 'julien.wagner@epc2i.fr', departmentId: 'd-eng' }),
      P('p2', { shortName: 'A. Ollivier', email: 'Amelie.Ollivier@epc2i.fr' }),
    ];
    const plan = planDirectoryImport([
      E('EMP-0018', { nom: 'Wagner-Roy', prenom: 'Julien', email: 'jw@other.fr', equipe: 'Engineering' }),
      E('EMP-0020', { nom: 'Ollivier', prenom: 'Amélie', email: 'amelie.ollivier@epc2i.fr', equipe: 'Site ops' }),
    ], persons, DEPTS);
    expect(plan.matched).toEqual([{ matricule: 'EMP-0018', personId: 'p1' }, { matricule: 'EMP-0020', personId: 'p2' }]);
    // p1: nothing changes (same department, its name and e-mail kept). p2: matricule, full name, team kept as text.
    expect(plan.updates).toEqual([{ personId: 'p2', set: { matricule: 'EMP-0020', fullName: 'Amélie Ollivier', directoryTeam: 'Site ops' } }]);
    expect(plan.creates).toEqual([]);
    expect(plan.unmatchedTeams).toEqual(['Site ops']);
  });

  it('an e-mail held by several persons matches nobody and is reported; no person is created with it', () => {
    const persons = [P('p1', { email: 'shared@epc2i.fr' }), P('p2', { email: 'SHARED@epc2i.fr' })];
    const plan = planDirectoryImport([E('EMP-1', { email: 'shared@epc2i.fr' })], persons, DEPTS);
    expect([plan.matched, plan.updates, plan.creates]).toEqual([[], [], []]);
    expect(plan.reports).toEqual([{ matricule: 'EMP-1', reason: 'E-mail held by several persons: not matched' }]);
  });

  it('external contacts are never matched nor touched, and their e-mail is never given to a new person', () => {
    const persons = [P('ext', { email: 'n.bensaid@port-lehavre.fr', clientId: 'c1', shortName: 'N. Bensaïd' })];
    const plan = planDirectoryImport([E('EMP-2', { nom: 'Bensaïd', prenom: 'Nadia', email: 'n.bensaid@port-lehavre.fr' })], persons, DEPTS);
    expect([plan.matched, plan.updates, plan.creates]).toEqual([[], [], []]);
    expect(plan.reports[0].reason).toBe('E-mail held by an external contact: not matched');
  });

  it('creates the persons nobody matches: unique short name, initials, department by exact name only', () => {
    const persons = [P('p1', { shortName: 'J. Wagner' })];
    const plan = planDirectoryImport([
      E('EMP-3', { email: 'julien.wagner2@epc2i.fr', equipe: 'Engineering' }),
      E('EMP-4', { nom: 'Diallo', prenom: 'Aïcha', equipe: 'engineering' }),
    ], persons, DEPTS);
    expect(plan.creates).toEqual([
      { matricule: 'EMP-3', fullName: 'Julien Wagner', shortName: 'J. Wagner (2)', initials: 'JW', email: 'julien.wagner2@epc2i.fr', departmentId: 'd-eng', directoryTeam: null },
      { matricule: 'EMP-4', fullName: 'Aïcha Diallo', shortName: 'A. Diallo', initials: 'AD', email: null, departmentId: null, directoryTeam: 'engineering' },
    ]);
  });

  it('a matricule listed twice, a person matched twice, an e-mail given to two new persons, a person with another matricule: reported', () => {
    const persons = [P('p1', { email: 'a@epc2i.fr', matricule: 'EMP-9' }), P('p2', { email: 'b@epc2i.fr' })];
    const plan = planDirectoryImport([
      E('EMP-5', { email: 'a@epc2i.fr' }), // p1 carries EMP-9
      E('EMP-6', { email: 'b@epc2i.fr' }),
      E('EMP-7', { email: 'b@epc2i.fr' }), // p2 already matched by EMP-6
      E('EMP-6'),
      E('EMP-8', { email: 'new@epc2i.fr' }),
      E('EMP-10', { email: 'new@epc2i.fr', nom: 'Other' }),
    ], persons, DEPTS);
    expect(plan.reports.map((r) => [r.matricule, r.reason])).toEqual([
      ['EMP-5', 'E-mail held by a person with another matricule: not matched'],
      ['EMP-7', 'Person already matched by another entry'],
      ['EMP-6', 'Matricule listed twice in the directory'],
      ['EMP-10', 'E-mail given to another new person of the directory: not created'],
    ]);
    expect(plan.matched).toEqual([{ matricule: 'EMP-6', personId: 'p2' }]);
    expect(plan.creates.map((c) => c.matricule)).toEqual(['EMP-8']);
  });

  it('a missing e-mail is filled in only when nobody else holds it', () => {
    const persons = [P('p1', { matricule: 'EMP-1' }), P('p2', { email: 'taken@epc2i.fr' })];
    expect(planDirectoryImport([E('EMP-1', { email: 'taken@epc2i.fr' })], persons, DEPTS).updates).toEqual([{ personId: 'p1', set: { fullName: 'Julien Wagner' } }]);
    expect(planDirectoryImport([E('EMP-1', { email: 'free@epc2i.fr' })], persons, DEPTS).updates).toEqual([{ personId: 'p1', set: { fullName: 'Julien Wagner', email: 'free@epc2i.fr' } }]);
  });
});
