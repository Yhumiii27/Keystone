// What-if levelling (S-7, R-3): "Select scenario → create requests" drafts resource requests once (a second click finds them),
// the plan is unchanged; on Resource requests a draft is sent to its department and another discarded after confirmation.
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

test('what-if: drafts created once, then one sent and one discarded from Resource requests', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  // Without ?project= the page opens the viewer's current project.
  await page.goto('/resources/what-if');
  await expect(page).toHaveURL(/\/resources\/what-if\?project=[A-Z]{3}-\d{3}/);
  const planBefore = await page.request.get('/api/export/plan?format=csv&code=HLT-026', { headers: { 'sec-fetch-site': 'same-origin' } }).then((r) => r.text());
  await page.goto('/resources/what-if?project=HLT-026');
  const select = page.getByRole('button', { name: 'Select scenario → create requests' }).first();
  await select.click();
  await expect(toast(page)).toContainText(/^Scenario A selected · \d+ draft requests? created \(RQ-\d+(, RQ-\d+)*\) — send (them|it) from Resource requests/);
  const ids = ((await toast(page).textContent()) ?? '').match(/RQ-\d+/g)!;
  expect(ids.length).toBeGreaterThanOrEqual(2);
  await page.reload();
  await page.getByRole('button', { name: 'Select scenario → create requests' }).first().click();
  await expect(toast(page)).toContainText('Scenario A selected · its requests already exist');
  // Nothing reaches the plan before the next Reschedule.
  expect(await page.request.get('/api/export/plan?format=csv&code=HLT-026', { headers: { 'sec-fetch-site': 'same-origin' } }).then((r) => r.text())).toBe(planBefore);

  await page.goto('/resources/requests');
  const [sent, discarded] = ids;
  const row = (id: string) => page.getByRole('row').filter({ hasText: id });
  await expect(row(sent)).toContainText('Draft');
  await row(sent).getByRole('button', { name: 'Send' }).click();
  await expect(toast(page)).toContainText('Draft sent to the department');
  await expect(row(sent).getByRole('button', { name: 'Send' })).toHaveCount(0);
  await row(discarded).getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('dialog', { name: 'Discard draft' }).getByRole('button', { name: 'Discard draft' }).click();
  await expect(toast(page)).toContainText('Draft discarded');
  await expect(row(discarded)).toHaveCount(0);
  w.check();
});
