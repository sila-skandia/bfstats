import { test, expect } from '@playwright/test';

/**
 * The Data Explorer no longer exists.
 *
 * Its master/detail UI (servers | maps | players "modes" under `/explore/*`)
 * was removed in the V4 migration and folded into the V4 servers landing page
 * and the V4 players page. Every `/explore/*` path in `src/router/index.ts` is
 * now a redirect stub, so the old suite — which asserted things like
 * `expect(page.url()).toContain('/explore/servers')` and poked at
 * `[class*="master"]` panels — was testing a page that can never load.
 *
 * What remains worth testing is the redirect contract: old bookmarks and
 * inbound links must still land somewhere sensible instead of dead-ending.
 * Coverage of the destination pages themselves lives in `landing.spec.ts`
 * and `players-extended.spec.ts`.
 */
test.describe('Data Explorer legacy redirects', () => {
  const toServerList = [
    '/explore',
    '/explore/servers',
    '/explore/servers/some-server-guid',
    '/explore/servers/some-server-guid/maps/Wake%20Island',
    '/explore/maps',
    '/explore/maps/Wake%20Island',
  ];

  // These assert the redirect contract, so they wait on the URL itself rather
  // than on `networkidle`. The destinations poll for live server data and hold a
  // SignalR socket open, so "500ms of network silence" is a condition the player
  // page in particular may never reach — it used to hang here for the full 30s
  // timeout. toHaveURL/toBeVisible retry until they pass, so they settle as soon
  // as the redirect lands instead.
  for (const path of toServerList) {
    test(`should redirect ${path} to the BF1942 server list`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(/\/v4\/servers\/bf1942/);
      expect(page.url()).not.toContain('/explore');
    });
  }

  test('should redirect /explore/players to the players page', async ({ page }) => {
    await page.goto('/explore/players');

    await expect(page).toHaveURL(/\/v4\/players/);
    expect(page.url()).not.toContain('/explore');

    await expect(page.getByRole('textbox', { name: /filter players by name/i })).toBeVisible();
  });

  test('should redirect a per-player explore link to that player', async ({ page }) => {
    await page.goto('/explore/players/Xanadu');

    await expect(page).toHaveURL(/\/v4\/players\/Xanadu/);
    expect(page.url()).not.toContain('/explore');
  });

  test('should land on a rendered page, not a blank router miss', async ({ page }) => {
    await page.goto('/explore');

    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.mm-landing__top')).toBeVisible();
  });
});
