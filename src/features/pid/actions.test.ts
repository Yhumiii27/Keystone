// P&ID Server Functions against an in-memory database (session mocked, real project context): the permission gate
// (outside viewers refused server-side), the tag mapping (candidates only, client equipment refused, unlink), and the
// staging import — stage (nothing written), apply (CSV text and .xlsx; new / updated tags, the sheet revision, the
// validation steps, audit and activity, the nav badge), "nothing to import", a project registering its first P&ID,
// "Replace all", and the errors — in EN and FR.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'englead' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { parisParts } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getPidValidation, pidBadgeByProject } from '@/server/dal/pid';
import { getPersonByName } from '@/server/dal/people';
import { addTeamMember } from '@/server/dal/project-team';
import { applyPidImportAction, mapPidTagAction, stagePidImportAction, unlinkPidTagAction, type PidImportRequest } from './actions';
import { xlsxOf } from './test-xlsx';

const HLT = 'HLT-026';
const status = async (code: string, tag: string) => (await getPidValidation(code))!.tags.find((t) => t.tag === tag)?.statusLabel;
const req = (data: string, over: Partial<PidImportRequest> = {}): PidImportRequest => ({ fileName: 'PID-HLT-026_revE_tags.csv', kind: 'text', data, rev: 'E', source: 'excel', mode: 'merge', ...over });

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'englead';
  session.lang = 'en';
  vi.mocked(revalidatePath).mockClear();
});

describe('permission gate', () => {
  it('outside viewers (pm, procurement, member; the client is sent home) and malformed requests are refused; nothing is written', async () => {
    // R-042 (P-1): the client is sent home (was: the read-only refusal).
    session.role = 'client';
    await expect(mapPidTagAction(HLT, 'TT-102', 'EL-SWG-11KV')).rejects.toThrow('REDIRECT /');
    await expect(applyPidImportAction(HLT, req('Tag,Description\nX-1,x'))).rejects.toThrow('REDIRECT /');
    for (const role of ['pm', 'procurement', 'member']) {
      session.role = role;
      expect(await mapPidTagAction(HLT, 'TT-102', 'EL-SWG-11KV'), role).toEqual({ error: 'This P&ID is read-only for you' });
      expect(await unlinkPidTagAction(HLT, 'LT-101'), role).toEqual({ error: 'This P&ID is read-only for you' });
      expect(await stagePidImportAction(HLT, req('Tag,Description\nX-1,x')), role).toEqual({ error: 'This P&ID is read-only for you' });
      expect(await applyPidImportAction(HLT, req('Tag,Description\nX-1,x')), role).toEqual({ error: 'This P&ID is read-only for you' });
    }
    session.lang = 'fr';
    expect(await mapPidTagAction(HLT, 'TT-102', 'EL-SWG-11KV')).toEqual({ error: 'Ce PID est en lecture seule pour vous' });
    session.role = 'quality';
    expect(await mapPidTagAction('NOPE-000', 'TT-102', 'EL-SWG-11KV')).toEqual({ error: 'Projet inconnu' });
    session.lang = 'en';
    expect(await mapPidTagAction(42, 'TT-102', 'EL-SWG-11KV')).toEqual({ error: 'Invalid request' });
    expect(await mapPidTagAction(HLT, { tag: 1 }, 'EL-SWG-11KV')).toEqual({ error: 'Invalid request' });
    expect(await mapPidTagAction(HLT, 'TT-102', '<script>')).toEqual({ error: 'Invalid request' });
    expect(await status(HLT, 'TT-102')).toBe('Unmapped');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('tag mapping', () => {
  it('maps a tag to a candidate (engineering lead): saved with the viewer as the actor', async () => {
    expect(await mapPidTagAction(HLT, 'TT-102', 'el-swg-11kv')).toEqual({ toast: 'Tag linked · TT-102 → EL-SWG-11KV' });
    expect(await status(HLT, 'TT-102')).toBe('Linked');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    expect((await listAudit({ projectCode: HLT, limit: 1 }))[0]).toMatchObject({ who: 'Antoine Girard', object: 'TT-102', change: 'mapped to EL-SWG-11KV', area: 'P&ID' });
    expect(await pidBadgeByProject()).toEqual({ [HLT]: 8 });
    // The reference already mapped again: refused, no second audit row.
    expect(await mapPidTagAction(HLT, 'TT-102', 'EL-SWG-11KV')).toEqual({ error: 'TT-102 is already linked to EL-SWG-11KV' });
    session.lang = 'fr';
    expect(await mapPidTagAction(HLT, 'TT-102', 'EL-SWG-11KV')).toEqual({ error: 'TT-102 est déjà lié à EL-SWG-11KV' });
    session.lang = 'en';
    expect((await listAudit({ projectCode: HLT, limit: 2 })).filter((a) => a.object === 'TT-102')).toHaveLength(1);
  });

  it('refuses a reference that is not a candidate, client equipment, unknown tags (EN / FR)', async () => {
    expect(await mapPidTagAction(HLT, 'PT-201', 'KS-STL-0450')).toEqual({ error: 'KS-STL-0450 is not a BOM article of a compatible type' });
    expect(await mapPidTagAction(HLT, 'T-101', 'EL-SWG-11KV')).toEqual({ error: 'Client-supplied equipment: no BOM reference expected' });
    session.lang = 'fr';
    expect(await mapPidTagAction(HLT, 'T-101', 'EL-SWG-11KV')).toEqual({ error: 'Équipement fourni par le client : aucune référence nomenclature attendue' });
    expect(await mapPidTagAction(HLT, 'NOPE-1', 'EL-SWG-11KV')).toEqual({ error: 'EL-SWG-11KV n’est pas un article de la nomenclature de type compatible' });
    expect(await status(HLT, 'PT-201')).toBe('Unmapped');
  });

  it('unlinks (quality); a second unlink is refused', async () => {
    session.role = 'quality';
    expect(await unlinkPidTagAction(HLT, 'LT-101')).toEqual({ toast: 'Tag unlinked · LT-101' });
    expect(await status(HLT, 'LT-101')).toBe('Unmapped');
    expect((await listAudit({ projectCode: HLT, limit: 1 }))[0]).toMatchObject({ who: 'Gabriel Comte', object: 'LT-101', change: 'unlinked from EL-PLC-S7' });
    expect(await unlinkPidTagAction(HLT, 'LT-101')).toEqual({ error: 'LT-101 is not mapped' });
    session.lang = 'fr';
    expect(await unlinkPidTagAction(HLT, 'LT-101')).toEqual({ error: 'LT-101 n’est associé à aucune référence' });
    session.lang = 'en';
    session.role = 'director';
    expect(await mapPidTagAction(HLT, 'LT-101', 'EL-SWG-11KV')).toEqual({ toast: 'Tag linked · LT-101 → EL-SWG-11KV' });
  });
});

describe('Import P&ID tags (staging import)', () => {
  const CSV = [
    'Tag;Description;Kind;Scope;Reference;Activity;PLC;State feedback;Role;Sheet',
    'XV-111;Automatic valve — transfer line;Instrument;Keystone;;A1410;P;ZSO/ZSC-111 · Open / closed;actuator;4',
    'PT-301;Pressure transmitter — hoist hydraulics;Instrument;Keystone;EL-SWG-11KV;A1320;S;;sensor;5',
    'TK-301;Hydraulic tank;Equipment;Client;;A1320;;;passive;5',
    'FT-302;Flow meter;;;;;;;;',
  ].join('\n');

  it('stage: the plan is shown, nothing is written', async () => {
    const before = await getPidValidation(HLT);
    const r = await stagePidImportAction(HLT, req(CSV));
    expect(r.error).toBeUndefined();
    const st = r.stage!;
    expect([st.revisionLine, st.meta, st.counts.map((c) => `${c.label} ${c.count}`), st.canImport, st.note]).toEqual([
      'Revision C → E', 'Excel list · Add & update · PID-HLT-026_revE_tags.csv', ['New 2', 'Updated 1', 'Unchanged 0', 'Removed 0', 'Rejected 1'], true, null,
    ]);
    expect(st.lines.map((l) => [l.line, l.tag, l.change, l.details.map((d) => d.text)])).toEqual([
      ['2', 'XV-111', 'Updated', ['State feedback']],
      ['3', 'PT-301', 'New', []],
      ['4', 'TK-301', 'New', []],
      ['5', 'FT-302', 'Rejected', ['A new tag needs a kind (Instrument or Equipment)']],
    ]);
    expect(st.columns).toBe('Recognised columns: Tag, Description, Kind, Scope, Reference, Activity, PLC, State feedback, Role, Sheet');
    expect(await getPidValidation(HLT)).toEqual(before);
    session.lang = 'fr';
    const fr = (await stagePidImportAction(HLT, req(CSV))).stage!;
    expect([fr.revisionLine, fr.meta, fr.counts.map((c) => `${c.label} ${c.count}`), fr.lines[3].details[0].text]).toEqual([
      'Révision C → E', 'Liste Excel · Ajouter & mettre à jour · PID-HLT-026_revE_tags.csv', ['Nouveau 2', 'Mis à jour 1', 'Inchangé 0', 'Supprimé 0', 'Refusé 1'],
      'Un nouveau tag doit avoir une nature (Instrument ou Équipement)',
    ]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('apply: tags, sheet revision, validation steps, audit, activity, badge; the same list again is refused', async () => {
    expect(await applyPidImportAction(HLT, req(CSV))).toEqual({ toast: '3 tags · rev E imported · 2 new · 1 updated · 1 rejected' });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    const v = (await getPidValidation(HLT))!;
    const today = parisParts(new Date()).iso;
    expect([v.sheet.revision, v.sheet.issuedOn, v.sheet.sheetCount, v.tags.length]).toEqual(['E', today, 5, 26]);
    expect(v.tags.slice(-2).map((t) => [t.tag, t.statusLabel, t.activityName, t.sheet])).toEqual([
      ['PT-301', 'Linked', 'Crane delivery & rigging', 5],
      ['TK-301', 'Client', 'Crane delivery & rigging', 5],
    ]);
    const xv = v.tags.find((t) => t.tag === 'XV-111')!;
    expect([xv.stateFeedback, xv.feedbackMissing]).toEqual(['ZSO/ZSC-111 · Open / closed', false]);
    expect(v.steps.map((s) => [s.label, s.state, s.dateOn, s.who])).toEqual([
      ['Tags extracted from P&ID rev E', 'done', today, 'A. Girard'],
      ['Tag ↔ BOM reference mapping', 'doing', null, 'A. Girard'],
      ['Overlay scope agreed with client', 'todo', null, 'R. Aubert · N. Bensaïd'],
      ['Process validation review (HAZOP light)', 'todo', null, 'Quality · Engineering'],
      ['P&ID released for construction (rev F)', 'todo', null, 'A. Girard'],
    ]);
    expect((await listAudit({ projectCode: HLT, limit: 1 }))[0]).toMatchObject({
      who: 'Antoine Girard', object: 'PID-HLT-026', change: 'imported 3 tags from PID-HLT-026_revE_tags.csv (rev E, Excel list, Add & update): 2 new, 1 updated, 1 rejected', area: 'P&ID',
    });
    expect((await listActivity({ kind: 'sync', limit: 1 }))[0]).toMatchObject({ who: 'Antoine Girard', what: 'Imported P&ID tags · PID-HLT-026 rev E', projectCode: HLT });
    // 23 tags in our scope (PT-301 new and linked), 15 linked.
    expect(await pidBadgeByProject()).toEqual({ [HLT]: 8 });

    expect(await applyPidImportAction(HLT, req(CSV))).toEqual({ error: 'Nothing to import: every tag is unchanged' });
    const again = (await stagePidImportAction(HLT, req(CSV))).stage!;
    expect([again.canImport, again.note, again.revisionLine]).toEqual([false, 'Nothing to import: every tag is unchanged', 'Revision E (unchanged)']);
    session.lang = 'fr';
    expect(await applyPidImportAction(HLT, req(CSV))).toEqual({ error: 'Rien à importer : tous les tags sont inchangés' });
  });

  it('a project without a P&ID registers one from an .xlsx (French toast); Replace all removes the tags the file drops', async () => {
    session.role = 'quality';
    session.lang = 'fr';
    // R-041 (P-2): the quality manager edits NDC-031's P&ID once on its named team (off the team, it is read-only).
    expect(await stagePidImportAction('NDC-031', req('Tag,Description\nX-1,x'))).toEqual({ error: 'Ce PID est en lecture seule pour vous' });
    await addTeamMember('NDC-031', (await getPersonByName('Gabriel Comte'))!.id, 'referent', { name: 'Marie Lefebvre', personId: null });
    expect(await getPidValidation('NDC-031')).toBeNull();
    const book = xlsxOf([
      ['P&ID tag list — NDC'],
      ['Repère', 'Désignation', 'Nature', 'Périmètre', 'Automate', 'Rôle'],
      ['CRAH-01', 'Unité de climatisation salle 1', 'Équipement', 'Keystone', 'P', 'actionneur'],
      ['TT-01', 'Sonde de température salle 1', 'Instrument', '', 'P', ''],
    ]);
    const xr = { fileName: 'C:\\exports\\PID-NDC-031_revA.xlsx', kind: 'xlsx' as const, data: book.toString('base64'), rev: 'a', source: 'autocad' as const, mode: 'merge' as const };
    const st = (await stagePidImportAction('NDC-031', xr)).stage!;
    expect([st.revisionLine, st.meta, st.canImport]).toEqual(['Enregistre le PID du projet · PID-NDC-031 rév. A', 'Export AutoCAD P&ID · Ajouter & mettre à jour · PID-NDC-031_revA.xlsx', true]);
    expect(await applyPidImportAction('NDC-031', xr)).toEqual({ toast: '2 tags · rév. A importés · 2 nouveaux · 0 mis à jour' });
    const v = (await getPidValidation('NDC-031'))!;
    expect([v.sheet.documentNumber, v.sheet.revision, v.sheet.statusLabel, v.sheet.author, v.tags.map((t) => [t.tag, t.statusLabel, t.feedbackMissing])]).toEqual([
      'PID-NDC-031', 'A', 'Under review', 'Gabriel Comte', [['CRAH-01', 'Unmapped', true], ['TT-01', 'Unmapped', false]],
    ]);
    expect(v.steps.map((s) => [s.label, s.state, s.who])).toEqual([
      ['Tags extracted from P&ID rev A', 'done', 'G. Comte'],
      ['Tag ↔ BOM reference mapping', 'doing', 'G. Comte'],
      ['Overlay scope agreed with client', 'todo', `${v.steps[2].who.split(' · ')[0]} · Client`],
      ['Process validation review (HAZOP light)', 'todo', 'Quality · Engineering'],
      ['P&ID released for construction (rev B)', 'todo', 'G. Comte'],
    ]);
    expect((await pidBadgeByProject())['NDC-031']).toBe(2);

    session.lang = 'en';
    const replace = await applyPidImportAction('NDC-031', { ...xr, data: xlsxOf([['Tag', 'Description'], ['TT-01', 'Room 1 temperature probe']]).toString('base64'), rev: 'B', mode: 'replace' });
    expect(replace).toEqual({ toast: '1 tag · rev B imported · 0 new · 1 updated · 1 removed' });
    const w = (await getPidValidation('NDC-031'))!;
    expect([w.sheet.revision, w.tags.map((t) => [t.tag, t.description]), w.steps[0].label, w.steps[4].label]).toEqual([
      'B', [['TT-01', 'Room 1 temperature probe']], 'Tags extracted from P&ID rev B', 'P&ID released for construction (rev C)',
    ]);
  });

  it('errors: revision, empty input, not a workbook, file-level parse errors (stage note, apply refused)', async () => {
    expect(await stagePidImportAction(HLT, req(CSV, { rev: ' ' }))).toEqual({ error: 'The revision is required' });
    expect(await stagePidImportAction(HLT, req(CSV, { rev: 'rev E' }))).toEqual({ error: 'Invalid revision (1 to 6 letters or digits, e.g. E)' });
    expect(await stagePidImportAction(HLT, req('  '))).toEqual({ error: 'Choose a file or paste the tag list' });
    expect(await stagePidImportAction(HLT, req(CSV, { kind: 'xlsx', data: Buffer.from(CSV).toString('base64') }))).toEqual({ error: 'The file is not an Excel workbook (.xlsx)' });
    expect(await stagePidImportAction(HLT, { ...req(CSV), mode: 'all' })).toEqual({ error: 'Invalid request' });
    expect(await stagePidImportAction(HLT, null)).toEqual({ error: 'Invalid request' });
    const st = (await stagePidImportAction(HLT, req('Name,Description\nx,y'))).stage!;
    expect([st.canImport, st.note, st.lines]).toEqual([false, 'No "Tag" column in the first rows of the file', []]);
    expect(await applyPidImportAction(HLT, req('Name,Description\nx,y'))).toEqual({ error: 'No "Tag" column in the first rows of the file' });
    expect(await applyPidImportAction(HLT, req('Tag,Description\nNEW-1,'))).toEqual({ error: 'No valid tag in the file' });
    session.lang = 'fr';
    expect(await stagePidImportAction(HLT, req(CSV, { rev: '' }))).toEqual({ error: 'La révision est obligatoire' });
    expect(await applyPidImportAction(HLT, req('Name,Description\nx,y'))).toEqual({ error: 'Aucune colonne « Tag » dans les premières lignes du fichier' });
  });
});
