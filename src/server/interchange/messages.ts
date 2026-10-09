// Messages of the importers (chapter 4, S-9): EN source sentences with numbered placeholders ("Unknown predecessor {0}").
// The importers store the filled-in English sentence (import_job_rows.messages, the job summary); the screen translates it
// back with `translateMessage`, which recognises the template, translates it through t() (src/i18n/extra/ch4-interchange.json)
// and puts the arguments back. Pure module (client islands and tests import it).
import type { T } from '@/i18n/translate';

export const MESSAGES = [
  // File and job level
  'The file is not an MS Project XML file (MSPDI)',
  'The file is not a Primavera P6 XER file',
  'The file contains a DOCTYPE declaration, which is not accepted',
  'The file could not be read',
  'The file contains no activity',
  'The file has more than {0} activities',
  'The file has more than {0} rows',
  'The XER file holds {0} projects — only {1} is imported',
  'The logic has a cycle: {0}',
  'Elapsed lags are converted to working days ({0})',
  'Percent lags are converted to working days ({0})',
  'Choose the project to update',
  'This project has no WBS yet — import the schedule as a new project',
  'You may not import this file into this project',
  'Unknown import',
  'Unknown project',
  'This import is already imported',
  'This import is cancelled',
  'Preview the import before confirming it',
  'The data changed since the preview — check the new preview',
  'The import failed',
  'Nothing to import',
  'Connector {0} is disabled — enable it in Configure',
  'Imported · {0} created · {1} updated',
  '{0} more rows are not shown',
  // Not imported / mapped differently
  'Resource rates and cost accrual are not imported',
  'Cross-project links are not imported ({0})',
  'Inactive and external tasks are not imported ({0})',
  'Secondary constraints are not imported ({0})',
  'Custom fields other than "Activity ID" are not imported ({0})',
  'As late as possible constraints are imported as ASAP ({0})',
  'Deadlines are not imported ({0})',
  'Level-of-effort and WBS-summary activities are not imported ({0})',
  'P6 activity codes are kept in the activity description ({0})',
  'Other tables of the XER file are not imported: {0}',
  'Work packages below level 2 are flattened into their top work package ({0})',
  'Baselines 1 to 10 of the file are imported as superseded baselines ({0})',
  'Baselines of the file are not imported (option off)',
  'P6 baselines are separate projects — none is imported',
  'Resource assignments are imported on the activities ({0})',
  'Activity owners are not in the file — set them on the Plan',
  // Schedule rows
  'Name is missing',
  'Duplicate UID {0}',
  'Duplicate Activity ID {0}',
  'Activity ID {0} is already used in the project — new code {1}',
  'Unknown predecessor {0} — link not imported',
  'Negative duration',
  'No dates in the file — dated from the project start',
  'Constraint {0} without a date — ignored',
  'Matched on UID {0}',
  'Matched on Activity ID {0}',
  'Moved to work package {0}',
  'Mapped to the built-in calendar {0}',
  'New project calendar',
  'Unknown calendar {0} — project calendar used',
  'Activities without a work package go to "{0}"',
  'Ungrouped activities',
  '{0} activities of the project are not in the file — kept',
  'Baseline {0} · {1} activities',
  // Table rows
  '{0} is required',
  'Not a number: {0}',
  'Unknown cost type {0}',
  'Unknown activity {0}',
  '{0} is not in the catalogue',
  'Invalid reference {0}',
  'Unknown unit {0}',
  'Unknown part type {0}',
  'Unknown scope {0}',
  'Unknown status {0}',
  'Unknown make / buy value {0}',
  'Unknown wear / spare value {0}',
  'Already there — skipped (Add only)',
  'Duplicate row for {0} — the first one is kept',
  'Unknown person — the resource is kept as text',
  'New supplier {0} will be registered',
  'Quantity must be greater than 0',
  'Negative amount',
] as const;

export type MessageTemplate = (typeof MESSAGES)[number];

/** "Unknown predecessor {0}" + ['A9999'] → "Unknown predecessor A9999". */
export function fmt(template: MessageTemplate, ...args: (string | number)[]): string {
  return template.replace(/\{(\d)\}/g, (_, i) => String(args[+i] ?? ''));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS: { template: MessageTemplate; re: RegExp }[] = MESSAGES.map((template) => ({
  template,
  re: new RegExp('^' + escape(template).replace(/\\\{(\d)\\\}/g, '(.*?)') + '$', 's'),
}));

/** Translates a stored message (or returns it through t() when it is not a template sentence). */
export function translateMessage(text: string, t: T): string {
  for (const { template, re } of MATCHERS) {
    const m = re.exec(text);
    if (!m) continue;
    const args = m.slice(1);
    return t(template).replace(/\{(\d)\}/g, (_, i) => args[+i] ?? '');
  }
  return t(text);
}
