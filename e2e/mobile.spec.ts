import { expect, test } from '@playwright/test';

test('phone layout: both decks fit, tabs switch, nothing overflows sideways', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Let's mix" }).click();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await expect(page.locator('.deck.is-mobile')).toHaveCount(2);
  await expect(page.locator('.deck.deck-a .deck-bpm .bpm')).not.toHaveText(/-/, { timeout: 60_000 });

  for (const tab of ['Mixer', 'Library', 'AI', 'Decks']) {
    await page.locator('.mobile-nav button', { hasText: tab }).tap();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${tab}`).toBeLessThanOrEqual(0);
  }

  await page.locator('.deck.deck-a .t-pads').tap();
  await expect(page.locator('.deck.deck-a .pads')).toBeVisible();
});
