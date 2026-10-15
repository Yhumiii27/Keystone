// Meeting transcript (S-10), in French: a pasted transcript is imported, analysed by the local rules (nothing leaves
// Keystone: no ANTHROPIC_API_KEY), its proposals reviewed and added to the minutes ("Ajouter au CR").
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

const TRANSCRIPT = [
  'Romain Aubert: Bonjour à tous. On commence par le planning de la grue.',
  'Léa Fabre: On valide le passage à la grue de 300 tonnes pour le levage du 14 octobre.',
  'Julien Wagner: Je vais envoyer le plan de levage révisé pour le 9 octobre.',
  'Romain Aubert: Julien doit aussi confirmer la date avec le grutier. Il y a un risque de vent fort la semaine du 12.',
  "Léa Fabre: Est-ce que le client a validé la zone d'exclusion ?",
].join('\n');

test('FR transcript → local analysis → proposals → "Ajouter au CR"', async ({ page, context }) => {
  await viewAs(context, 'pm', 'fr');
  const w = watch(page);
  await page.goto('/projects/HLT-026/meetings?meeting=MTG-118');
  await expect(page.getByText('Analyse locale (règles)', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Importer une transcription' }).click();
  const d = page.getByRole('dialog', { name: 'Importer une transcription' });
  await d.getByRole('textbox', { name: /^Transcription/ }).fill(TRANSCRIPT);
  await d.getByRole('button', { name: 'Importer la transcription' }).click();
  await expect(toast(page)).toContainText(/^Transcription importée · \d+ mots · 3 intervenants/);
  await page.getByRole('button', { name: 'Analyser la transcription' }).click();
  await expect(toast(page)).toContainText(/^Transcription analysée \(règles locales\)/);
  const main = page.locator('main');
  await expect(main).toContainText('On valide le passage à la grue de 300 tonnes pour le levage du 14 octobre');
  await expect(main).toContainText('Envoyer le plan de levage révisé');
  await expect(main).toContainText('Il y a un risque de vent fort la semaine du 12');
  await page.getByRole('button', { name: 'Ajouter au CR' }).click();
  // The decision and the two actions are marked as added, and the panel says it.
  await expect(main.locator('.tag', { hasText: 'Ajouté au CR' })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Ajouter au CR' })).toHaveCount(0);
  w.check();
});
