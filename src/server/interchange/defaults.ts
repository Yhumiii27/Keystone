// Chapter-4 defaults of the imports and exports of Activity & integrations (open questions S-9 "MS Project / P6" and D-7
// "Activity and integrations") — the product owner confirms them in the chapter-5 questionnaire; change them here. Pure module
// (the import dialog reads it too). The rights per role are in ./rights.ts, the format mappings in ./mspdi.ts and ./xer.ts.
//
// Rules that are not switches (documented in ./schedule-import.ts): Keystone's WBS has two levels — deeper summary tasks are
// flattened into their top work package; the file's dates are kept as they are (recalculation stays manual, S-1); activities of
// the project absent from the file are kept; the logic of every imported activity is replaced by the file's; a file calendar equal
// to a built-in one maps to it, the others become project calendars; P6 activity codes go to the activity description.
import type { ImportMode, PartStatus, StageCode } from '@/server/db/codes';

export const INTERCHANGE_DEFAULTS = {
  /** UPDATE imports: key tried first to match an activity ('uid' = MS Project UID / P6 task id); the other key is the fallback. */
  matchOn: 'uid' as 'uid' | 'activity_id',
  /** Import the file's baselines: NEW project → Baseline n becomes BL(n+1), BL1 current; UPDATE → Baseline 0 becomes a new proposed baseline. */
  importBaselines: true,
  /** Mode proposed for a schedule file ('new' = a new project) and for a table ('update' = add and update; 'new' = add only). */
  scheduleMode: 'new' as ImportMode,
  tableMode: 'update' as ImportMode,
  /** Lifecycle stage of a project created by a schedule import (as the New project wizard). */
  newProjectStage: 'initiative' as StageCode,
  /** Project manager proposed to the director for an imported project (a PM imports for themself). */
  defaultProjectManager: 'S. Perrin',
  /** Status of a part created by a catalogue import when the file gives none (qualification pending, as "New part"). */
  newPartStatus: 'not_validated' as PartStatus,
  /** "Export — MS Project XML": the baseline written as MS Project's Baseline 0 — the one the Baseline chip displays. */
  exportBaseline: 'displayed' as const,
} as const;
