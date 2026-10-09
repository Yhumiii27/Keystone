// Shared what-if test fixture (chapter 4, S-7): a small hand-checked network used by the domain and view-model tests.
//   A (in progress, 20 d at 50 % → 10 d left: 25 Sep → 8 Oct) → B (10 d: 9 → 22 Oct) → C (5 d: 23 → 29 Oct), A → D (5 d,
//   total float 10). A: crew 4 × 10 h/d (driving) + Paula 8 h/d (MEP, overloaded); B: Ben 8 h/d (Quality); D owned by Paula.
// Standard 5d · 8h calendar, data date Fri 25 Sep 2026. Not a test file: imported by whatif.test.ts and features/resources tests.
import { builtinCalendars } from './calendar';
import type { WhatIfContext } from './whatif';

export const WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
export const whatIfFixture = (over: Partial<WhatIfContext> = {}): WhatIfContext => ({
  network: {
    dataDate: '2026-09-25', projectCalendar: 'standard_5x8', calendars: builtinCalendars(),
    activities: [
      { id: 'A', duration: 20, percentComplete: 50, actualStart: '2026-09-14' },
      { id: 'B', duration: 10 },
      { id: 'C', duration: 5 },
      { id: 'D', duration: 5 },
    ],
    links: [{ pred: 'A', succ: 'B', type: 'FS', lag: 0 }, { pred: 'B', succ: 'C', type: 'FS', lag: 0 }, { pred: 'A', succ: 'D', type: 'FS', lag: 0 }],
  },
  activities: { A: { name: 'Erection', owner: 'Paula' }, B: { name: 'Inspection', owner: 'Ben' }, C: { name: 'Handover', owner: null }, D: { name: 'Cabling', owner: 'Paula' } },
  assignments: [
    { activity: 'A', resource: 'Crew', person: null, jobTitle: null, department: null, units: 4, hoursPerDay: 10, rateEur: null },
    { activity: 'A', resource: 'Paula', person: 'Paula', jobTitle: 'MEP lead', department: 'MEP', units: 1, hoursPerDay: 8, rateEur: 80 },
    { activity: 'A', resource: 'Crane', person: null, jobTitle: null, department: null, units: 1, hoursPerDay: null, rateEur: null },
    { activity: 'B', resource: 'Ben', person: 'Ben', jobTitle: 'QA / QC', department: 'Quality', units: 1, hoursPerDay: 8, rateEur: 60 },
  ],
  people: [
    { name: 'Paula', jobTitle: 'MEP lead', department: 'MEP', loads: [90, 110, 120, 100, 80, 80, 80, 80] },
    { name: 'Ben', jobTitle: 'QA / QC', department: 'Quality', loads: [80, 80, 80, 80, 80, 80, 80, 80] },
    { name: 'Cleo', jobTitle: 'QA / QC', department: 'Quality', loads: [0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  weeks: WEEKS,
  departments: [{ name: 'MEP', capacityH: 100, demandH: 120 }, { name: 'Quality', capacityH: 300, demandH: 200 }],
  rates: { internal: { 'MEP lead': 80, 'QA / QC': 60 }, external: [{ role: 'Contractor — structural (external)', rateEur: 118 }], overtimeFactor: 1.25 },
  ...over,
});
export const OT_A = 'overtime:A:crew';
export const EX_A = 'extra_resource:A:crew';
export const RELIEF = 'extra_resource:A:paula';
export const OT_B = 'overtime:B:ben';
export const EX_B = 'extra_resource:B:ben';
export const SHIFT = 'shift:D';

