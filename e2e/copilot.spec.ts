import { expect, test, type Route } from '@playwright/test';

/**
 * Connects the AI chat to Google Gemini with a pasted key. The provider's endpoints are faked at
 * the network layer, so this runs without a real key while exercising the real browser client.
 */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';

const sse = (chunks: string[]) =>
  chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
  'data: [DONE]\n\n';

async function fakeGemini(route: Route) {
  const req = route.request();
  if (req.headers()['authorization'] !== 'Bearer AIza-test-key')
    return route.fulfill({
      status: 400,
      json: [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }],
    });
  if (req.url().endsWith('/models'))
    return route.fulfill({
      json: {
        object: 'list',
        data: [{ id: 'models/gemini-flash-latest' }, { id: 'models/gemini-3.8-flash' }],
      },
    });
  const body = req.postDataJSON() as { stream?: boolean; response_format?: unknown };
  if (body.stream)
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: sse(['Bring in ', '**Afterglow** on deck B ', 'and swap the bass on bar 17.']),
    });
  return route.fulfill({
    json: {
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              headline: 'Keep it in 8A and lift gently',
              picks: [
                {
                  trackId: 'demo-afterglow',
                  why: 'Same key, two BPM up – a seamless lift.',
                  technique: 'bass-swap',
                  tip: 'Swap the lows on the first drop.',
                },
              ],
              discover: [],
            }),
          },
          finish_reason: 'stop',
        },
      ],
    },
  });
}

test('connect a free Gemini key and chat with the AI DJ', async ({ page }) => {
  await page.route(`${GEMINI}/**`, fakeGemini);
  await page.goto('/');
  await page.getByRole('button', { name: "Let's mix" }).click();
  await expect(page.locator('.deck.deck-a .deck-bpm .bpm')).not.toHaveText(/-/, { timeout: 60_000 });

  await page.locator('.ai-tabs button', { hasText: 'Ask AI' }).click();
  const setup = page.locator('.copilot-setup');
  await expect(setup.getByRole('radio', { name: /Google Gemini/ })).toHaveAttribute('aria-checked', 'true');

  // A wrong key is refused with a clear message and nothing is saved.
  await setup.getByLabel('Gemini API key').fill('wrong');
  await setup.getByRole('button', { name: 'Connect' }).click();
  await expect(setup.locator('.provider-result')).toHaveText(/didn't accept the API key/);

  await setup.getByLabel('Gemini API key').fill('AIza-test-key');
  await setup.getByRole('button', { name: 'Connect' }).click();

  // Connected: the chat replaces the setup card and the top bar names the provider.
  await expect(page.locator('.chat-empty')).toContainText('Google Gemini');
  await expect(page.locator('.ai-dot')).toContainText('Gemini');

  await page.locator('.chat-input input').fill('How do I mix into the next track?');
  await page.locator('.chat-input input').press('Enter');
  await expect(page.locator('.msg-assistant').last()).toContainText('swap the bass on bar 17');

  // Picks may only name analysed tracks, so let the demo crate finish analysing first.
  await expect(page.locator('.lib-progress')).toHaveCount(0, { timeout: 90_000 });
  await page.locator('.quick button', { hasText: 'What should I play next?' }).click();
  await expect(page.locator('.pick strong').first()).toHaveText('Afterglow');
  await expect(page.locator('.pick .btn-ai').first()).toContainText('AI Mix');

  // The key survives a reload (stored in this browser only).
  await page.reload();
  await page.locator('.ai-tabs button', { hasText: 'Ask AI' }).click();
  await expect(page.locator('.chat-empty')).toContainText('Google Gemini');
});
