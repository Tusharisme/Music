import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** Raw multi-finger touches (Playwright's tap() is one finger). */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
}

async function centre(l: Locator, fy = 0.5) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height * fy };
}

test('phone: a whole mix from the Decks screen, several fingers at once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Let's mix" }).click();
  await expect(page.locator('.deck.deck-b .t-play')).toBeEnabled({ timeout: 60_000 });

  // Each deck has its bass, filter and volume next to the transport.
  for (const d of ['a', 'b']) {
    const deck = page.locator(`.deck.deck-${d}`);
    await expect(deck.getByRole('slider', { name: 'Bass' })).toBeVisible();
    await expect(deck.getByRole('slider', { name: 'Filter' })).toBeVisible();
    await expect(deck.getByRole('slider', { name: 'Vol' })).toBeVisible();
  }

  // Three fingers: start deck B, pull its volume down and cut deck A's bass, all at the same time.
  const touch = await fingers(page);
  const play = page.locator('.deck.deck-b .t-play');
  const vol = page.locator('.deck.deck-b').getByRole('slider', { name: 'Vol' });
  const bass = page.locator('.deck.deck-a').getByRole('slider', { name: 'Bass' });
  const [p, v, k] = [await centre(play), await centre(vol, 0.2), await centre(bass)];
  await touch('touchStart', [p, v, k]);
  for (let i = 1; i <= 10; i++)
    await touch('touchMove', [p, { x: v.x, y: v.y + i * 5 }, { x: k.x, y: k.y + i * 6 }]);
  await touch('touchEnd', []);
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  expect(Number(await vol.getAttribute('aria-valuenow'))).toBeLessThan(0.5);
  expect(Number(await bass.getAttribute('aria-valuenow'))).toBeLessThan(0.3);

  // A two-finger pinch on a deck doesn't zoom the page.
  const head = await centre(page.locator('.deck.deck-a .deck-head'));
  await touch('touchStart', [
    { x: head.x - 10, y: head.y },
    { x: head.x + 10, y: head.y },
  ]);
  for (let i = 1; i <= 10; i++)
    await touch('touchMove', [
      { x: head.x - 10 - i * 8, y: head.y },
      { x: head.x + 10 + i * 8, y: head.y },
    ]);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // Smart crossfader: in Bass swap mode one slide toward B also takes deck A's bass out.
  await page.locator('.mobile-xf .xf-mode').tap();
  await expect(page.locator('.mobile-xf .xf-mode')).toHaveText('Bass swap');
  const xf = await centre(page.locator('.mobile-xf .fader-track'));
  await touch('touchStart', [xf]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: xf.x + i * 12, y: xf.y }]);
  await touch('touchEnd', []);
  await expect(page.locator('.deck.deck-a .mdeck-knobs .knob').first()).toHaveClass(/is-pulled/);
  await expect(page.locator('.deck.deck-b .mdeck-knobs .knob').first()).not.toHaveClass(/is-pulled/);
});
