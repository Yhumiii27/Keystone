// R-160 (P2, D9-32): CE conformity Server Functions and data layer against an in-memory database — who edits what (engineering
// lead and quality: the whole file; the project's PM: the declaration and the marking; the director and the others: read; a
// client never), the audit row with the changed fields before / after, R-010 (a file changed meanwhile by someone else is
// refused), the readiness computed against the Settings checklists, the portfolio list, the handover warning (never a block)
// and the Settings checklists (the portfolio director only). Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Antoine Girard', role: 'englead', lead: false, canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: viewer.canEdit, outside: !viewer.canEdit }),
}));

import { and, desc, eq } from 'drizzle-orm';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries } from '@/server/db/schema';
import { getProjectCe, listCeChecklists, listPortfolioCeGaps } from '@/server/dal/ce-conformity';
import { addCeChecklistItemAction, resetCeChecklistsAction, saveCeFileAction, setCeChecklistItemActiveAction } from './actions';
import { ceHandoverWarning } from './warnings';

const line = async (ref: string, code = 'HLT-026') => (await getProjectCe(code))!.lines.find((l) => l.ref === ref)!;
const as = (name: string, role: string, lead = false, canEdit = true) => Object.assign(viewer, { name, role, lead, canEdit });
const lastAudit = async () => {
  const db = await getDb();
  const [a] = await db.select().from(auditEntries).where(and(eq(auditEntries.entityType, 'ce_file'))).orderBy(desc(auditEntries.occurredAt)).limit(1);
  return a;
};

const ALL_EHSR = async () => Object.fromEntries((await listCeChecklists()).ehsr.map((e) => [e.code, 'na']));
const ALL_TECH = async () => Object.fromEntries((await listCeChecklists()).techfile.map((e) => [e.code, { status: 'done', deliverable: 'D-011', codexRef: null }]));

describe('CE conformity', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('Antoine Girard', 'englead');
    viewer.lang = 'en';
  });

  it('seeds: the default checklists on every database, the demonstration file of HLT-026 EQ-01 in progress, EQ-02 not started', async () => {
    const lists = await listCeChecklists();
    expect(lists.ehsr.map((e) => e.code).slice(0, 3)).toEqual(['1.1', '1.2', '1.3']);
    expect([lists.ehsr.length, lists.techfile.length]).toEqual([20, 11]);
    const ce = (await getProjectCe('HLT-026'))!;
    expect(ce.lines.map((l) => [l.ref, l.readiness.state])).toEqual([['EQ-01', 'in_progress'], ['EQ-02', 'none']]);
    expect(ce.lines[0].readiness.missing).toEqual([
      'Risk assessment referenced', 'Essential requirements assessed and met', 'Technical file complete', 'Instructions referenced', 'EU declaration of conformity signed', 'CE marking dated',
    ]);
    expect(ce.dossierLine).toEqual({ item: 'CE declaration & certificates of conformity', status: 'partial', documentRef: 'COC-HLT-012' });
    expect(ce.deliverables[0].type).toBe('certificates');
  });

  it('who edits: the director and procurement read, a viewer outside the workspace or a client is refused', async () => {
    as('Marie Lefebvre', 'director', true);
    expect(await saveCeFileAction('HLT-026', 'EQ-02', { regime: 'machinery' }, null)).toEqual({ error: 'This CE file is read-only for you' });
    as('Fabien Bertrand', 'procurement', false, false);
    viewer.lang = 'fr';
    expect(await saveCeFileAction('HLT-026', 'EQ-02', { regime: 'machinery' }, null)).toEqual({ error: 'Ce dossier CE est en lecture seule pour vous' });
    as('Nadia Bensaïd', 'client');
    expect(await saveCeFileAction('HLT-026', 'EQ-02', { regime: 'machinery' }, null)).toEqual({ error: 'Ce dossier CE est en lecture seule pour vous' });
    as('Antoine Girard', 'englead');
    expect(await saveCeFileAction('HLT-026', 'EQ-9', {}, null)).toEqual({ error: 'Requête invalide' });
    expect(await saveCeFileAction('HLT-026', 'EQ-07', {}, null)).toEqual({ error: 'Ligne d’équipement inconnue' });
    expect(await saveCeFileAction('HLT-026', 'EQ-02', { regime: 'partly_completed', ceMarkingOn: '2027-03-01' }, null)).toEqual({ error: 'Une quasi-machine ne porte pas de marquage CE' });
    expect((await line('EQ-02')).file).toBeNull();
  });

  it('the engineering lead fills the whole file: complete, audited with the changed fields', async () => {
    const values = {
      regime: 'machinery', category: 'annex_i_b', route: 'module_h', riskAssessmentRef: 'RPT-HLT-050', standards: ['EN ISO 12100:2010'], instructionsRef: 'MAN-HLT-020',
      declarationSignatory: 'Romain Aubert', declarationOn: '2027-03-01', declarationRef: 'COC-HLT-013', ceMarkingOn: '2027-03-02',
      ehsr: await ALL_EHSR(), techFile: await ALL_TECH(),
    };
    expect(await saveCeFileAction('HLT-026', 'EQ-02', values, null)).toEqual({ ok: true, toast: 'CE file saved · complete · 9/9' });
    const l = await line('EQ-02');
    expect([l.readiness.complete, l.file!.route, l.file!.standards]).toEqual([true, 'module_h', ['EN ISO 12100:2010']]);
    const a = await lastAudit();
    expect([a.area, a.change, a.actorName]).toEqual(['CE conformity', 'CE file of EQ-02 updated · readiness 9/9', 'Antoine Girard']);
    expect(a.before).toMatchObject({ regime: null, route: null });
    expect(a.after).toMatchObject({ regime: 'machinery', route: 'module_h' });
    // Same values again: nothing written.
    expect(await saveCeFileAction('HLT-026', 'EQ-02', values, l.token)).toEqual({ ok: true, toast: 'No change to save' });
  });

  it('a PM of the project changes the declaration and the marking only; a stale form is refused', async () => {
    const before = await line('EQ-02');
    as('Romain Aubert', 'pm', true);
    const r = await saveCeFileAction('HLT-026', 'EQ-02', { ...before.file, regime: 'partly_completed', route: '', ceMarkingOn: '', declarationSignatory: 'Marie Lefebvre' }, before.token);
    expect(r).toMatchObject({ ok: true });
    const after = await line('EQ-02');
    expect([after.file!.regime, after.file!.route, after.file!.declarationSignatory, after.file!.ceMarkingOn]).toEqual(['machinery', 'module_h', 'Marie Lefebvre', null]);
    expect(after.readiness.missing).toEqual(['CE marking dated']);
    // The engineering lead's form, read before the PM's save: refused (R-010), nothing written.
    as('Antoine Girard', 'englead');
    const stale = await saveCeFileAction('HLT-026', 'EQ-02', { ...before.file, standards: ['EN 60204-1'] }, before.token);
    expect(stale).toMatchObject({ conflict: true });
    expect((await line('EQ-02')).file!.standards).toEqual(['EN ISO 12100:2010']);
    // A PM who does not lead the project reads.
    as('Romain Aubert', 'pm', false);
    expect(await saveCeFileAction('HLT-026', 'EQ-02', { ...after.file }, after.token)).toEqual({ error: 'This CE file is read-only for you' });
  });

  it('portfolio: incomplete files of open projects under the Regulation; the handover warning, never a block', async () => {
    const gaps = await listPortfolioCeGaps();
    // Harbor Line hands over on 14 Jan 2027, before the date of application (Directive 2006/42/EC): not listed.
    expect((await line('EQ-01')).marketDate).toBe('2027-01-14');
    expect(gaps.map((g) => [g.projectCode, g.line.ref, g.line.marketDate])).toEqual([
      ['ERP-202', 'EQ-01', '2027-02-28'], ['NDC-031', 'EQ-01', '2027-03-31'], ['WSA-044', 'EQ-01', '2027-06-30'],
    ]);
    expect(gaps.every((g) => g.line.regulationApplies && !g.line.readiness.complete)).toBe(true);
    const t = makeT('en');
    expect(await ceHandoverWarning('HLT-026', { equipment: 'EQ-02' }, t)).toBe(' · CE file incomplete · EQ-02 · the handover is not blocked');
    expect(await ceHandoverWarning('HLT-026', { equipment: null }, t)).toBe(' · CE file incomplete · EQ-01 · the handover is not blocked');
    // The warning holds before the date of application too (the Directive also requires the file).
    expect(await ceHandoverWarning('HLT-026', { system: 'Hoist mechanisms' }, t)).toBe(' · CE file incomplete · EQ-01 · the handover is not blocked');
    expect(await ceHandoverWarning('NOPE-000', { equipment: null }, t)).toBe('');
  });

  it('Settings checklists: the portfolio director adds, removes, restores and resets; the others read', async () => {
    as('Antoine Girard', 'englead');
    expect(await addCeChecklistItemAction('ehsr', '1.1.9', 'Protection against corruption')).toEqual({ error: 'Settings are edited by the portfolio director' });
    as('Marie Lefebvre', 'director');
    expect(await addCeChecklistItemAction('ehsr', '1.1.9', 'Protection against corruption')).toEqual({ ok: true, toast: 'Entry added' });
    expect(await addCeChecklistItemAction('ehsr', '1.1.9', 'Again')).toEqual({ error: 'This entry is already in the list' });
    expect(await addCeChecklistItemAction('ehsr', 'x', 'Bad')).toEqual({ error: 'A number reads "1.1.9"' });
    // A new requirement makes the complete file incomplete until it is assessed.
    expect((await line('EQ-02')).readiness.missing).toContain('Essential requirements assessed and met');
    expect(await setCeChecklistItemActiveAction('ehsr', '1.1.9', false)).toEqual({ ok: true, toast: 'Entry removed' });
    expect((await listCeChecklists()).ehsr.find((e) => e.code === '1.1.9')).toMatchObject({ active: false, isDefault: false });
    expect(await setCeChecklistItemActiveAction('ehsr', '1.3', false)).toMatchObject({ ok: true });
    expect(await resetCeChecklistsAction()).toEqual({ ok: true, toast: 'CE checklists reset to defaults' });
    const lists = await listCeChecklists();
    expect(lists.ehsr.filter((e) => e.active).length).toBe(20);
    expect(lists.ehsr.find((e) => e.code === '1.3')!.active).toBe(true);
  });
});
