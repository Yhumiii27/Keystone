// The runbook's scheduled-jobs table (docs/EXPLOITATION.md § 8) lists every job the worker runs (JOB_SCHEDULES), so IT
// knows what `npm run worker` does. Integration review of delivery 8: the connectors and docs-client-portfolio jobs
// (cursus-directory, cursus-events-purge, codex-index) were missing from it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOB_NAMES } from './jobs';

const runbook = readFileSync(join(process.cwd(), 'docs', 'EXPLOITATION.md'), 'utf8');

/** The text of § 8 "Tâches planifiées", up to the next level-2 heading. */
function jobsSection(md: string): string {
  const start = md.indexOf('## 8. Tâches planifiées');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end < 0 ? undefined : end);
}

describe('docs/EXPLOITATION.md § 8 — scheduled jobs', () => {
  it('names every job of JOB_SCHEDULES in its table', () => {
    const rows = jobsSection(runbook).split('\n').filter((l) => l.startsWith('|'));
    const missing = JOB_NAMES.filter((name) => !rows.some((r) => r.includes(`\`${name}\``)));
    expect(missing).toEqual([]);
  });
});
