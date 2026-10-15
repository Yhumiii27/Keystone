// R-112 (Q-6a, Q-6b, V-3): inspection results recorded in Keystone and the NCR reported in Vigie on a failure. Pure rules
// (parsing, roles, witness, passed counts), the "Record result" Server Function against the seeded in-memory database
// with the real project context (8 personas, read-only and outside-workspace rules, stale lines, hold-point witness),
// the audit trail, the plan's view model (result line, Vigie report link prefilled with the inspection, NCR number once
// Vigie reports it, nothing Vigie-related for the client) and the static render.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
  };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { canRecordItpResult, groupBySystem, inspectionNcrTitle, parseInspectionResult, parsePastDate, resultLineText, summariseItp, witnessFieldOf } from '@/domain/itpcom';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { setDb, getDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { vigieNcrs } from '@/server/db/schema';
import { getItpInspection, getItpPlan, listPunchItems, projectMachineTypeLabel, recordItpResult } from '@/server/dal/itp';
import { listAudit } from '@/server/dal/notifications';
import { upsertNcrMirror } from '@/server/integrations/vigie/quality-mirror';
import { and, eq } from 'drizzle-orm';
import { recordInspectionResultAction } from './actions';
import { ItpBody } from './itp-view';
import { itpScreenView } from './model';

const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const FAIL = { result: 'failed', date: '29 Sep', inspector: 'Gabriel Comte', comment: 'DFT 180 µm < 240 µm on G2 web' };

describe('R-112 rules', () => {
  it('who records (Q-6a: quality, engineering lead; the director keeps every right)', () => {
    expect(ROLES.filter(canRecordItpResult)).toEqual(['director', 'englead', 'quality']);
  });

  it('client representative: required on a hold point, offered on a witness point, absent otherwise', () => {
    expect((['hold', 'witness', 'review', 'surveillance'] as const).map(witnessFieldOf)).toEqual(['required', 'optional', null, null]);
  });

  it('past dates: year-less dates after today are last year’s; the business date is "today"', () => {
    expect(['24 Sep', '29/09', '2026-09-30', '28 Dec', '24 sept. 2026', 'demain', ''].map((d) => parsePastDate(d))).toEqual([
      '2026-09-24', '2026-09-29', '2026-09-30', '2025-12-28', '2026-09-24', null, null,
    ]);
  });

  it('parses the form: result, date, inspector, witness, comment', () => {
    expect(parseInspectionResult({ result: 'passed', date: '24 Sep', inspector: ' Antoine Girard ' }, 'review')).toEqual({
      ok: true, value: { result: 'passed', resultOn: '2026-09-24', inspector: 'Antoine Girard', clientWitness: null, comment: null },
    });
    // Labels are accepted (prototype payloads); a witness typed on a review point is ignored.
    expect(parseInspectionResult({ result: 'Passed with reservations', date: '30 Sep', inspector: 'G. Comte', witness: 'N. Bensaïd', comment: 'Touch-up G3' }, 'review')).toEqual({
      ok: true, value: { result: 'reserved', resultOn: '2026-09-30', inspector: 'G. Comte', clientWitness: null, comment: 'Touch-up G3' },
    });
    const err = (v: Record<string, string>, pt: 'hold' | 'witness' | 'review' = 'review') => {
      const r = parseInspectionResult(v, pt);
      return r.ok ? null : r.error;
    };
    expect([
      err({ result: 'planned', date: '24 Sep', inspector: 'x' }),
      err({ result: 'passed', date: '', inspector: 'x' }),
      err({ result: 'passed', date: 'soon', inspector: 'x' }),
      err({ result: 'passed', date: '2026-10-02', inspector: 'x' }),
      err({ result: 'passed', date: '24 Sep', inspector: ' ' }),
      err({ result: 'passed', date: '24 Sep', inspector: 'x' }, 'hold'),
      err({ result: 'failed', date: '24 Sep', inspector: 'x' }),
      err({ result: 'reserved', date: '24 Sep', inspector: 'x' }),
      err({ result: 'passed', date: '24 Sep', inspector: 'x'.repeat(201) }),
    ]).toEqual([
      'Choose the result', 'Date is required', 'Enter the inspection date as a date, e.g. 24 Sep', 'The inspection date cannot be in the future', 'Inspector is required',
      'Name the client representative present at this hold point', 'Describe the non-conformity', 'List the reservations', 'Text is too long',
    ]);
    expect(err({ result: 'passed', date: '24 Sep', inspector: 'x' }, 'witness')).toBeNull();
    expect(err({ result: 'passed', date: '24 Sep', inspector: 'x', witness: 'N. Bensaïd' }, 'hold')).toBeNull();
  });

  it('a pass with reservations counts as passed (KPI, hold points ahead, system groups)', () => {
    const rows = [
      { number: 'I-01', system: 'S', pointType: 'hold' as const, result: 'reserved' as const },
      { number: 'I-02', system: 'S', pointType: 'hold' as const, result: 'planned' as const },
      { number: 'I-03', system: 'S', pointType: 'review' as const, result: 'failed' as const },
    ];
    const s = summariseItp(rows, [], null, null);
    expect([s.passed, s.failed, s.holdAhead]).toEqual([1, 1, 1]);
    expect(groupBySystem(['S'], rows)[0].passed).toBe(1);
  });

  it('texts: the result line and the NCR title passed to Vigie', () => {
    expect(resultLineText({ result: 'failed', resultOn: '2026-09-29', inspector: 'Gabriel Comte', clientWitness: 'N. Bensaïd' })).toBe('Failed 29 Sep · Gabriel Comte · client N. Bensaïd');
    expect(resultLineText({ result: 'passed', resultOn: null, inspector: null, clientWitness: null })).toBeNull();
    expect(inspectionNcrTitle({ number: 'I-03', system: 'Structure', name: 'Paint thickness (DFT)' })).toBe('ITP I-03 · Structure · Paint thickness (DFT)');
  });
});

describe('R-112 "Record result" Server Function and DAL', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'director';
    session.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('rights for the 8 personas: quality, engineering lead and director record; the others are refused, nothing written', async () => {
    const outcome: Record<string, string> = {};
    for (const role of ROLES) {
      session.role = role;
      const r = await recordInspectionResultAction('HLT-026', 'I-02', 'passed', { result: 'passed', date: '12 Sep', inspector: 'Antoine Girard' });
      const res = r as { toast?: string; error?: string };
      outcome[role] = res.toast ? 'ok' : (res.error ?? '');
    }
    expect(outcome).toEqual({
      director: 'ok',
      pm: 'Only quality and the engineering lead record inspection results',
      depthead: 'This inspection plan is read-only for you',
      member: 'This inspection plan is read-only for you',
      englead: 'ok',
      quality: 'ok',
      procurement: 'This inspection plan is read-only for you',
      client: 'Only quality and the engineering lead record inspection results',
    });
    // The writer re-checks the role whatever the caller.
    await expect(recordItpResult('HLT-026', 'I-02', { result: 'passed', resultOn: '2026-09-12', inspector: 'x' }, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(/Only quality/);
    await expect(recordItpResult('HLT-026', 'I-02', { result: 'passed', resultOn: '2026-09-12', inspector: 'x' }, { name: 'Fabien Bertrand', role: 'procurement' })).rejects.toThrow(/outside your workspace/);
  });

  it('malformed requests, unknown lines, stale lines and the hold-point witness', async () => {
    session.role = 'quality';
    expect(await recordInspectionResultAction('HLT-026', 'X-1', 'planned', FAIL)).toEqual({ error: 'Invalid request' });
    expect(await recordInspectionResultAction('HLT-026', 'I-03', 'nope', FAIL)).toEqual({ error: 'Invalid request' });
    expect(await recordInspectionResultAction('HLT-026', 'I-99', 'planned', FAIL)).toEqual({ error: 'Unknown inspection' });
    expect(await recordInspectionResultAction('NOPE-1', 'I-03', 'failed', FAIL)).toEqual({ error: 'Unknown project' });
    // The viewer saw "Planned" but the line is "Scheduled": refused and the page refreshed.
    expect(await recordInspectionResultAction('HLT-026', 'I-04', 'planned', { result: 'passed', date: '29 Sep', inspector: 'x', witness: 'N. Bensaïd' })).toEqual({
      error: 'This inspection has changed since you opened it',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    // I-04 is a hold point: the client representative is required.
    expect(await recordInspectionResultAction('HLT-026', 'I-04', 'scheduled', { result: 'passed', date: '29 Sep', inspector: 'x' })).toEqual({
      error: 'Name the client representative present at this hold point',
    });
    await expect(recordItpResult('HLT-026', 'I-04', { result: 'passed', resultOn: '2026-09-29', inspector: 'x' }, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/hold point/);
    session.lang = 'fr';
    expect(await recordInspectionResultAction('HLT-026', 'I-03', 'failed', { result: 'failed', date: '29 Sep', inspector: 'x' })).toEqual({ error: 'Décrivez la non-conformité' });
    expect((await getItpInspection('HLT-026', 'I-04'))!.result).toBe('scheduled');
  });

  it('records a failure: result, date, inspector (person), comment, audit and activity; then a re-inspection passes it', async () => {
    session.role = 'quality';
    expect(await recordInspectionResultAction('HLT-026', 'I-03', 'failed', FAIL)).toEqual({ toast: 'I-03 · Failed · Inspection result recorded' });
    expect(await getItpInspection('HLT-026', 'I-03')).toMatchObject({
      result: 'failed', resultOn: '2026-09-29', inspector: 'Gabriel Comte', clientWitness: null, resultComment: 'DFT 180 µm < 240 µm on G2 web',
    });
    const [audit] = await listAudit({ projectCode: 'HLT-026', limit: 1 });
    expect([audit.who, audit.object, audit.area, audit.change]).toEqual(['Gabriel Comte', 'I-03', 'ITP', 'result: Failed → Failed · 2026-09-29 · Gabriel Comte · DFT 180 µm < 240 µm on G2 web']);
    // A hold point with the client representative; FR toast.
    session.role = 'englead';
    session.lang = 'fr';
    expect(await recordInspectionResultAction('HLT-026', 'I-04', 'scheduled', { result: 'reserved', date: '30 sept.', inspector: 'Antoine Girard', witness: 'N. Bensaïd', comment: 'Shim at rail joint 12' })).toEqual({
      toast: 'I-04 · Conforme avec réserves · Résultat d’inspection enregistré',
    });
    expect(await getItpInspection('HLT-026', 'I-04')).toMatchObject({ result: 'reserved', resultOn: '2026-09-30', clientWitness: 'N. Bensaïd', inspector: 'Antoine Girard' });
    // Passed with reservations counts as passed: 4 passed before (I-01, I-02, I-08, I-10) + I-04.
    const plan = (await getItpPlan('HLT-026'))!;
    expect(summariseItp(plan.inspections, [], null, null).passed).toBe(plan.inspections.filter((i) => i.result === 'passed' || i.result === 'reserved').length);
  });

  it('view model: result line, "Report the NCR in Vigie" prefilled with the inspection, the Vigie NCR once reported, nothing for the client', async () => {
    const view = async (internal: boolean, canRecord: boolean, lang: 'en' | 'fr' = 'en') => {
      const [plan, punch, machineType] = await Promise.all([getItpPlan('HLT-026'), listPunchItems('HLT-026', 'itp'), projectMachineTypeLabel('HLT-026')]);
      return itpScreenView({ code: 'HLT-026', view: 'plan', plan, punch, machineType, viewer: { canRecord, internal, name: 'Gabriel Comte', today: '30 Sep' } }, makeT(lang), lang);
    };
    const row = (v: Awaited<ReturnType<typeof view>>, n: string) => v.plan!.groups.flatMap((g) => g.rows).find((r) => r.number === n)!;
    const v = await view(true, true);
    const i03 = row(v, 'I-03');
    expect([i03.resultLine, i03.comment, i03.ncrs]).toEqual(['Failed 29 Sep · Gabriel Comte', 'DFT 180 µm < 240 µm on G2 web', []]);
    expect(i03.reportNcr).toEqual({
      href: 'http://localhost:3200/signaler?type=NC&projet=HLT-026&titre=ITP+I-03+%C2%B7+Structure+%C2%B7+Paint+thickness+%28DFT%29&inspection=I-03&source=keystone',
      label: 'Report the NCR in Vigie',
    });
    expect(i03.record).toMatchObject({ label: 'Record result', ariaLabel: 'Record result · I-03', from: 'failed' });
    expect(i03.record!.form.fields.map((f) => [f.id, f.defaultValue ?? ''])).toEqual([
      ['result', 'failed'], ['date', '29 Sep'], ['inspector', 'Gabriel Comte'], ['comment', 'DFT 180 µm < 240 µm on G2 web'],
    ]);
    // Hold point I-06: the witness field is required; a line not recorded proposes the viewer and today.
    expect(row(v, 'I-06').record!.form.fields.map((f) => [f.id, f.required ?? false, f.defaultValue ?? ''])).toEqual([
      ['result', false, 'passed'], ['date', true, '30 Sep'], ['inspector', true, 'Gabriel Comte'], ['witness', true, ''], ['comment', false, ''],
    ]);
    expect(row(v, 'I-02').reportNcr).toBeNull();
    // Readers without the right: no "Record result"; the client sees no Vigie link nor NCR (P-10b).
    expect(row(await view(true, false), 'I-03').record).toBeNull();
    const c = row(await view(false, false), 'I-03');
    // P-10b: the description of the non-conformity is internal; the client sees the result line only.
    expect([c.reportNcr, c.ncrs, c.record, c.resultLine, c.comment]).toEqual([null, [], null, 'Failed 29 Sep · Gabriel Comte', null]);

    // Vigie reports the NCR with the inspection (V-3): its number replaces the report link.
    const db = await getDb();
    const [ncr] = await db.select().from(vigieNcrs).where(and(eq(vigieNcrs.projectCode, 'HLT-026'), eq(vigieNcrs.number, 'NCR-026')));
    await upsertNcrMirror(db, [{
      projectCode: 'HLT-026', number: 'NCR-031', vigieRef: 'EV-2026-140', title: 'Paint thickness below spec on G2', severity: 'major', source: 'workshop', status: 'open',
      activityCode: null, partRef: null, deliverableNumber: null, supplierName: null, inspectionNumber: 'I-03', raisedBy: ncr.raisedByName, raisedOn: '2026-09-29',
      owner: ncr.ownerName, rootCause: '', action: '', dueOn: null, costKeur: 0, isoClause: ncr.isoClause, updatedAt: null,
    }], new Date());
    const after = row(await view(true, true), 'I-03');
    expect(after.ncrs).toEqual([{ number: 'NCR-031', href: 'http://localhost:3200/evenements?etat=tous&sel=EV-2026-140', label: 'Open in Vigie · NCR-031' }]);
    expect(after.reportNcr).toBeNull();
    expect(row(await view(false, false), 'I-03').ncrs).toEqual([]);

    // FR render: the line, the button, the NCR tag.
    const fr = await view(true, true, 'fr');
    const out = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: ItpBody({ code: 'HLT-026', view: fr, canEdit: true, t: makeT('fr') }) }));
    for (const s of ['Non conforme 29 sept. · Gabriel Comte', 'Enregistrer le résultat', 'NCR-031', 'aria-label="Ouvrir dans Vigie · NCR-031"', 'target="_blank"']) expect(out).toContain(s);
  });
});
