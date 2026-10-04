import { expect, test } from '@playwright/test';

// Signing in for play.bfstats.io's REPLAY feed (features/replay-feed): the
// feed sends a visitor to /auth/discord/start?returnTo=<its page>, and the
// Discord callback sends them back there. Only bfstats.io's own hosts are a
// place to go back to.

const PLAY_PAGE = 'https://play.bfstats.io/play/index.html?tab=replay&rec=abcdefghjk';

test.describe('Sign-in for the REPLAY feed', () => {
  // The start page goes on to Discord at once, and reading its localStorage
  // raced that navigation ("Execution context was destroyed"). A 204 cancels
  // a navigation and leaves the page where it is. The page may start it
  // before its own load event, which then never comes, so the start page is
  // waited for only as far as its response (`commit`); the polls wait for
  // what it writes.
  test.beforeEach(async ({ page }) => {
    await page.route('https://discord.com/**', route => route.fulfill({ status: 204 }));
  });

  test('keeps a bfstats.io page to return to', async ({ page }) => {
    await page.goto(`/auth/discord/start?returnTo=${encodeURIComponent(PLAY_PAGE)}`, { waitUntil: 'commit' });
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('discord_auth_return_url')))
      .toContain('play.bfstats.io');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('discord_auth_return_url') ?? 'null'));
    expect(kept.url).toBe(PLAY_PAGE);
  });

  test('keeps no page on another site', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.evaluate(() => localStorage.setItem('discord_auth_return_url',
      JSON.stringify({ url: 'https://play.bfstats.io/stale', at: Date.now() })));
    await page.goto(`/auth/discord/start?returnTo=${encodeURIComponent('https://evil.example/phish')}`, { waitUntil: 'commit' });
    // An earlier sign-in's address goes too: this one names none it may keep.
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('discord_auth_return_url'))).toBeNull();
  });

  test('the callback goes back to the page that asked', async ({ page }) => {
    await page.route('**/stats/auth/login', route => route.fulfill({
      json: {
        user: { id: 1, email: 'player@example.com', name: 'player' },
        accessToken: 'header.payload.signature',
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      },
    }));
    await page.route('https://play.bfstats.io/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>play</title><p>REPLAY</p>',
    }));
    await page.goto('/servers/bf1942');
    await page.evaluate(url => localStorage.setItem('discord_auth_return_url',
      JSON.stringify({ url, at: Date.now() })), PLAY_PAGE);

    await page.goto('/auth/discord/callback?code=test-code');

    await page.waitForURL(PLAY_PAGE);
    expect(await page.evaluate(() => localStorage.getItem('discord_auth_return_url'))).toBeNull();
  });
});
