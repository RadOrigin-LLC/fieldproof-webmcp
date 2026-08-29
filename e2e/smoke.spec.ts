import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke: onboarding → capture a photo (sealed, hashed) → caption →
 * punch item add/close → daily log → evidence packet shows the fingerprint →
 * verify seal passes. Runs against the production build (vite preview) so the
 * service worker and precache are exercised too.
 */
test('first-run flow: onboard, seal a photo, punch, log, packet', async ({ page }) => {
  await page.goto('/');

  // --- onboarding ---
  await expect(page.getByText('Keep a clear job record.')).toBeVisible();
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.getByLabel('Project name').fill('Deck rebuild');
  await page.getByLabel(/Client/).fill('The Harpers');
  await page.getByRole('button', { name: 'Start capturing' }).click();

  // --- projects board ---
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Deck rebuild')).toBeVisible();

  // --- capture: seal a photo through the hidden file input ---
  await page.getByRole('link', { name: 'Capture' }).click();
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/site.jpg');
  await expect(page.getByText('SEALED')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/File fingerprint/)).toBeVisible();
  await page.getByLabel(/Caption/).fill('North wall before drywall');
  await page.getByRole('button', { name: 'Done' }).click();

  // --- project detail: photo is on the record ---
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: /Deck rebuild/ }).click();
  await expect(page.getByRole('tab', { name: 'Photos' })).toBeVisible();
  await expect(page.getByText('North wall before drywall')).toBeVisible();

  // --- punch: add and close an item ---
  await page.getByRole('tab', { name: 'Punch' }).click();
  await page.getByPlaceholder('Touch up paint in hallway').fill('Replace cracked board');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Replace cracked board')).toBeVisible();
  await page.getByRole('button', { name: 'Mark done' }).click();

  // --- daily log ---
  await page.getByRole('tab', { name: 'Log' }).click();
  await page
    .getByPlaceholder(/Crew of 3/)
    .fill('Removed the old decking and took the first progress photo.');
  await page.getByRole('button', { name: /Save/ }).click();

  // --- evidence packet: fingerprint appendix present ---
  await page.getByRole('tab', { name: 'Reports' }).click();
  await page.getByRole('link', { name: /Handoff packet/i }).click();
  await expect(page.getByRole('heading', { name: 'Photo file fingerprints' })).toBeVisible();
  await expect(page.getByText('Removed the old decking and took the first progress photo.')).toBeVisible();

  // --- verify the seal from the photo detail ---
  await page.getByRole('link', { name: '← Back' }).click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.locator('.photo-card').first().click();
  await page.getByRole('button', { name: 'Check photo file' }).click();
  await expect(page.getByText('Saved file matches')).toBeVisible();
});
