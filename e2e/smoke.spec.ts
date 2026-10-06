import { expect, test, type Page } from '@playwright/test';

/** Dismiss the welcome dialog; it loads a matching demo pair onto the decks. */
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: "Let's mix" }).click();
  for (const deck of ['a', 'b']) {
    await expect(page.locator(`.deck.deck-${deck} .deck-bpm .bpm`)).not.toHaveText(/-/, { timeout: 60_000 });
    await expect(page.locator(`.deck.deck-${deck} .deck-status .spinner`)).toHaveCount(0, {
      timeout: 60_000,
    });
  }
}

test('first run loads the demo crate onto both decks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator('.deck.deck-a .deck-title .title')).toHaveText('Midnight Drive');
  await expect(page.locator('.deck.deck-b .deck-title .title')).toHaveText('Afterglow');
  await expect(page.locator('.deck.deck-a .key-badge')).toHaveText('8A');
  await expect(page.locator('.lib-list .trow').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('play advances the clock and the AI ranks the library', async ({ page }) => {
  await start(page);
  const clock = page.locator('.deck.deck-a .deck-clock .rem');
  const before = await clock.textContent();
  await page.locator('.deck.deck-a .t-play').click();
  await expect(page.locator('.deck.deck-a')).toHaveClass(/is-playing/);
  await expect(clock).not.toHaveText(before ?? '', { timeout: 10_000 });
  await expect(page.locator('.sugg.is-top')).toBeVisible();
  await expect(page.locator('.sugg-row').first()).toBeVisible();
});

test('AI Mix beat-matches the next track in and hands over the master', async ({ page }) => {
  await start(page);
  await page.selectOption('.ai-controls select[aria-label="When to mix"]', 'now');
  await page.locator('.deck.deck-a .t-play').click();
  await expect(page.locator('.deck.deck-a')).toHaveClass(/is-playing/);
  await page.locator('.sugg.is-top .btn-ai').click();
  await expect(page.locator('.mix-status')).toBeVisible();
  // The incoming deck starts on the phrase and is synced to the master tempo.
  await expect(page.locator('.deck.deck-b')).toHaveClass(/is-playing/, { timeout: 30_000 });
  await expect(page.locator('.deck.deck-b .tag-sync')).toBeVisible();
  const bpmA = await page.locator('.deck.deck-a .deck-bpm .bpm').textContent();
  await expect(page.locator('.deck.deck-b .deck-bpm .bpm')).toHaveText(bpmA ?? '');
  // Cancelling hands the controls back without stopping the music.
  await page.getByRole('button', { name: 'Cancel AI transition' }).click();
  await expect(page.locator('.mix-status')).toHaveCount(0);
  await expect(page.locator('.deck.deck-a')).toHaveClass(/is-playing/);
});

test('hot cues and loops respond on a playing deck', async ({ page }) => {
  await start(page);
  await page.locator('.deck.deck-a .t-play').click();
  const pad = page.locator('.deck.deck-a .pads .btn-pad').first();
  await pad.click();
  await expect(pad).toHaveClass(/is-set/);
  const loop = page.locator('.deck.deck-a .loop-main');
  await loop.click();
  await expect(loop).toHaveClass(/is-on/);
  await loop.click();
  await expect(loop).not.toHaveClass(/is-on/);
});
