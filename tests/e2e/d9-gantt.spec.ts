// R-198 — interactive Gantt of the Schedule screen (HLT-026): the project manager drags A1330's bar one week to the right (a
// "Start no earlier than" constraint, rescheduled at once), then changes A1520's duration from the keyboard (Enter on the bar,
// the activity dialog); Logistics reads the same Gantt without the edit handles. S-06: a drag earlier than the predecessor allows
// is refused; S-08: the equipment line filter of a multi-equipment project.
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

const GANTT = '/projects/HLT-026/schedule?gantt=activities&zoom=week';
const bar = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-gantt-act="${id}"]`);

test('drag a bar: the activity moves, the network is rescheduled at once', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(GANTT);
  const a = bar(page, 'A1330');
  await a.scrollIntoViewIfNeeded();
  const box = (await a.boundingBox())!;
  // Week zoom: 9 px per day — 63 px = 7 days.
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 36, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 69, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(toast(page)).toContainText(/A1330 · Activity moved · Rescheduled at .+ · finish .+/);
  w.check();
});

test('S-06: a bar dragged earlier than its predecessor allows is refused — it snaps back, the message names the predecessor', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(GANTT);
  const a = bar(page, 'A1330');
  await a.scrollIntoViewIfNeeded();
  const box = (await a.boundingBox())!;
  // Three weeks to the left (189 px in week zoom): before A1320's finish.
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x - 183, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(toast(page)).toContainText(/A1330 cannot start before .+ 2026: its predecessor A1320 \(FS\) holds it/);
  expect(Math.round((await a.boundingBox())!.x)).toBe(Math.round(box.x));
  w.check();
});

test('S-08: the equipment line filter keeps one line’s activities', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(GANTT);
  await page.getByRole('link', { name: 'EQ-02 · 3 × MEMU' }).click();
  await expect(page).toHaveURL(/equipment=EQ-02/);
  await expect(bar(page, 'A1410')).toBeVisible();
  await expect(bar(page, 'A1330')).toHaveCount(0);
  await page.getByRole('link', { name: 'Day', exact: true }).click();
  await expect(page).toHaveURL(/zoom=day&equipment=EQ-02/);
  await expect(bar(page, 'A1330')).toHaveCount(0);
  w.check();
});

test('keyboard: Enter on a bar opens the activity, its duration is changed', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(GANTT);
  await bar(page, 'A1520').focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog');
  await expect(d).toContainText('A1520');
  await d.getByLabel('Duration (working days)').fill('28');
  await d.getByRole('button', { name: 'Apply' }).click();
  await expect(toast(page)).toContainText(/A1520 · Duration changed · Rescheduled at/);
  w.check();
});

test('Logistics reads the Gantt: no drag handle', async ({ page, context }) => {
  await viewAs(context, 'logistics');
  const w = watch(page);
  await page.goto(GANTT);
  await expect(page.getByText('Read-only · a click or Enter opens the activity')).toBeVisible();
  await expect(bar(page, 'A1330')).toBeVisible();
  await expect(page.locator('[title="Drag onto another activity to link them (finish-to-start)"]')).toHaveCount(0);
  w.check();
});
