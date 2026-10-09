// Golden values of the ITP · punch list and Commissioning rules: the prototype's own render values (design lines
// 3096–5239 run in node:vm, renderVals() in EN — scripts/proto-golden-itpcom.ts → itpcom.golden.json) for the seed of
// every project and for the transitions the screens offer (punch Start / Close, Add punch item of category A, Add
// inspection). The facts fed to the rules are the golden rows with their labels turned back into codes. Deliberate
// deviations are asserted explicitly: English singular forms ("1 system", "1 item missing").
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import {
  commissioningCellStatus, handoverItemStatus, itpPointType, itpResult, punchStatus,
  type CommissioningCellStatus, type PunchCategory,
} from '@/server/db/codes';
import GOLDEN from './itpcom.golden.json';
import {
  blockedText, blockingAOf, commissioningCellLook, defaultSatDate, dossierPct, failedText, groupBySystem, inspectionLook, itpBadge, itpDateText,
  missingText, openByCategoryText, parseForwardDate, parseNewInspection, parseNewPunch, parsePlanSat, planShapeText, punchLook, punchStep,
  summariseCommissioning, summariseItp, type PunchFacts,
} from './itpcom';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const P = PROTO as any;
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const EMP: string[] = P.ITP_TEMPLATES.EMP;

const inspectionFacts = (rows: any[]) => rows.map((r) => ({ number: r.id, system: r.sys, pointType: itpPointType.code(r.type), result: itpResult.code(r.status) }));
const punchFacts = (rows: any[]): PunchFacts[] => rows.map((r) => ({ category: r.cat as PunchCategory, status: punchStatus.code(r.status), location: r.loc }));
const kv = (ks: any[]) => ks.map((k) => [String(k.value), k.sub, k.color]);

/** The ITP KPI tiles the rules produce for golden rows (English, as itpKpis). */
function itpKpis(rows: any[], punch: any[], code: string, custom: number | null) {
  const facts = inspectionFacts(rows);
  const mt = (P.PROJ_ID[code] ?? {}).mt ?? null;
  const s = summariseItp(facts, punchFacts(punch), custom == null ? null : { template: 'EMP', systems: EMP.length, custom }, mt);
  return [
    [`${s.passed} / ${s.total}`, failedText(s.failed), s.passedColor],
    [String(s.holdAhead), 'client presence required', 'var(--color-text)'],
    [String(s.open), openByCategoryText(s.openA, s.openB, s.openC), s.openColor],
    [s.template, s.plan ? planShapeText(s.plan.systems, s.plan.custom) : 'standard template for this machine type', 'var(--color-neutral-200)'],
  ];
}

const rowsOf = (snap: any) => snap.groups.flatMap((g: any) => g.rows);

describe('inspection & test plan (itpBySys, itpRows, itpKpis)', () => {
  it.each(PROJECTS)('%s: groups in template order and the KPI tiles', (code) => {
    const plan = G.itp.en[code].plan;
    const punch = G.itp.en[code].punch.punch;
    const rows = rowsOf(plan);
    expect(groupBySystem(EMP, inspectionFacts(rows)).map((g) => ({ sys: g.system, passed: g.passed, count: g.count, ids: g.rows.map((r) => r.number) }))).toEqual(
      plan.groups.map((g: any) => ({ sys: g.sys, passed: g.passed, count: g.count, ids: g.rows.map((r: any) => r.id) })),
    );
    expect(itpKpis(rows, punch, code, code === 'HLT-026' ? 2 : null)).toEqual(kv(plan.kpis));
    expect(plan.noItp).toBe(!rows.length);
    expect(itpBadge(punchFacts(punch))).toBe(plan.badge);
  });

  it('point type and result tags, result colour (every seed line)', () => {
    for (const r of rowsOf(G.itp.en['HLT-026'].plan)) {
      const look = inspectionLook(itpPointType.code(r.type), itpResult.code(r.status));
      expect([r.id, look.typeClass, look.statusClass, look.statusColor]).toEqual([r.id, r.typeClass, r.stClass, r.stColor]);
    }
  });

  it('a line whose system left the template keeps its own group after the template ones', () => {
    const rows = [
      { number: 'I-01', system: 'Structure', pointType: 'hold' as const, result: 'passed' as const },
      { number: 'I-20', system: 'Legacy crane', pointType: 'review' as const, result: 'planned' as const },
    ];
    expect(groupBySystem(['Structure', 'Hoist'], rows).map((g) => [g.system, g.count, g.passed])).toEqual([['Structure', 1, 1], ['Legacy crane', 1, 0]]);
  });

  it('Add inspection: the new Planned line joins its system group; one more custom line', () => {
    const s = G.scenarios.addInspection;
    const seed = rowsOf(G.itp.en['HLT-026'].plan);
    const added = s.group.rows.find((r: any) => r.id === 'I-20');
    const rows = [...seed, added];
    expect(itpKpis(rows, G.itp.en['HLT-026'].punch.punch, 'HLT-026', 3)).toEqual(kv(s.kpis));
    const g = groupBySystem(EMP, inspectionFacts(rows)).find((x) => x.system === 'Hoist mechanisms')!;
    expect([g.count, g.passed, g.rows.map((r) => r.number)]).toEqual([s.group.count, s.group.passed, s.group.rows.map((r: any) => r.id)]);
  });
});

describe('punch list (punchRows, punchOpen, itpBadge)', () => {
  const all = () => [
    ...G.itp.en['HLT-026'].punch.punch,
    ...G.scenarios.advance.afterStartAndClose.punch,
    ...G.scenarios.advance.afterClose.punch,
    G.scenarios.addPunchA.row,
  ];

  it('category and status tags, item colour, the Start / Close step', () => {
    for (const r of all()) {
      const st = punchStatus.code(r.status);
      const look = punchLook(r.cat, st);
      const step = punchStep(st);
      expect([r.id, look.categoryClass, look.statusClass, look.color, !!step]).toEqual([r.id, r.catClass, r.stClass, r.color, r.canAdvance]);
      if (step) expect(step.label).toBe(r.next);
    }
    expect(punchStep('open')).toEqual({ label: 'Start', to: 'in_progress' });
    expect(punchStep('in_progress')).toEqual({ label: 'Close', to: 'closed' });
    expect(punchStep('closed')).toBeNull();
  });

  it('Start / Close transitions: open counts and KPI colours', () => {
    for (const k of ['afterStartAndClose', 'afterClose'] as const) {
      const sc = G.scenarios.advance[k];
      expect(itpKpis(rowsOf(G.itp.en['HLT-026'].plan), sc.punch, 'HLT-026', 2)).toEqual(kv(sc.kpis));
    }
  });

  it('a category-A item: badge "1" (still while in progress), Open punch items in LO', () => {
    const sc = G.scenarios.addPunchA;
    const punch = [...G.itp.en['HLT-026'].punch.punch, sc.row];
    expect(itpBadge(punchFacts(punch))).toBe(sc.badge);
    expect(itpKpis(rowsOf(G.itp.en['HLT-026'].plan), punch, 'HLT-026', 2)).toEqual(kv(sc.kpis));
    expect(itpBadge(punchFacts([...G.itp.en['HLT-026'].punch.punch, { ...sc.row, status: 'In progress' }]))).toBe(sc.afterStartBadge);
    expect(itpBadge([{ category: 'A', status: 'closed', location: '' }, { category: null, status: 'open', location: '' }])).toBe('');
  });
});

describe('commissioning (cmStatus, cmRows, cmDossier, cmKpis)', () => {
  const cm = G.commissioning.en['HLT-026'];
  const ICON: Record<string, string> = { 'ph ph-check': 'Check', 'ph ph-lock-simple': 'LockSimple', 'ph ph-circle-half': 'CircleHalf', 'ph ph-circle-dashed': 'CircleDashed' };
  const cellFacts = (c: any) => {
    const status = commissioningCellStatus.code(c.st) as CommissioningCellStatus;
    return { status, dateOn: status === 'blocked' || !c.date ? null : parseForwardDate(c.date) };
  };

  it('status cell look (every seed cell)', () => {
    for (const r of cm.rows)
      for (const c of r.cells) {
        const look = commissioningCellLook(commissioningCellStatus.code(c.st) as CommissioningCellStatus);
        expect({ bg: look.bg, border: look.border, color: look.color, icon: look.icon }).toEqual({ bg: c.bg, border: c.border, color: c.color, icon: ICON[c.icon] });
      }
  });

  it('KPI tiles, "Blocking A" per system, dossier completeness', () => {
    const systems = cm.rows.map((r: any) => ({ cells: r.cells.map(cellFacts) }));
    const dossier = cm.dossier.map((d: any) => ({ status: handoverItemStatus.code(d.status) }));
    const punch = punchFacts(G.itp.en['HLT-026'].punch.punch);
    const s = summariseCommissioning(systems, dossier, punch);
    expect([
      [`${s.handedOver} / ${s.systems}`, `SAT planned ${itpDateText(s.satOn)} · handover ${itpDateText(s.handoverOn)}`, 'var(--color-text)'],
      [`${s.done} / ${s.cells}`, blockedText(s.blocked), s.stepsColor],
      [String(s.openA), 'must be closed before SAT', s.punchColor],
      [`${s.dossierPct} %`, missingText(s.missing), s.dossierColor],
    ]).toEqual(kv(cm.kpis));
    expect(s.handoverOn).toBe('2027-01-14');
    expect(cm.rows.map((r: any) => blockingAOf(r.sys, punch))).toEqual(cm.rows.map((r: any) => r.punchA));
    expect(dossierPct([])).toBe(0);
  });

  it('a category-A item on the structure: Blocking A 1 on Structure, KPI in LO', () => {
    const sc = G.scenarios.addPunchA;
    const punch = punchFacts([...G.itp.en['HLT-026'].punch.punch, sc.row]);
    expect(cm.rows.map((r: any) => blockingAOf(r.sys, punch))).toEqual(sc.cmPunchA);
    const s = summariseCommissioning(cm.rows.map((r: any) => ({ cells: r.cells.map(cellFacts) })), cm.dossier.map((d: any) => ({ status: handoverItemStatus.code(d.status) })), punch);
    expect([String(s.openA), s.punchColor]).toEqual([String(sc.cmKpis[2].value), sc.cmKpis[2].color]);
  });

  it('projects without a commissioning plan render nothing (noComm)', () => {
    for (const code of PROJECTS.slice(1)) expect([G.commissioning.en[code].hasComm, G.commissioning.en[code].noComm, G.commissioning.en[code].kpis]).toEqual([false, true, []]);
    const s = summariseCommissioning([], [], []);
    expect([s.systems, s.satOn, s.handoverOn, s.dossierPct]).toEqual([0, null, null, 0]);
  });
});

describe('KPI sentences', () => {
  it('English plural forms of the prototype; singular for 1 (deviation)', () => {
    expect([failedText(1), failedText(0), openByCategoryText(0, 2, 2), planShapeText(6, 2), blockedText(2), missingText(4)]).toEqual([
      '1 failed · NCR raised', '0 failed · NCR raised', 'A 0 · B 2 · C 2', '6 systems · 2 custom lines', '2 blocked by interfaces', '4 items missing',
    ]);
    expect([planShapeText(1, 1), missingText(1)]).toEqual(['1 system · 1 custom line', '1 item missing']);
  });
});

describe('dates', () => {
  it('year-less within six months of the status date, with the year otherwise', () => {
    expect(['2026-09-09', '2026-12-10', '2027-01-14', '2027-06-01', '2026-01-12', null].map(itpDateText)).toEqual(['9 Sep', '10 Dec', '14 Jan', '1 Jun ’27', '12 Jan ’26', '']);
  });

  it('typed dates: a year-less date more than six months back is next year’s', () => {
    expect(['14 Jan', '15 Oct', '12 Mar', '15 Oct 2026', '14 Jan 2026', '14 Jan ’26', '15/10', '15/10/2027', '2027-02-01', '10 déc. 2026', '6 Nov', 'nope', ''].map((s) => parseForwardDate(s))).toEqual([
      '2027-01-14', '2026-10-15', '2027-03-12', '2026-10-15', '2026-01-14', '2026-01-14', '2026-10-15', '2027-10-15', '2027-02-01', '2026-12-10', '2026-11-06', null, null,
    ]);
  });

  it('Plan SAT default date: the first system’s SAT date ("10 Dec 2026", as the prototype form)', () => {
    expect(defaultSatDate('2026-12-10')).toBe(G.forms.en.commissioning.fields[1].value);
    expect(defaultSatDate(null)).toBe('');
  });
});

describe('action forms', () => {
  const TEAM: string[] = G.forms.en.punch.fields.find((f: any) => f.id === 'owner').options;

  it('Add inspection: prototype values (labels) and codes; defaults; errors', () => {
    expect(parseNewInspection({ name: ' Rope end terminations ', system: 'Hoist mechanisms', type: 'Witness', stage: 'Site', ref: 'EN 12385', date: '6 Nov' }, EMP)).toEqual({
      ok: true, value: { name: 'Rope end terminations', system: 'Hoist mechanisms', pointType: 'witness', stage: 'site', reference: 'EN 12385', plannedOn: '2026-11-06' },
    });
    expect(parseNewInspection({ name: 'Bolt torque check' }, EMP)).toEqual({ ok: true, value: { name: 'Bolt torque check', system: 'Structure', pointType: 'hold', stage: 'workshop', reference: null, plannedOn: null } });
    expect(parseNewInspection({ name: 'x', type: 'review', stage: 'fat' }, ['General'])).toMatchObject({ ok: true, value: { system: 'General', pointType: 'review', stage: 'fat' } });
    expect(parseNewInspection({ name: ' ' }, EMP)).toEqual({ ok: false, error: 'Inspection / test is required' });
    expect(parseNewInspection({ name: 'x', system: 'Track' }, EMP)).toEqual({ ok: false, error: 'Unknown system' });
    expect(parseNewInspection({ name: 'x', type: 'Visual' }, EMP)).toEqual({ ok: false, error: 'Unknown inspection type' });
    expect(parseNewInspection({ name: 'x', stage: 'Factory' }, EMP)).toEqual({ ok: false, error: 'Unknown stage' });
    expect(parseNewInspection({ name: 'x', date: 'next week' }, EMP)).toEqual({ ok: false, error: 'Enter the planned date as a date, e.g. 15 Oct' });
    expect(parseNewInspection({ name: 'x'.repeat(201) }, EMP)).toEqual({ ok: false, error: 'Text is too long' });
  });

  it('Add punch item: category from the letter or its label, source, owner from TEAM; errors', () => {
    expect(parseNewPunch({ item: 'Missing bolt — post 3', loc: 'Structure · Bay 2', cat: 'A — blocking', src: 'SAT', due: '9 Oct' }, TEAM)).toEqual({
      ok: true, value: { description: 'Missing bolt — post 3', location: 'Structure · Bay 2', category: 'A', source: 'sat', owner: TEAM[0], dueOn: '2026-10-09' },
    });
    expect(parseNewPunch({ item: 'x', cat: 'C', src: 'client_inspection', owner: 'Julien Wagner' }, TEAM)).toMatchObject({ ok: true, value: { category: 'C', source: 'client_inspection', owner: 'Julien Wagner', location: null, dueOn: null } });
    expect(parseNewPunch({ item: '' }, TEAM)).toEqual({ ok: false, error: 'Item is required' });
    expect(parseNewPunch({ item: 'x', cat: 'D' }, TEAM)).toEqual({ ok: false, error: 'Unknown category' });
    expect(parseNewPunch({ item: 'x', src: 'Audit' }, TEAM)).toEqual({ ok: false, error: 'Unknown source' });
    expect(parseNewPunch({ item: 'x', owner: 'Someone Else' }, TEAM)).toEqual({ ok: false, error: 'Unknown owner' });
    expect(parseNewPunch({ item: 'x', due: 'soon' }, TEAM)).toEqual({ ok: false, error: 'Enter the due date as a date, e.g. 15 Oct' });
  });

  it('Plan SAT: the prototype defaults (EN and FR date); a date on or after the status date; errors', () => {
    const v = Object.fromEntries(G.forms.en.commissioning.fields.map((f: any) => [f.id, f.value]));
    expect(parsePlanSat(v, EMP)).toEqual({
      ok: true, value: { system: 'Structure', date: '2026-12-10', clientWitnesses: 'N. Bensaïd, K. Doucouré', prerequisites: 'Punch A items closed · pre-commissioning reports issued' },
    });
    const fr = Object.fromEntries(G.forms.fr.commissioning.fields.map((f: any) => [f.id, f.value]));
    expect(parsePlanSat({ ...fr, system: 'Anti-collision' }, EMP)).toMatchObject({ ok: true, value: { system: 'Anti-collision', date: '2026-12-10' } });
    expect(parsePlanSat({ date: '' }, EMP)).toEqual({ ok: false, error: 'Date is required' });
    expect(parsePlanSat({ date: 'mid December' }, EMP)).toEqual({ ok: false, error: 'Enter the SAT date as a date, e.g. 10 Dec 2026' });
    expect(parsePlanSat({ date: '20 Sep 2026' }, EMP)).toEqual({ ok: false, error: 'The SAT date cannot be before the status date' });
    expect(parsePlanSat({ date: '25 Sep 2026' }, EMP)).toMatchObject({ ok: true, value: { date: '2026-09-25' } });
    expect(parsePlanSat({ system: 'Track', date: '10 Dec' }, EMP)).toEqual({ ok: false, error: 'Unknown system' });
  });
});
